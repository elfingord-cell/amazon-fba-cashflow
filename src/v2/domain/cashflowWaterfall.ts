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
  explain?: string;
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
  if (g === "Fixkosten") return { key: "fix", label: "Fixkosten", order: 0 };
  if (/steuer/i.test(g) || /steuer|tax|ust|vat/i.test(kind) || /steuer|tax/i.test(src)) return { key: "steuern", label: "Steuern", order: 1 };
  if (src === "po") return { key: "po", label: "Wareneinkauf (PO)", order: 2 };
  if (src === "fo") return { key: "fo", label: "Wareneinkauf geplant (FO)", order: 3 };
  return { key: "sonstige-aus", label: "Sonstige Ausgaben", order: 4 };
}

// row: eine (steuer-augmentierte) Breakdown-/Series-Zeile mit `entries` (Ein-/Auszahlungen inkl. Steuern).
// cashIn: report.cashInByMonth[month] für die Einkommens-Zerlegung (Brutto/Kalibrierung/Quote).
// Alle Summen werden AUS DEN EINTRÄGEN gerechnet → identisch mit der PnL-Aggregation (inkl. Steuern).
export function buildCashflowWaterfall(row: unknown, cashIn?: unknown): WaterfallStep[] {
  const r = (row && typeof row === "object" ? row : null) as Record<string, unknown> | null;
  if (!r) return [];
  const cash = (cashIn && typeof cashIn === "object" ? cashIn : {}) as Record<string, unknown>;
  const entries = Array.isArray(r.entries) ? r.entries as Record<string, unknown>[] : [];

  const brutto = num(cash.forecastRevenueRaw);
  const used = num(cash.appliedRevenue);
  const payoutComputed = num(cash.payout);
  // Summen konsequent aus den Einträgen (so wie die PnL-Matrix sie aggregiert):
  const inflowTotal = entries
    .filter((e) => String(e?.direction) === "in")
    .reduce((s, e) => s + Math.abs(num(e.amount)), 0);

  const salesPayoutActual = entries
    .filter((e) => String(e?.kind) === "sales-payout" && String(e?.direction) === "in")
    .reduce((s, e) => s + Math.abs(num(e.amount)), 0);

  const steps: WaterfallStep[] = [];
  let running = brutto;
  steps.push({ key: "brutto", label: "Brutto-Umsatz (Prognose)", kind: "start", inValue: brutto, outValue: brutto, explain: "Prognostizierter Brutto-Umsatz des Monats (VentoryOne-Forecast, auf Basis der aktuellen Verkaufsgeschwindigkeit je Produkt)." });

  // Realismus / Kalibrierung: Brutto -> verwendeter Umsatz
  if (Math.abs(used - brutto) > 0.5) {
    const factor = brutto > 0 ? used / brutto : 1;
    const pctDe = (v: number) => (Math.round(v * 1000) / 10).toLocaleString("de-DE", { maximumFractionDigits: 1 });
    steps.push({
      key: "kalibrierung",
      label: "Realismus-Korrektur",
      kind: "multiply",
      inValue: running,
      factor,
      amount: round2(used - brutto),
      outValue: used,
      explain: `Aus abgeschlossenen Monaten gelernt: der Ist-Umsatz lag im Schnitt bei ${pctDe(factor)} % der Prognose, daher wird der Forecast um ${pctDe(Math.abs(1 - factor))} % ${factor < 1 ? "gekürzt" : "angehoben"}. Für weiter entfernte Monate nähert sich der Faktor 100 %.`,
    });
    running = used;
  } else {
    running = used || brutto;
  }

  // Auszahlungsquote: verwendeter Umsatz -> Sales-Cash-Eingang
  const quoteBase = running;
  const factor = quoteBase > 0 ? payoutComputed / quoteBase : 0;
  const quotePctDe = (Math.round(factor * 1000) / 10).toLocaleString("de-DE", { maximumFractionDigits: 1 });
  steps.push({
    key: "quote",
    label: "Amazon-Abzüge",
    kind: "multiply",
    inValue: running,
    factor,
    amount: round2(payoutComputed - running),
    outValue: payoutComputed,
    explain: `Auszahlungsquote ${quotePctDe} %: Anteil des Umsatzes, der nach Amazon-Gebühren, PPC, Retouren & Reserve tatsächlich als Auszahlung ankommt (empfohlen aus der Ist-Historie). Abzug = Gebühren, Werbung & Retouren.`,
  });
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
    steps.push({ key: "sonstige-ein", label: "Sonstige Einzahlungen", kind: "add", inValue: running, amount: otherIn, outValue: inflowTotal, items, explain: "Zusätzliche Geldeingänge neben der Amazon-Auszahlung (z. B. USt-Erstattung, FO-Rückzahlungen)." });
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

  steps.push({ key: "netto", label: "Netto-Cashflow", kind: "end", inValue: running, outValue: running, explain: "Was am Monatsende real auf dem Konto übrig bleibt — entspricht exakt dem Netto-Balken im Chart oben." });

  return steps.map((s) => ({
    ...s,
    inValue: round2(s.inValue),
    outValue: round2(s.outValue),
    amount: s.amount != null ? round2(s.amount) : undefined,
    factor: s.factor != null ? Math.round(s.factor * 10000) / 10000 : undefined,
  }));
}
