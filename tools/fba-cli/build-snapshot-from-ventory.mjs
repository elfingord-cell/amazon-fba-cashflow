// Baut einen Bestands-Snapshot fuer einen Monat aus VentoryOne-Live-Daten und schreibt ihn
// (via commitState) in state.inventory.snapshots des Cashflow-Tools.
//
// Mapping:
//   amazonUnits  = InStockSupplyQuantity + afn_reserved_quantity   (FBA on-hand: verfuegbar + reserviert)
//   threePLUnits = wh_pcs_left + fba_pcs_on_the_way                (Majamo-Lager + FBA-Transit, ADDITIV)
//
// Setzung (GF-Entscheidung Pierre): mahona bezieht EXW, Forto als Spediteur, 3PL ist Majamo.
// Ware, die von Majamo zu Amazon-FBA unterwegs ist (fba_pcs_on_the_way), gehoert wirtschaftlich
// zum Bestand ("im Kreislauf") und wird mitgezaehlt.
// KEINE Doppelzaehlung trotz Addition: VentoryOne bucht bei einer FBA-Einsendung die Ware SOFORT
// aus dem Majamo-Bestand aus (wh_pcs_left) und fuehrt sie als Transit (fba_pcs_on_the_way). Die
// beiden Felder sind also DISJUNKT -- verifiziert an VOs eigenem Bestandsfeld
// `pcs_total_wh_and_fba_excl_on_the_way` = InStock + wh + onway (z.B. FRAMEBAG-EDGE: wh 504 +
// onway 504 = 1008; das sind zwei verschiedene Chargen, nicht dieselbe). Daher: wh + onway addieren.
// (reservierte Ware zaehlt mit -- physisch noch im FC bis zur Auslieferung; das ist mahona-Setzung,
//  VOs Anzeige laesst reserved weg.)
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

// Reine Mapping-Funktion: eine VentoryOne-Stock-Zeile -> Snapshot-Item.
// threePLUnits = Majamo-Lager + FBA-Transit (additiv; Felder sind disjunkt, s. Kopf-Kommentar).
// Rueckgabe enthaelt _components (Audit/Anzeige) -- wird vor dem Schreiben entfernt.
export function mapVentoryRowToItem(voRow, canonicalSku) {
  const r = voRow || {};
  const inStock = num(r.InStockSupplyQuantity);
  const reserved = num(r.afn_reserved_quantity);
  const wh = num(r.wh_pcs_left);
  const onTheWay = num(r.fba_pcs_on_the_way);

  const amazonUnits = Math.max(0, Math.round(inStock + reserved));
  // Additiv: VO bucht Transit-Ware aus dem Lager aus -> wh und onway sind disjunkt, kein Doppel.
  const threePLUnits = Math.max(0, Math.round(wh + onTheWay));

  return {
    sku: canonicalSku, note: "", amazonUnits, threePLUnits,
    _components: {
      inStock, reserved, wh, onTheWay,
      whStockUnits: Math.max(0, Math.round(wh)),
      inTransitUnits: Math.max(0, Math.round(onTheWay)),
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
  console.log("\n  SKU                                amazon(=inStk+resv)    wh  transit  3PL(=wh+transit)  [inStk/resv/wh/onWay]");
  let sumAmazon = 0, sumThreePL = 0;
  for (const it of items.slice().sort((a, b) => b.amazonUnits - a.amazonUnits)) {
    const c = it._components;
    sumAmazon += it.amazonUnits; sumThreePL += it.threePLUnits;
    const flag = c.inTransitUnits > 0 ? " <-Transit" : "";
    console.log(
      `  ${it.sku.padEnd(34)} ${String(it.amazonUnits).padStart(6)}` +
      `        ${String(c.whStockUnits).padStart(5)}  ${String(c.inTransitUnits).padStart(5)}    ${String(it.threePLUnits).padStart(6)}` +
      `   [${c.inStock}/${c.reserved}/${c.wh}/${c.onTheWay}]${flag}`,
    );
  }
  console.log(`\n  SUMME: amazon=${sumAmazon}  3PL=${sumThreePL}  gesamt(amazon+3PL)=${sumAmazon + sumThreePL}`);

  // _components vor dem Schreiben entfernen (nur Anzeige)
  const cleanItems = items.map(({ _components, ...rest }) => rest);

  const mutate = (s) => {
    if (!s.inventory || typeof s.inventory !== "object") s.inventory = {};
    if (!Array.isArray(s.inventory.snapshots)) s.inventory.snapshots = [];
    s.inventory.snapshots = s.inventory.snapshots.filter((snap) => String(snap?.month) !== month);
    s.inventory.snapshots.push({ month, items: cleanItems });
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
