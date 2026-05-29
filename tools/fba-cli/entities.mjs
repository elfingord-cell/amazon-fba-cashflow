// FBA Cashflow CLI — Entity-Mutatoren.
//
// Alle Funktionen mutieren ein in-memory state-Objekt (das danach via app_sync committet wird).
// Sie schreiben NICHT selbst — der Commit + die Materialisierung passiert in client.commitState().
//
// ID-Konvention (aus echten Daten abgeleitet):
//   products: prod-xxxxxxx | categories: cat-xxxxxxx | suppliers: sup-xxxxxxx
//   fos: fo-xxxxxxx | pos: 7-stellige base36 | payments: pay-xxxxxxx

import crypto from "node:crypto";

export const COLLECTIONS = {
  products: "array",
  productCategories: "array",
  suppliers: "array",
  productSuppliers: "array",
  planProducts: "array",
  pos: "array",
  fos: "array",
  payments: "array",
  fixcosts: "array",
  incomings: "array",
  extras: "array",
  dividends: "array",
  supplierOutlooks: "array",
  settings: "object",
  fixcostOverrides: "object",
  taxes: "object",
  monthlyActuals: "object",
};

function rid(len = 7) {
  return crypto.randomBytes(16).toString("base64url").replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, len);
}
export function newId(prefix = "") {
  return `${prefix}${rid(7)}`;
}
function nowIso() {
  return new Date().toISOString();
}

export function ensureArray(state, key) {
  if (!Array.isArray(state[key])) state[key] = [];
  return state[key];
}

export function list(state, collection) {
  const v = state?.[collection];
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") return Object.entries(v);
  return [];
}

// Generisches Upsert in eine Array-Collection per Identitätsfeld (default id).
export function upsert(state, collection, obj, idField = "id") {
  const arr = ensureArray(state, collection);
  const idVal = obj[idField];
  const idx = idVal != null ? arr.findIndex((e) => e && e[idField] === idVal) : -1;
  const stamped = { ...obj, updatedAt: nowIso() };
  if (idx >= 0) {
    arr[idx] = { ...arr[idx], ...stamped };
    return { mode: "update", record: arr[idx] };
  }
  if (!stamped.createdAt) stamped.createdAt = nowIso();
  arr.push(stamped);
  return { mode: "insert", record: stamped };
}

export function removeById(state, collection, id, idField = "id") {
  const arr = ensureArray(state, collection);
  const before = arr.length;
  state[collection] = arr.filter((e) => !(e && e[idField] === id));
  return { removed: before - state[collection].length };
}

// --- Getypte Convenience-Helfer -----------------------------------------

export function upsertProduct(state, product) {
  const p = { ...product };
  if (!p.id) p.id = newId("prod-");
  // Produkte werden per SKU dedupliziert, falls keine id übergeben wurde aber SKU existiert.
  if (product.sku && !product.id) {
    const arr = ensureArray(state, "products");
    const existing = arr.find((e) => e && String(e.sku) === String(product.sku));
    if (existing) p.id = existing.id;
  }
  return upsert(state, "products", p, "id");
}

export function upsertSupplier(state, supplier) {
  const s = { ...supplier };
  if (!s.id) s.id = newId("sup-");
  return upsert(state, "suppliers", s, "id");
}

export function upsertCategory(state, category) {
  const c = { ...category };
  if (!c.id) c.id = newId("cat-");
  return upsert(state, "productCategories", c, "id");
}

export function upsertFixcost(state, fixcost) {
  const f = { ...fixcost };
  if (!f.id) f.id = crypto.randomUUID();
  return upsert(state, "fixcosts", f, "id");
}

export function addFo(state, fo) {
  const f = { ...fo };
  if (!f.id) f.id = newId("fo-");
  if (!f.status) f.status = "ACTIVE";
  return upsert(state, "fos", f, "id");
}

export function addPo(state, po) {
  const p = { ...po };
  if (!p.id) p.id = rid(7);
  if (!Array.isArray(p.items) && p.sku && p.units != null) {
    p.items = [{ id: newId("item-"), sku: p.sku, units: p.units }];
  }
  return upsert(state, "pos", p, "id");
}

// settings.<path> setzen (Punkt-Notation, z.B. "transportLeadTimesDays.sea").
export function setSetting(state, dottedPath, value) {
  if (!state.settings || typeof state.settings !== "object") state.settings = {};
  const keys = dottedPath.split(".");
  let node = state.settings;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const k = keys[i];
    if (!node[k] || typeof node[k] !== "object") node[k] = {};
    node = node[k];
  }
  const prev = node[keys[keys.length - 1]];
  node[keys[keys.length - 1]] = value;
  return { path: dottedPath, prev, value };
}
