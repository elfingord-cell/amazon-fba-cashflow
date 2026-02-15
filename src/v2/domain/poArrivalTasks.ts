export interface PoArrivalTask {
  id: string;
  poNumber: string;
  supplier: string;
  skuAliases: string;
  units: number;
  etaDate: string | null;
  arrivalDate: string | null;
  monthRelevant: boolean;
  isOverdue: boolean;
  pending: boolean;
}

interface BuildPoArrivalTasksInput {
  state: Record<string, unknown>;
  month: string;
  todayIso?: string | null;
}

function normalizeKey(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function toIsoDate(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function toDate(value: string | null): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function todayIsoLocal(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseUnits(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
}

function resolveEtaDate(record: Record<string, unknown>): string | null {
  const manual = toIsoDate(record.etaManual || record.etaDate || record.eta);
  if (manual) return manual;
  const orderDate = toDate(toIsoDate(record.orderDate));
  if (!orderDate) return null;
  const prodDays = Math.max(0, Number(record.prodDays || 0));
  const transitDays = Math.max(0, Number(record.transitDays || 0));
  const etaDate = new Date(orderDate.getTime());
  etaDate.setDate(etaDate.getDate() + prodDays + transitDays);
  const year = etaDate.getFullYear();
  const month = String(etaDate.getMonth() + 1).padStart(2, "0");
  const day = String(etaDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function resolveSupplierName(record: Record<string, unknown>, supplierNameByKey: Map<string, string>): string {
  const supplierKey = normalizeKey(record.supplierId || record.supplier || record.supplierName);
  if (supplierKey && supplierNameByKey.has(supplierKey)) return String(supplierNameByKey.get(supplierKey));
  return String(record.supplierName || record.supplier || "-");
}

function resolveSkuAliases(record: Record<string, unknown>, aliasBySku: Map<string, string>): string {
  const items = Array.isArray(record.items) ? record.items : [];
  const skus = items.length
    ? items.map((item) => String((item as Record<string, unknown>).sku || "").trim()).filter(Boolean)
    : [String(record.sku || "").trim()].filter(Boolean);
  const aliases = Array.from(new Set(
    skus.map((sku) => aliasBySku.get(normalizeKey(sku)) || sku),
  ));
  return aliases.join(", ") || "-";
}

function resolveUnits(record: Record<string, unknown>): number {
  const items = Array.isArray(record.items) ? record.items : [];
  if (items.length) {
    return items.reduce((sum, item) => sum + parseUnits((item as Record<string, unknown>).units), 0);
  }
  return parseUnits(record.units);
}

export function buildPoArrivalTasks(input: BuildPoArrivalTasksInput): PoArrivalTask[] {
  const sourceState = input.state && typeof input.state === "object" ? input.state : {};
  const month = String(input.month || "");
  const todayIso = toIsoDate(input.todayIso) || todayIsoLocal();

  const supplierNameByKey = new Map<string, string>();
  const suppliers = Array.isArray(sourceState.suppliers) ? sourceState.suppliers : [];
  suppliers.forEach((entry) => {
    const supplier = (entry && typeof entry === "object") ? entry as Record<string, unknown> : {};
    const name = String(supplier.name || "").trim();
    if (!name) return;
    const idKey = normalizeKey(supplier.id);
    const nameKey = normalizeKey(name);
    if (idKey) supplierNameByKey.set(idKey, name);
    if (nameKey) supplierNameByKey.set(nameKey, name);
  });

  const aliasBySku = new Map<string, string>();
  const products = Array.isArray(sourceState.products) ? sourceState.products : [];
  products.forEach((entry) => {
    const product = (entry && typeof entry === "object") ? entry as Record<string, unknown> : {};
    const sku = String(product.sku || "").trim();
    if (!sku) return;
    aliasBySku.set(normalizeKey(sku), String(product.alias || sku));
  });

  const tasks: PoArrivalTask[] = [];
  const pos = Array.isArray(sourceState.pos) ? sourceState.pos : [];
  pos.forEach((entry) => {
    const record = (entry && typeof entry === "object") ? entry as Record<string, unknown> : {};
    if (record.archived) return;
    if (String(record.status || "").toUpperCase() === "CANCELLED") return;

    const id = String(record.id || record.poNo || "").trim();
    if (!id) return;

    const etaDate = resolveEtaDate(record);
    if (!etaDate) return;

    const arrivalDate = toIsoDate(record.arrivalDate);
    const etaMonth = etaDate.slice(0, 7);
    const monthRelevant = etaMonth === month;
    const pending = !arrivalDate;
    const isOverdue = pending && etaDate < todayIso;
    if (!monthRelevant && !isOverdue) return;

    tasks.push({
      id,
      poNumber: String(record.poNo || record.id || ""),
      supplier: resolveSupplierName(record, supplierNameByKey),
      skuAliases: resolveSkuAliases(record, aliasBySku),
      units: resolveUnits(record),
      etaDate,
      arrivalDate,
      monthRelevant,
      isOverdue,
      pending,
    });
  });

  return tasks.sort((left, right) => {
    if (left.pending !== right.pending) return left.pending ? -1 : 1;
    if (left.monthRelevant !== right.monthRelevant) return left.monthRelevant ? -1 : 1;
    const leftDate = left.etaDate || "9999-12-31";
    const rightDate = right.etaDate || "9999-12-31";
    const dateCompare = leftDate.localeCompare(rightDate);
    if (dateCompare !== 0) return dateCompare;
    return left.poNumber.localeCompare(right.poNumber);
  });
}
