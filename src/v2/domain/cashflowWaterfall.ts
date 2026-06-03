// Reine Funktion: zerlegt einen Monat in den nachrechenbaren Cashflow-Wasserfall
// Brutto-Umsatz (VO) → Realismus/Kalibrierung → Auszahlungsquote → Sales-Cash-Eingang
// → + Sonstige Einzahlungen → − Fixkosten/Steuern/PO/FO/Sonstige → = Netto-Cashflow.
// Garantie: der letzte Schritt (outValue) entspricht exakt series.net.total des Monats
// (Reconciliation by construction). Keine eigene Rechenlogik — nur Umgruppierung der computeSeries-Ausgabe.

export interface WaterfallStep {
  key: string;
  label: string;
  kind: "start" | "multiply" | "subtract" | "add" | "end";
  inValue: number;
  outValue: number;
  factor?: number;
  amount?: number;
  items?: Array<{ label: string; amount: number }>;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function outflowGroup(entry: Record<string, unknown>): { key: string; label: string; order: number } {
  const g = String(entry?.group || "");
  const src = String(entry?.source || "");
  const kind = String(entry?.kind || "");
  if (g === "Fixkosten") return { key: "fix", label: "− Fixkosten", order: 0 };
  if (/steuer/i.test(g) || /steuer|tax|ust|vat/i.test(kind) || /steuer|tax/i.test(src)) return { key: "steuern", label: "− Steuern", order: 1 };
  if (src === "po") return { key: "po", label: "− PO-Zahlungen", order: 2 };
  if (src === "fo") return { key: "fo", label: "− FO/PFO-Zahlungen", order: 3 };
  return { key: "sonstige-aus", label: "− Sonstige Ausgaben", order: 4 };
}

export function buildCashflowWaterfall(report: unknown, month: string): WaterfallStep[] {
  const rep = (report && typeof report === "object" ? report : {}) as Record<string, unknown>;
  const series = Array.isArray(rep.series) ? rep.series as Record<string, unknown>[] : [];
  const row = series.find((r) => String(r?.month) === String(month));
  if (!row) return [];
  const cash = ((rep.cashInByMonth as Record<string, Record<string, unknown>>) || {})[month] || {};
  const entries = Array.isArray(row.entries) ? row.entries as Record<string, unknown>[] : [];

  const brutto = num(cash.forecastRevenueRaw);
  const used = num(cash.appliedRevenue);
  const payoutComputed = num(cash.payout);
  const inflowTotal = num((row.inflow as Record<string, unknown>)?.total);
  const netTotal = num((row.net as Record<string, unknown>)?.total);

  const salesPayoutActual = entries
    .filter((e) => String(e?.kind) === "sales-payout" && String(e?.direction) === "in")
    .reduce((s, e) => s + Math.abs(num(e.amount)), 0);

  const steps: WaterfallStep[] = [];
  let running = brutto;
  steps.push({ key: "brutto", label: "Brutto-Umsatz (VO-Prognose)", kind: "start", inValue: brutto, outValue: brutto });

  // Realismus / Kalibrierung: Brutto -> verwendeter Umsatz
  if (Math.abs(used - brutto) > 0.5) {
    const factor = brutto > 0 ? used / brutto : 1;
    steps.push({ key: "kalibrierung", label: "Realismus / Kalibrierung", kind: "multiply", inValue: running, factor, outValue: used });
    running = used;
  } else {
    running = used || brutto;
  }

  // Auszahlungsquote: verwendeter Umsatz -> Sales-Cash-Eingang
  const quoteBase = running;
  const factor = quoteBase > 0 ? payoutComputed / quoteBase : 0;
  steps.push({ key: "quote", label: "Auszahlungsquote (Amazon-Gebühren / PPC / Retouren / Reserve)", kind: "multiply", inValue: running, factor, outValue: payoutComputed });
  running = payoutComputed;

  // Anpassung auf tatsächlichen Sales-Cash-Eingang (Rundung/Mix Kern+Plan)
  if (Math.abs(salesPayoutActual - running) > 1) {
    const delta = salesPayoutActual - running;
    steps.push({ key: "anpassung", label: "Anpassung auf Ist-Auszahlung", kind: delta >= 0 ? "add" : "subtract", inValue: running, amount: delta, outValue: salesPayoutActual });
  }
  running = salesPayoutActual;

  // + Sonstige Einzahlungen (USt-Erstattung, FO-Refunds u. a.)
  const otherIn = inflowTotal - salesPayoutActual;
  if (Math.abs(otherIn) > 0.5) {
    const items = entries
      .filter((e) => String(e?.direction) === "in" && String(e?.kind) !== "sales-payout")
      .map((e) => ({ label: String(e?.label || e?.kind || "Einzahlung"), amount: round2(Math.abs(num(e.amount))) }));
    steps.push({ key: "sonstige-ein", label: "+ Sonstige Einzahlungen (USt-Erstattung u. a.)", kind: "add", inValue: running, amount: otherIn, outValue: inflowTotal, items });
  }
  running = inflowTotal;

  // − Ausgaben-Gruppen (partitionieren outflow.total)
  const groups = new Map<string, { label: string; order: number; sum: number; items: Array<{ label: string; amount: number }> }>();
  entries.filter((e) => String(e?.direction) === "out").forEach((e) => {
    const { key, label, order } = outflowGroup(e);
    const g = groups.get(key) || { label, order, sum: 0, items: [] };
    const amt = Math.abs(num(e.amount));
    g.sum += amt;
    g.items.push({ label: String(e?.label || e?.kind || "Ausgabe"), amount: round2(amt) });
    groups.set(key, g);
  });
  Array.from(groups.entries())
    .sort((a, b) => a[1].order - b[1].order)
    .forEach(([key, g]) => {
      if (g.sum <= 0.5) return;
      const out = running - g.sum;
      steps.push({ key, label: g.label, kind: "subtract", inValue: running, amount: -g.sum, outValue: out, items: g.items });
      running = out;
    });

  steps.push({ key: "netto", label: "= Netto-Cashflow des Monats", kind: "end", inValue: running, outValue: netTotal });

  return steps.map((s) => ({
    ...s,
    inValue: round2(s.inValue),
    outValue: round2(s.outValue),
    amount: s.amount != null ? round2(s.amount) : undefined,
    factor: s.factor != null ? Math.round(s.factor * 10000) / 10000 : undefined,
  }));
}
