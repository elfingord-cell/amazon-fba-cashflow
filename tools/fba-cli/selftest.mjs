// Offline-Selbsttest: lädt ein exportiertes State-JSON und prüft Validator + Mutatoren
// rein in-memory (kein Netz, kein Key). Aufruf: node tools/fba-cli/selftest.mjs <backup.json>
import fs from "node:fs";
import { validateState } from "./validate.mjs";
import * as h from "./entities.mjs";

const file = process.argv[2];
if (!file) { console.error("Usage: selftest.mjs <backup.json>"); process.exit(2); }
const state = JSON.parse(fs.readFileSync(file, "utf8"));

console.log("== Zähler ==");
const counts = {};
for (const [k, kind] of Object.entries(h.COLLECTIONS)) {
  const v = state[k];
  counts[k] = kind === "array" ? (Array.isArray(v) ? v.length : 0) : (v && typeof v === "object" ? Object.keys(v).length : 0);
}
console.log(counts);

console.log("\n== Validierung (erwartet: calibrationCutoffDate-Fehler) ==");
console.log(validateState(state));

console.log("\n== Mutations-Test (in-memory, nicht committet) ==");
const work = structuredClone(state);
const beforeFos = (work.fos || []).length;
const beforeProds = (work.products || []).length;

const r1 = h.addFo(work, { sku: "PO-6TKA-Q0VA", units: 500, supplierId: "sup-7aco79f" });
const r2 = h.upsertProduct(work, { sku: "029.003-TAMPER-LEATHER", landedUnitCostEur: 5.1 });
const r3 = h.setSetting(work, "safetyStockDohDefault", 70);
const r4 = h.upsertSupplier(work, { name: "Test Supplier", company_name: "Test Co" });

console.log("addFo:", r1.mode, r1.record.id, "| fos", beforeFos, "→", work.fos.length);
console.log("upsertProduct (existing sku):", r2.mode, "id", r2.record.id, "landed", r2.record.landedUnitCostEur, "| products", beforeProds, "→", work.products.length, "(erwartet: update, gleiche Anzahl)");
console.log("setSetting:", r3.path, r3.prev, "→", r3.value);
console.log("upsertSupplier:", r4.mode, r4.record.id);

console.log("\n== Re-Validierung nach Mutation ==");
const v2 = validateState(work);
console.log("errors:", v2.errors.length, "warnings:", v2.warnings.length);

console.log("\nOK — Logikpfad funktioniert offline.");
