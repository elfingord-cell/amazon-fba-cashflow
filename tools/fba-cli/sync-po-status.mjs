#!/usr/bin/env node
// FBA Cashflow CLI — PO-Empfangsstatus-Sync (VentoryOne -> CFP).
//
// Überträgt den PO-Empfangsstatus von VentoryOne (führendes System) in den CFP-State,
// damit der Wareneingang nicht doppelt gepflegt werden muss.
//
// WICHTIG zum Datenmodell:
//   - VentoryOne kennt einen echten `status` ("Received" | "Ordered" | "Planned" | ...).
//   - Der CFP kennt KEIN status-Feld bei POs. Empfangen/offen wird AUSSCHLIESSLICH über
//     `po.archived` (bool) unterschieden (Belege: inventory/index.tsx 418/538, stalePos-Liste).
//   => "Received" in VO  ==  archived=true im CFP.
//
// Mapping: CFP `poNo` <-> VO `po_number`, normalisiert (uppercase, nur [A-Z0-9]), mit/ohne "PO"-Präfix.
//   (NICHT über order_name matchen — das Feld ist frei/inkonsistent.)
//
// Aufruf (eigenständig):
//   node sync-po-status.mjs [--commit] [--workspace=<uuid>]
// oder via cli.mjs:
//   node cli.mjs sync-po-status [--commit] [--workspace=<uuid>]
//
// Default = DRY-RUN. Echtes Schreiben nur mit --commit. Vor jedem Write schreibt commitState()
// automatisch ein Backup nach ~/.fba-cli-backups/.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getConfig } from "./config.mjs";
import { commitState } from "./client.mjs";
import { validateState } from "./validate.mjs";

// --- Keys aus ~/.pierre-keys.env nachladen (für VO-Token/Base-URL) -------
function loadEnv() {
  const f = path.join(os.homedir(), ".pierre-keys.env");
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = t.slice(i + 1).trim();
  }
}

