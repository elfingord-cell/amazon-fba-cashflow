// Baut einen Bestands-Snapshot fuer einen Monat aus VentoryOne-Live-Daten und schreibt ihn
// (via commitState) in state.inventory.snapshots des Cashflow-Tools.
//
// Mapping (GF-Entscheidung Pierre 2026-06-01):
//   amazonUnits  = InStockSupplyQuantity + afn_reserved_quantity + fba_pcs_on_the_way
//                  (alles bei + unterwegs zu Amazon: verfuegbar + reserviert + Transit-zu-FBA)
//   threePLUnits = wh_pcs_left                                     (nur Majamo-3PL-Lager)
//
// Warum so:
// - Transit zu Amazon (fba_pcs_on_the_way) gehoert in den AMAZON-Eimer, nicht ins 3PL -- die Ware
//   ist auf dem Weg ins FC. (Frueher lag sie im 3PL-Eimer; am Gesamt-Total aendert die Verschiebung
//   nichts, nur an der Zuordnung Amazon vs 3PL.)
// - Reservierte Ware (afn_reserved_quantity) zaehlt MIT: sie liegt physisch im FC und ist mahonas
//   Eigentum bis zur Auslieferung an den Kunden. Damit ist der CFP-Snapshot ein vollstaendiger
//   EIGENTUMS-/Bestandswert. ACHTUNG: VOs Headline (`TotalSupplyQuantity`) zaehlt reservierte NICHT
//   -> der CFP liegt bewusst ~reserved hoeher als VO. Beim Vergleich gilt: CFP ~= VO + reserved
//   (und + ggf. Verkaufstage-Differenz ueber die Sales-Velocity, wenn Snapshot-Tag != heute).
// - KEINE Doppelzaehlung wh vs Transit: VentoryOne bucht bei einer FBA-Einsendung die Ware SOFORT
//   aus dem Majamo-Bestand aus (wh_pcs_left) und fuehrt sie als Transit (fba_pcs_on_the_way) -- die
//   Felder sind disjunkt (verifiziert an `pcs_total_wh_and_fba_excl_on_the_way` = InStock+wh+onway).
//
// Die Rohkomponenten (inStock/reserved/wh/onTheWay) werden je SKU mit gespeichert (`components`),
// damit "warum ist die Zahl so?" spaeter ohne erneuten VO-Abruf beantwortbar bleibt.
//
// Aufruf:
//   node tools/fba-cli/build-snapshot-from-ventory.mjs --month=2026-05            # Dry-Run
//   node tools/fba-cli/build-snapshot-from-ventory.mjs --month=2026-05 --commit   # schreibt

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getConfig } from "./config.mjs";
import { commitState, loadState } from "./client.mjs";
import { validateState } from "./validate.mjs";

function loadEnv() {
  const f = path.join(os.homedir(), ".pierre-keys.env");
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    if (!process.env[t.slice(0, i).trim()]) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}

