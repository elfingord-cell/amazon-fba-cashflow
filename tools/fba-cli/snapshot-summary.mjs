// Baut eine lesbare Telegram-Zusammenfassung des CFP-Bestands-Snapshots.
// Zwei Modi:
//   Commit-Modus:  node snapshot-summary.mjs --month=2026-06
//       -> liest den committeten State, rechnet warehouse_only-Bestandswert (€) + Einheiten via buildAccountantReportData
//   Test-Modus:    node snapshot-summary.mjs --test --month=2026-06 --amazon=7755 --threepl=5860
//       -> formatiert nur die Dry-Run-Einheiten (kein €, da nichts committed)
import { getConfig } from "./config.mjs";
import { loadState } from "./client.mjs";
import { buildAccountantReportData } from "../../src/domain/accountantReport.js";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)=?(.*)$/);
  return m ? [m[1], m[2]] : [a, ""];
}));

const int = (v) => (Number(v) || 0).toLocaleString("de-DE");
const eur = (v) => (v == null || !Number.isFinite(Number(v)))
  ? "–"
  : Number(v).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

const month = args.month || "";

if (args.test !== undefined) {
  const a = Number(args.amazon) || 0;
  const t = Number(args.threepl) || 0;
  process.stdout.write(
`🧪 [TEST] CFP-Warenbestand ${month} (Vormonat) — Dry-Run ok, KEIN Commit
Würde gespeichert (physischer Lagerbestand):
• Amazon FBA: ${int(a)} Stk
• Externes Lager (3PL): ${int(t)} Stk
• Gesamt im Lager: ${int(a + t)} Stk
Quelle: VentoryOne · warehouse_only`);
  process.exit(0);
}

const { state } = await loadState(getConfig());
const rep = buildAccountantReportData(state, { month, scope: "core" });
const inv = rep.inventory || {};
const lagerStk = (Number(inv.totalAmazonUnits) || 0) + (Number(inv.total3plUnits) || 0);
process.stdout.write(
`📦 CFP-Warenbestand ${month} gespeichert (Monatsende, nur physischer Lagerbestand)
Bestandswert (DATEV 3980): ${eur(inv.totalValueEur)}
• Amazon FBA: ${int(inv.totalAmazonUnits)} Stk
• Externes Lager (3PL): ${int(inv.total3plUnits)} Stk
• Gesamt im Lager: ${int(lagerStk)} Stk
Ware im Zulauf (nur Info, NICHT im Bestandswert): ${eur(inv.totalInTransitValueEur)} · ${int(inv.totalInTransitUnits)} Stk
Quelle: VentoryOne · Bewertung warehouse_only`);
