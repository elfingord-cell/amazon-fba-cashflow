// Ghost-FO detection: aktive FOs, deren SKU-Bedarf vermutlich schon durch
// eine inzwischen angelegte PO gedeckt ist (z.B. weil die PO manuell ohne
// FO-Konversion angelegt wurde). Defensiv — die Erkennung schlägt nur vor,
// keine Auto-Mutation.

export interface GhostFoMatchPo {
  poId: string;
  poNumber: string;
  orderDate: string | null;
  arrivalDate: string | null;
  etaIso: string | null;
  unitsForSku: number;
}

export interface GhostFoCandidate {
  foId: string;
  foNumber: string;
  foStatus: string;
  foSupplierId: string | null;
  foSupplierName: string;
  sku: string;
  alias: string;
  foUnits: number;
  foTargetDate: string | null;
  foTargetMonth: string | null;
  matchedPos: GhostFoMatchPo[];
  matchedUnitsTotal: number;
  coverageRatio: number; // matchedUnitsTotal / foUnits
  earliestPoArrival: string | null;
  confidence: "high" | "medium" | "low";
  reason: string;
}

function isPoCountable(po: Record<string, unknown>): boolean {
  if (!po) return false;
  if (po.archived === true) return false;
  const status = String(po.status || "").toUpperCase();
  if (status === "CANCELLED") return false;
  return true;
}

function isFoActiveForGhostCheck(fo: Record<string, unknown>): boolean {
  if (!fo) return false;
  const status = String(fo.status || "").toUpperCase();
  if (status === "CONVERTED" || status === "CANCELLED" || status === "ARCHIVED") return false;
  return true;
}

function parseIsoDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function resolvePoEtaIso(po: Record<string, unknown>): string | null {
  const arrival = po.arrivalDate;
  if (typeof arrival === "string" && /^\d{4}-\d{2}-\d{2}/.test(arrival)) return arrival.slice(0, 10);
  const etaManual = po.etaManual;
  if (typeof etaManual === "string" && /^\d{4}-\d{2}-\d{2}/.test(etaManual)) return etaManual.slice(0, 10);
  const etaDate = po.etaDate;
  if (typeof etaDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(etaDate)) return etaDate.slice(0, 10);
  const eta = po.eta;
  if (typeof eta === "string" && /^\d{4}-\d{2}-\d{2}/.test(eta)) return eta.slice(0, 10);
  // Computed: orderDate + prodDays + transitDays
  const orderDate = parseIsoDate(po.orderDate);
  if (!orderDate) return null;
  const prodDays = Number(po.prodDays || 0);
  const transitDays = Number(po.transitDays || 0);
  const computed = new Date(orderDate.getTime());
  computed.setDate(computed.getDate() + Math.max(0, prodDays + transitDays));
  return computed.toISOString().slice(0, 10);
}

function resolveFoTargetIso(fo: Record<string, unknown>): string | null {
  const candidates = [fo.targetDeliveryDate, fo.deliveryDate, fo.etaDate, fo.eta];
  for (const c of candidates) {
    if (typeof c === "string" && /^\d{4}-\d{2}-\d{2}/.test(c)) return c.slice(0, 10);
  }
  // Fallback: targetMonth + day 01
  const month = fo.targetMonth || fo.month;
  if (typeof month === "string" && /^\d{4}-\d{2}$/.test(month)) return `${month}-01`;
  return null;
}

function diffDaysAbs(iso1: string | null, iso2: string | null): number | null {
  if (!iso1 || !iso2) return null;
  const d1 = new Date(`${iso1}T00:00:00Z`).getTime();
  const d2 = new Date(`${iso2}T00:00:00Z`).getTime();
  if (Number.isNaN(d1) || Number.isNaN(d2)) return null;
  return Math.round(Math.abs(d1 - d2) / (24 * 60 * 60 * 1000));
}

function getItemsWithSku(record: Record<string, unknown>): Array<{ sku: string; units: number }> {
  const rawItems = Array.isArray(record.items) && record.items.length
    ? (record.items as Array<Record<string, unknown>>)
    : [{ sku: record.sku, units: record.units } as Record<string, unknown>];
  return rawItems
    .map((it) => ({
      sku: String(it?.sku || "").trim(),
      units: Math.max(0, Number(it?.units || 0)),
    }))
    .filter((it) => it.sku);
}