async function fetchVentoryStock() {
  loadEnv();
  const tok = process.env.VENTORYONE_API_TOKEN;
  const base = (process.env.VENTORYONE_BASE_URL || "https://app.ventory.one").replace(/\/+$/, "");
  const res = await fetch(`${base}/api/current_stock/All/`, { headers: { Authorization: `Bearer ${tok}`, Accept: "application/json" } });
  if (!res.ok) throw new Error(`VentoryOne ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const j = await res.json();
  return j.data || j.results || (Array.isArray(j) ? j : []);
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function round1(v) { return Math.round(num(v) * 10) / 10; }

// Reine Mapping-Funktion: eine VentoryOne-Stock-Zeile -> Snapshot-Item.
// amazonUnits  = InStock + reserviert + Transit-zu-FBA (alles bei/unterwegs zu Amazon).
// threePLUnits = nur wh_pcs_left (Majamo-3PL). S. Kopf-Kommentar.
// `components` (inStock/reserved/wh/onTheWay) wird MIT gespeichert (Audit/Reconciliation).
export function mapVentoryRowToItem(voRow, canonicalSku) {
  const r = voRow || {};
  const inStock = num(r.InStockSupplyQuantity);
  const reserved = num(r.afn_reserved_quantity);
  const wh = num(r.wh_pcs_left);
  const onTheWay = num(r.fba_pcs_on_the_way);

  // Transit zaehlt zu Amazon (Ware ist auf dem Weg ins FC); reserviert zaehlt mit (Eigentum im FC).
  const amazonUnits = Math.max(0, Math.round(inStock + reserved + onTheWay));
  // Nur das externe 3PL-Lager (Majamo). wh und onway sind disjunkt -> keine Doppelzaehlung.
  const threePLUnits = Math.max(0, Math.round(wh));

  // Verkaufs-Velocity (Stk/Tag) fuer die Reconciliation-Projektion. Headline = 3-Tage-Schnitt
  // (reagiert am schnellsten auf den aktuellen Abverkauf), Fallback 7-Tage / Forecast / 30-Tage.
  // Rohwerte in components fuer Transparenz.
  const sales3 = round1(r.sales_last_3_days);
  const sales7 = round1(r.sales_last_7_days);
  const sales30 = round1(r.sales_last_30_days);
  const forecastVel = round1(r.forecasted_sales_velocity);
  const velocityPerDay = sales3 || sales7 || forecastVel || sales30;

  return {
    sku: canonicalSku, note: "", amazonUnits, threePLUnits, velocityPerDay,
    components: {
      inStock, reserved, wh, onTheWay,
      whStockUnits: Math.max(0, Math.round(wh)),
      inTransitUnits: Math.max(0, Math.round(onTheWay)),
      sales3, sales7, sales30, forecastVel,
    },
  };
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=?(.*)$/); return m ? [m[1], m[2] === "" ? true : m[2]] : [a, true];
  }));
  const month = String(args.month || "").trim();
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("--month=YYYY-MM erforderlich");
  const commit = Boolean(args.commit);

  const cfg = getConfig();
  const { state } = await loadState(cfg);
  const productSkus = new Map((state.products || []).map((p) => [String(p.sku).toLowerCase(), String(p.sku)]));

  const vo = await fetchVentoryStock();
  const items = [];
  const unmatched = [];
  for (const r of vo) {
    const skuRaw = String(r.sku || "");
    const canonical = productSkus.get(skuRaw.toLowerCase());
    if (!canonical) { if (skuRaw) unmatched.push(skuRaw); continue; }
    items.push(mapVentoryRowToItem(r, canonical));
  }

  // Vorschau-Tabelle
  console.log(`\nVentoryOne -> Snapshot ${month}: ${items.length} SKUs gemappt, ${unmatched.length} unmatched.`);
  if (unmatched.length) console.log("  unmatched (in VO, nicht in Produkten):", unmatched.join(", "));
  console.log("\n  SKU                                amazon(=inStk+resv+transit)    3PL(=wh)  [inStk/resv/wh/onWay]");
  let sumAmazon = 0, sumThreePL = 0;
  for (const it of items.slice().sort((a, b) => b.amazonUnits - a.amazonUnits)) {
    const c = it.components;
    sumAmazon += it.amazonUnits; sumThreePL += it.threePLUnits;
    const flag = c.inTransitUnits > 0 ? " <-Transit" : "";
    console.log(
      `  ${it.sku.padEnd(34)} ${String(it.amazonUnits).padStart(6)}` +
      `              ${String(it.threePLUnits).padStart(6)}` +
      `   [${c.inStock}/${c.reserved}/${c.wh}/${c.onTheWay}]${flag}`,
    );
  }
  console.log(`\n  SUMME: amazon=${sumAmazon}  3PL=${sumThreePL}  gesamt(amazon+3PL)=${sumAmazon + sumThreePL}`);

  // components bleiben erhalten (Audit/Reconciliation) -> direkt schreiben.
  const cleanItems = items;
  const capturedAt = new Date().toISOString();
  console.log(`\n  capturedAt: ${capturedAt} (Zeitstempel fuer die Reconciliation-Projektion)`);

  const mutate = (s) => {
    if (!s.inventory || typeof s.inventory !== "object") s.inventory = {};
    if (!Array.isArray(s.inventory.snapshots)) s.inventory.snapshots = [];
    s.inventory.snapshots = s.inventory.snapshots.filter((snap) => String(snap?.month) !== month);
    s.inventory.snapshots.push({ month, capturedAt, items: cleanItems });
    s.inventory.snapshots.sort((a, b) => String(a.month).localeCompare(String(b.month)));
  };

  const res = await commitState(cfg, mutate, { dryRun: !commit, label: `snapshot-${month}`, validateFn: validateState });
  if (res.dryRun) {
    const before = (res.before.inventory?.snapshots || []).map((s) => s.month);
    const after = (res.next.inventory?.snapshots || []).map((s) => s.month);
    console.log("\n[DRY-RUN] snapshots vorher:", before.join(","), "-> nachher:", after.join(","));
    console.log("[DRY-RUN] neue Fehler:", res.validation.newErrors, "| vorbestehend:", res.validation.preexistingErrors.length);
    console.log("Nichts geschrieben. Mit --commit ausfuehren.");
  } else {
    console.log("\n[COMMITTED] neuer rev:", res.rev, "| Backup:", res.backupFile);
    console.log("snapshots jetzt:", (await loadState(cfg)).state.inventory.snapshots.map((s) => s.month).join(","));
  }
}

// Nur ausfuehren, wenn direkt gestartet (nicht beim Import durch den Test).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { process.stderr.write(`FEHLER: ${e.message}\n`); process.exit(1); });
}