// --- Normalisierung für das Matching --------------------------------------
// uppercase, nur [A-Z0-9]. Liefert auch die "PO"-lose Variante zurück, damit
// "260002" und "PO260002" denselben Match-Key bilden können.
export function normalizePoNo(raw) {
  if (raw == null) return "";
  return String(raw).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// --- "Voll bezahlt?"-Erkennung (subtil!) ----------------------------------
// Eine CFP-PO hat `milestones[]` (z.B. Deposit 30% + Balance 70%) und `paymentLog{}` (Map).
// Im paymentLog steht NUR was schon bezahlt wurde — OFFENE Milestones FEHLEN dort komplett.
// "status":"paid" an einzelnen Einträgen reicht also NICHT, um "voll bezahlt" zu erkennen.
//
// Mapping Milestone -> Zahlung:
//   - paymentLog ist eine Map, deren KEY oft die Milestone-id ist (z.B. paymentLog["7e0mf66"]
//     für milestone.id "7e0mf66"); ODER der Eintrag trägt .milestoneId, das auf die Milestone zeigt.
//   - Eine Zahlung gilt als bezahlt, wenn status === "paid".
//   - Auto-Zusatzeinträge ("po-auto-...-duty" / "-eust" / "-fx_fee" / "-freight") sind KEINE
//     Milestones, nur Nebenkosten — sie werden beim Milestone-Abgleich ignoriert.
//
// Bedingung "voll bezahlt": Für JEDEN Eintrag in milestones[] muss es eine bezahlte Zahlung geben.
//   => jede milestone.id ist in der Menge der bezahlten Milestone-Referenzen.
//
// Fallback (keine milestones[]): defensiv "voll bezahlt", wenn mindestens eine paymentLog-Zahlung
//   status==="paid" hat UND keine Zahlung status!=="paid" hat.
const AUTO_LOG_KEY_RE = /^po-auto-/i;

export function isPoFullyPaid(po) {
  const log = (po && po.paymentLog && typeof po.paymentLog === "object") ? po.paymentLog : {};
  const logEntries = Object.entries(log);

  // Bezahlte Milestone-Referenzen sammeln: key (wenn kein Auto-Eintrag) + .milestoneId,
  // jeweils nur wenn der Eintrag status==="paid" trägt.
  const paidRefs = new Set();
  let anyPaid = false;
  let anyUnpaid = false;
  for (const [key, raw] of logEntries) {
    const entry = (raw && typeof raw === "object") ? raw : {};
    const isPaid = entry.status === "paid";
    if (isPaid) anyPaid = true; else anyUnpaid = true;
    if (!isPaid) continue;
    if (!AUTO_LOG_KEY_RE.test(key)) paidRefs.add(String(key));
    if (entry.milestoneId != null) paidRefs.add(String(entry.milestoneId));
  }

  const milestones = Array.isArray(po?.milestones) ? po.milestones : [];
  if (milestones.length === 0) {
    // Fallback (dokumentiert): ohne Milestones gilt voll bezahlt, wenn es paid-Zahlungen
    // gibt und keine offene (status!=="paid") Zahlung im Log steht.
    return anyPaid && !anyUnpaid;
  }

  // Voll bezahlt <=> jede milestone.id hat eine bezahlte Referenz.
  return milestones.every((m) => m && m.id != null && paidRefs.has(String(m.id)));
}

// Alle plausiblen Match-Keys eines PO-Bezeichners (mit + ohne PO-Präfix).
function matchKeys(raw) {
  const norm = normalizePoNo(raw);
  if (!norm) return [];
  const keys = new Set([norm]);
  if (norm.startsWith("PO")) keys.add(norm.slice(2));
  else keys.add(`PO${norm}`);
  return [...keys];
}

// --- Reine, testbare Planungsfunktion ------------------------------------
// Baut für jede CFP-PO einen Plan-Eintrag und bestimmt die Aktion:
//   ARCHIVE         VO=Received, CFP noch nicht archived UND PO voll bezahlt -> als empfangen
//                   markieren + archivieren.
//   RECEIVE_UNPAID  VO=Received, CFP noch nicht archived, ABER NICHT voll bezahlt -> Empfang
//                   eintragen (arrivalDate + ventoryPoId), aber NICHT archivieren. Hintergrund:
//                   der CFP-Cashflow ignoriert Zahlungen archivierter POs (poPaymentsLedger.js:453,
//                   paymentJournalCore.js:419 `if (record.archived) return;`). mahona setzt POs in
//                   VO oft 2-3 Tage VOR Ankunft auf "Received", während die 70%-Balance noch offen
//                   ist. Archivieren würde die offene Restzahlung aus dem Cashflow entfernen.
//   MAP             ventoryPoId noch nicht im CFP-PO gespeichert (und kein ARCHIVE/RECEIVE_UNPAID)
//                   -> nur mappen.
//   NOOP            nichts zu tun.
// Kein VO-Match -> unmatched.
export function planPoStatusSync(cfpPos, voPos) {
  // Map normalisierte VO-po_number (inkl. PO-loser Variante) -> VO-PO.
  const voByKey = new Map();
  for (const vo of voPos || []) {
    if (!vo) continue;
    for (const key of matchKeys(vo.po_number)) {
      if (!voByKey.has(key)) voByKey.set(key, vo);
    }
  }

  const all = [];
  const toArchive = [];
  const toReceiveUnpaid = [];
  const toMapOnly = [];
  const unmatched = [];

  for (const cfpPo of cfpPos || []) {
    if (!cfpPo) continue;

    // Match über die normalisierten Keys des CFP-poNo.
    let vo = null;
    for (const key of matchKeys(cfpPo.poNo)) {
      if (voByKey.has(key)) { vo = voByKey.get(key); break; }
    }

    if (!vo) {
      unmatched.push({ cfpId: cfpPo.id, poNo: cfpPo.poNo });
      continue;
    }

    const currentlyArchived = cfpPo.archived === true;
    const voReceivedDate = vo.order_received_date || null;
    const ventoryPoId = vo.id;
    const idAlreadyMapped = cfpPo.ventoryPoId != null && String(cfpPo.ventoryPoId) === String(ventoryPoId);

    const fullyPaid = isPoFullyPaid(cfpPo);

    let action;
    if (vo.status === "Received" && !currentlyArchived && fullyPaid) {
      action = "ARCHIVE";
    } else if (vo.status === "Received" && !currentlyArchived && !fullyPaid) {
      // Empfangen, aber Restzahlung offen -> NICHT archivieren (Cashflow-Schutz).
      action = "RECEIVE_UNPAID";
    } else if (!idAlreadyMapped) {
      action = "MAP";
    } else {
      action = "NOOP";
    }

    const entry = {
      cfpId: cfpPo.id,
      poNo: cfpPo.poNo,
      ventoryPoId,
      voPoNumber: vo.po_number,
      voStatus: vo.status,
      voReceivedDate,
      currentlyArchived,
      fullyPaid,
      action,
    };
    all.push(entry);
    if (action === "ARCHIVE") toArchive.push(entry);
    else if (action === "RECEIVE_UNPAID") toReceiveUnpaid.push(entry);
    else if (action === "MAP") toMapOnly.push(entry);
  }

  return { toArchive, toReceiveUnpaid, toMapOnly, unmatched, all };
}

// --- Mutator: wendet den Plan auf den State an (in-place) -----------------
// Fasst NUR archived / arrivalDate / ventoryPoId der betroffenen POs an. VO ist die Wahrheit:
// arrivalDate wird mit voReceivedDate überschrieben (sofern vorhanden).
//   ARCHIVE        -> archived=true + arrivalDate + ventoryPoId
//   RECEIVE_UNPAID -> arrivalDate + ventoryPoId, KEIN archived (offene Restzahlung bleibt im Cashflow)
//   MAP            -> nur ventoryPoId
export function applyPoStatusSync(state, plan) {
  const pos = Array.isArray(state?.pos) ? state.pos : [];
  const byId = new Map(pos.map((p) => [String(p?.id), p]));

  for (const e of plan?.toArchive || []) {
    const po = byId.get(String(e.cfpId));
    if (!po) continue;
    po.archived = true;
    if (e.voReceivedDate) po.arrivalDate = e.voReceivedDate;
    po.ventoryPoId = e.ventoryPoId;
  }
  for (const e of plan?.toReceiveUnpaid || []) {
    const po = byId.get(String(e.cfpId));
    if (!po) continue;
    // Empfang eintragen, aber NICHT archivieren — sonst verschwindet die offene
    // Restzahlung aus dem Cashflow (poPaymentsLedger.js:453 / paymentJournalCore.js:419).
    if (e.voReceivedDate) po.arrivalDate = e.voReceivedDate;
    po.ventoryPoId = e.ventoryPoId;
  }
  for (const e of plan?.toMapOnly || []) {
    const po = byId.get(String(e.cfpId));
    if (!po) continue;
    po.ventoryPoId = e.ventoryPoId;
  }
  return state;
}

// --- VO-POs über alle Seiten laden ---------------------------------------
export async function fetchAllVoPos() {
  loadEnv();
  const tok = process.env.VENTORYONE_API_TOKEN;
  const base = (process.env.VENTORYONE_BASE_URL || "https://app.ventory.one").replace(/\/+$/, "");
  if (!tok) throw new Error("VENTORYONE_API_TOKEN fehlt in ~/.pierre-keys.env.");

  const all = [];
  let page = 1;
  // Schutz gegen Endlosschleife; ~5 Seiten erwartet.
  for (let guard = 0; guard < 100; guard += 1) {
    const res = await fetch(`${base}/api/purchase_orders/?page=${page}`, {
      headers: { Authorization: `Bearer ${tok}`, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`VentoryOne ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const j = await res.json();
    const data = Array.isArray(j?.data) ? j.data : [];
    all.push(...data);
    const next = j?.paging?.next;
    if (!next || data.length === 0) break;
    page += 1;
  }
  return all;
}

// --- Lesbarer Report ------------------------------------------------------
function printReport(plan, dryRun) {
  console.log("\n=== PO-Empfangsstatus-Sync (VentoryOne -> CFP) ===");
  console.log(`Modus: ${dryRun ? "DRY-RUN (nichts geschrieben — mit --commit ausführen)" : "COMMITTED"}`);
  console.log("");
  const rows = plan.all;
  console.log("CFP poNo   | VO po_number | VO-Status  | order_received_date | Aktion");
  console.log("-----------+--------------+------------+---------------------+--------");
  for (const e of rows) {
    const actionLabel = e.action === "RECEIVE_UNPAID"
      ? "RECEIVE_UNPAID (empfangen, Restzahlung offen → nicht archiviert)"
      : e.action;
    console.log(
      `${String(e.poNo || "").padEnd(10)} | ${String(e.voPoNumber || "").padEnd(12)} | ` +
      `${String(e.voStatus || "").padEnd(10)} | ${String(e.voReceivedDate || "—").padEnd(19)} | ${actionLabel}`,
    );
  }
  if (plan.unmatched.length) {
    console.log("");
    console.log("Unmatched (CFP-PO ohne VO-Match):");
    for (const u of plan.unmatched) console.log(`  - poNo=${u.poNo} (cfpId=${u.cfpId})`);
  }
  console.log("");
  console.log(
    `Zusammenfassung: ${plan.toArchive.length} POs werden als empfangen archiviert (voll bezahlt), ` +
    `${(plan.toReceiveUnpaid || []).length} empfangen aber NICHT archiviert (Restzahlung offen), ` +
    `${plan.toMapOnly.length} nur gemappt, ${plan.unmatched.length} unmatched.`,
  );
  console.log("");
  console.log(dryRun
    ? ">> DRY-RUN — nichts geschrieben. Mit --commit erneut ausführen (Backup automatisch)."
    : ">> COMMITTED: State geschrieben, Backup unter ~/.fba-cli-backups/.");
}

// --- Hauptlogik: von cli.mjs UND vom eigenständigen Aufruf genutzt -------
export async function runSyncPoStatus({ commit = false, force = false, workspaceId } = {}) {
  const cfg = getConfig({ workspaceId });
  const dryRun = !commit;

  const voPos = await fetchAllVoPos();
  console.log(`VentoryOne: ${voPos.length} POs geladen.`);

  let plan = null;
  const res = await commitState(
    cfg,
    (state) => {
      const cfpPos = Array.isArray(state.pos) ? state.pos : [];
      plan = planPoStatusSync(cfpPos, voPos);
      applyPoStatusSync(state, plan);
    },
    { dryRun, force, label: "sync-po-status", validateFn: validateState },
  );

  printReport(plan, dryRun);
  if (!dryRun) {
    console.log(`\nNeue Rev: ${res.rev}`);
    if (res.backupFile) console.log(`Backup:   ${res.backupFile}`);
  }
  if (res.validation?.newErrors?.length) {
    console.log(`\n⚠ NEUE Validierungsfehler (${res.validation.newErrors.length}):`);
    for (const e of res.validation.newErrors) console.log("  - " + e);
  }
  return res;
}

// --- Eigenständiger Aufruf: node sync-po-status.mjs [flags] ---------------
function parseArgv(argv) {
  const positional = [];
  const flags = {};
  for (const a of argv) {
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      flags[k] = v === undefined ? true : v;
    } else positional.push(a);
  }
  return { positional, flags };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { flags } = parseArgv(process.argv.slice(2));
  runSyncPoStatus({
    commit: Boolean(flags.commit),
    force: Boolean(flags.force),
    workspaceId: flags.workspace,
  }).catch((err) => {
    process.stderr.write(`FEHLER: ${err.message}\n`);
    if (err.validation) process.stderr.write(JSON.stringify(err.validation, null, 2) + "\n");
    process.exit(1);
  });
}