export function findGhostFoCandidates(state: Record<string, unknown>): GhostFoCandidate[] {
  const pos = (Array.isArray(state.pos) ? state.pos : []) as Array<Record<string, unknown>>;
  const fos = (Array.isArray(state.fos) ? state.fos : []) as Array<Record<string, unknown>>;
  const suppliers = (Array.isArray(state.suppliers) ? state.suppliers : []) as Array<Record<string, unknown>>;
  const products = (Array.isArray(state.products) ? state.products : []) as Array<Record<string, unknown>>;

  const supplierMap = new Map<string, string>();
  suppliers.forEach((s) => {
    if (s?.id) supplierMap.set(String(s.id), String(s.name || s.id));
  });

  const productAliasMap = new Map<string, string>();
  products.forEach((p) => {
    const sku = String(p?.sku || "").trim();
    if (sku) productAliasMap.set(sku, String(p.alias || sku));
  });

  // Index POs by SKU for fast lookup
  const poBySku = new Map<string, Array<{ po: Record<string, unknown>; units: number; etaIso: string | null }>>();
  pos.forEach((po) => {
    if (!isPoCountable(po)) return;
    const etaIso = resolvePoEtaIso(po);
    getItemsWithSku(po).forEach((it) => {
      if (!it.units) return;
      if (!poBySku.has(it.sku)) poBySku.set(it.sku, []);
      poBySku.get(it.sku)!.push({ po, units: it.units, etaIso });
    });
  });

  const candidates: GhostFoCandidate[] = [];

  fos.forEach((fo) => {
    if (!isFoActiveForGhostCheck(fo)) return;
    const foTargetIso = resolveFoTargetIso(fo);
    const foTargetMonth = foTargetIso ? foTargetIso.slice(0, 7) : null;
    const foSupplierId = (fo.supplierId || fo.supplier) ? String(fo.supplierId || fo.supplier) : null;
    const foSupplierName = foSupplierId ? (supplierMap.get(foSupplierId) || foSupplierId) : "—";

    getItemsWithSku(fo).forEach((foItem) => {
      const poEntries = poBySku.get(foItem.sku);
      if (!poEntries || !poEntries.length) return;

      // Window: PO ETA must lie in [FO Target − 90d, FO Target + 30d].
      // Wenn kein FO-Target da ist → fallback: alle bekannten POs (low confidence).
      const matchedPos: GhostFoMatchPo[] = [];
      poEntries.forEach(({ po, units, etaIso }) => {
        if (foTargetIso && etaIso) {
          const diff = diffDaysAbs(etaIso, foTargetIso);
          if (diff == null) return;
          // Asymmetric: PO eta should be at most 90 days before or 30 days after FO target
          const etaDate = new Date(`${etaIso}T00:00:00Z`).getTime();
          const targetDate = new Date(`${foTargetIso}T00:00:00Z`).getTime();
          const deltaDaysSigned = Math.round((etaDate - targetDate) / (24 * 60 * 60 * 1000));
          if (deltaDaysSigned < -90 || deltaDaysSigned > 30) return;
        }
        matchedPos.push({
          poId: String(po.id || po.poNo || ""),
          poNumber: String(po.poNo || po.id || ""),
          orderDate: typeof po.orderDate === "string" ? po.orderDate : null,
          arrivalDate: typeof po.arrivalDate === "string" ? po.arrivalDate : null,
          etaIso,
          unitsForSku: units,
        });
      });

      if (!matchedPos.length) return;

      const matchedUnitsTotal = matchedPos.reduce((sum, m) => sum + m.unitsForSku, 0);
      const coverageRatio = foItem.units > 0 ? matchedUnitsTotal / foItem.units : 0;
      // Skip if coverage too low (under 30%)
      if (coverageRatio < 0.3) return;

      // Confidence:
      // - high: foTargetIso bekannt, PO arrivalDate gesetzt (also schon geliefert oder konkret terminiert),
      //   coverage >= 80%
      // - medium: 50% <= coverage < 80%, oder PO arrivalDate fehlt
      // - low: coverage < 50% oder foTargetIso fehlt
      let confidence: "high" | "medium" | "low" = "low";
      const hasArrival = matchedPos.some((m) => !!m.arrivalDate);
      if (foTargetIso && coverageRatio >= 0.8 && hasArrival) confidence = "high";
      else if (coverageRatio >= 0.5) confidence = "medium";

      const earliestPoArrival = matchedPos
        .map((m) => m.arrivalDate || m.etaIso)
        .filter((d): d is string => !!d)
        .sort()[0] || null;

      const reasons: string[] = [];
      reasons.push(`${matchedPos.length} PO${matchedPos.length === 1 ? "" : "s"} mit gleicher SKU im Zeitfenster gefunden`);
      reasons.push(`Mengen decken ${Math.round(coverageRatio * 100)}% der FO ab`);
      if (hasArrival) reasons.push(`mindestens eine PO bereits in DE angekommen`);

      candidates.push({
        foId: String(fo.id || fo.foNo || ""),
        foNumber: String(fo.foNo || fo.id || ""),
        foStatus: String(fo.status || ""),
        foSupplierId,
        foSupplierName,
        sku: foItem.sku,
        alias: productAliasMap.get(foItem.sku) || foItem.sku,
        foUnits: foItem.units,
        foTargetDate: foTargetIso,
        foTargetMonth,
        matchedPos,
        matchedUnitsTotal,
        coverageRatio,
        earliestPoArrival,
        confidence,
        reason: reasons.join(" · "),
      });
    });
  });

  // Sort: high confidence first, then by coverage descending, then by foTarget date
  candidates.sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 };
    const byConf = rank[a.confidence] - rank[b.confidence];
    if (byConf !== 0) return byConf;
    const byCov = b.coverageRatio - a.coverageRatio;
    if (byCov !== 0) return byCov;
    return String(a.foTargetDate || "").localeCompare(String(b.foTargetDate || ""));
  });

  return candidates;
}
