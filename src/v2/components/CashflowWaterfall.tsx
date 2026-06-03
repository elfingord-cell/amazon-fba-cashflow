import { useEffect, useRef } from "react";
import { Card, Typography } from "antd";
import ReactECharts from "echarts-for-react";
import { buildCashflowWaterfall, type WaterfallStep } from "../domain/cashflowWaterfall";
import { v2ChartPalette } from "../app/chartPalette";

const EUR0 = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const EUR = (v: number) => EUR0.format(Number(v) || 0);
// Kompakte Achsen-/Label-Notation: 133.279 -> "133,3 T", 1.250 -> "1,3 T", 1.250.000 -> "1,25 Mio"
const EURk = (v: number) => {
  const n = Number(v) || 0;
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toLocaleString("de-DE", { maximumFractionDigits: 2 })} Mio`;
  if (abs >= 1_000) return `${(n / 1_000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} T`;
  return `${Math.round(n)}`;
};
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${EUR(Math.abs(v))}`;
const signedK = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${EURk(Math.abs(v))}`;

// Farb-Mapping: Kostenarten konsistent zum Haupt-Cashflow-Chart (Fix=Taupe, Steuern=Amber, PO=Rot, FO=Violett),
// Umsatz-Realisierung (Kalibrierung/Amazon-Abzüge) neutral, Start/Ende = Marke/Ergebnis.
function colorForStep(step: WaterfallStep): string {
  switch (step.key) {
    case "brutto": return v2ChartPalette.brandNavy;
    case "netto": return step.outValue >= 0 ? v2ChartPalette.success : v2ChartPalette.danger;
    case "kalibrierung": return v2ChartPalette.slateLight;
    case "quote": return v2ChartPalette.slate;
    case "sonstige-ein": return v2ChartPalette.successSoft;
    case "anpassung": return v2ChartPalette.slateLight;
    case "fix": return v2ChartPalette.taupe;
    case "steuern": return v2ChartPalette.warning;
    case "po": return v2ChartPalette.danger;
    case "fo": return v2ChartPalette.violet;
    default: return v2ChartPalette.slate;
  }
}

function operationLabel(step: WaterfallStep): string {
  if (step.kind === "start") return "Ausgangswert";
  if (step.kind === "end") return "Endergebnis";
  if (step.kind === "multiply") {
    const pct = step.factor != null ? Math.round(step.factor * 1000) / 10 : null;
    const amt = step.amount != null ? ` (${signed(step.amount)})` : "";
    return pct != null ? `× ${String(pct).replace(".", ",")} %${amt}` : "";
  }
  return step.amount != null ? signed(step.amount) : "";
}

// Wie der Cashflow zustande kommt: Brutto-Umsatz (Prognose) → … → Netto-Cashflow.
// Balken = Veränderung je Schritt, Linie = laufender Saldo (Soll-Höhe). Rekonziliert per Konstruktion zum Netto-Balken oben.
export function CashflowWaterfall({ row, cashIn, monthLabel }: { row: unknown; cashIn?: unknown; monthLabel?: string }) {
  const steps: WaterfallStep[] = row ? buildCashflowWaterfall(row, cashIn) : [];
  if (!steps.length) {
    return (
      <Card size="small" style={{ marginTop: 12 }} title="Wie der Cashflow zustande kommt">
        <Typography.Text type="secondary">Wähle oben einen Monat (Klick auf einen Balken), um die Herleitung Brutto → Netto zu sehen.</Typography.Text>
      </Card>
    );
  }

  const cats = steps.map((s) => s.label);
  const maxVal = Math.max(...steps.map((s) => Math.max(s.inValue, s.outValue, 0)));

  // Schwebende Balken: floor (transparent) + sichtbarer Balken (Betrag der Veränderung bzw. Gesamthöhe bei Start/Ende).
  const floor: number[] = [];
  const barData: Array<{ value: number; itemStyle: { color: string; borderColor: string; borderWidth: number; borderRadius: number[] } }> = [];
  const deltaLabel: string[] = [];
  steps.forEach((s) => {
    const isTotal = s.kind === "start" || s.kind === "end";
    const lo = isTotal ? 0 : Math.min(s.inValue, s.outValue);
    const hi = isTotal ? s.outValue : Math.max(s.inValue, s.outValue);
    floor.push(lo);
    const color = colorForStep(s);
    barData.push({
      value: Math.max(hi - lo, 0),
      itemStyle: { color, borderColor: color, borderWidth: 0, borderRadius: [3, 3, 3, 3] },
    });
    deltaLabel.push(isTotal ? EURk(s.outValue) : signedK(Number(s.amount ?? (s.outValue - s.inValue))));
  });

  // Laufender Saldo (Soll-Höhe) als Verlaufslinie über die Balken.
  const running = steps.map((s) => Math.round(s.outValue));

  const option = {
    grid: { left: 8, right: 18, top: 28, bottom: 116, containLabel: true },
    xAxis: {
      type: "category",
      data: cats,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: v2ChartPalette.axisLine } },
      axisLabel: { interval: 0, rotate: 30, fontSize: 11, color: v2ChartPalette.textMuted, width: 110, overflow: "break", lineHeight: 13 },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: v2ChartPalette.gridLine } },
      axisLabel: { formatter: (v: number) => EURk(v), color: v2ChartPalette.textSubtle, fontSize: 11 },
      max: Math.ceil((maxVal * 1.12) / 1000) * 1000 || undefined,
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      borderColor: v2ChartPalette.gridLineStrong,
      textStyle: { fontSize: 12 },
      formatter: (params: Array<{ dataIndex: number }>) => {
        const idx = params?.[0]?.dataIndex ?? 0;
        const s = steps[idx];
        if (!s) return "";
        const accent = colorForStep(s);
        let html = `<div style="font-weight:600;margin-bottom:2px">${s.label}</div>`;
        const op = operationLabel(s);
        if (op) html += `<div style="color:${accent};font-weight:600">${op}</div>`;
        html += `<div style="margin-top:4px">Saldo danach: <b>${EUR(s.outValue)}</b></div>`;
        if (s.explain) {
          html += `<div style="margin-top:6px;max-width:320px;white-space:normal;font-size:11px;color:${v2ChartPalette.textMuted};line-height:1.45">${s.explain}</div>`;
        }
        if (s.items && s.items.length) {
          const top = s.items.slice().sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 8);
          html += `<div style="margin-top:6px;font-size:11px;color:${v2ChartPalette.textMuted}">`
            + top.map((it) => `<div style="display:flex;justify-content:space-between;gap:16px"><span>${it.label}</span><span>${EUR(it.amount)}</span></div>`).join("")
            + (s.items.length > top.length ? `<div style="opacity:.7">… +${s.items.length - top.length} weitere</div>` : "")
            + `</div>`;
        }
        return html;
      },
    },
    series: [
      {
        name: "floor",
        type: "bar",
        stack: "wf",
        silent: true,
        itemStyle: { color: "transparent" },
        emphasis: { itemStyle: { color: "transparent" } },
        tooltip: { show: false },
        data: floor,
        z: 2,
      },
      {
        name: "Veränderung",
        type: "bar",
        stack: "wf",
        barWidth: "52%",
        data: barData,
        z: 3,
        label: {
          show: true,
          position: "top",
          distance: 4,
          fontSize: 11,
          fontWeight: 600,
          color: v2ChartPalette.textStrong,
          formatter: (p: { dataIndex: number }) => deltaLabel[p.dataIndex],
        },
      },
      {
        name: "Laufender Saldo",
        type: "line",
        step: "middle",
        symbol: "circle",
        symbolSize: 5,
        showSymbol: true,
        data: running,
        z: 4,
        lineStyle: { color: v2ChartPalette.brandNavy, width: 1.5, type: "dashed", opacity: 0.55 },
        itemStyle: { color: v2ChartPalette.brandNavy },
        label: {
          show: true,
          position: "bottom",
          distance: 6,
          fontSize: 10,
          color: v2ChartPalette.brandNavy,
          backgroundColor: "rgba(255,255,255,0.78)",
          padding: [1, 3, 1, 3],
          borderRadius: 3,
          // Start/Ende sind bereits als Gesamtwert am Balken beschriftet -> Saldo-Label dort ausblenden.
          formatter: (p: { dataIndex: number }) => (
            (p.dataIndex === 0 || p.dataIndex === running.length - 1) ? "" : EURk(running[p.dataIndex])
          ),
        },
      },
    ],
  };

  const netto = steps[steps.length - 1].outValue;

  return (
    <Card size="small" style={{ marginTop: 12 }} title={`Wie der Cashflow zustande kommt — ${monthLabel || ""}`}>
      <Typography.Paragraph type="secondary" style={{ marginTop: 0, marginBottom: 4, fontSize: 12 }}>
        Vom <strong>Brutto-Umsatz (Prognose)</strong> zum <strong>Netto-Cashflow</strong>: jeder Balken zeigt die
        Veränderung, die gestrichelte Linie den <strong>laufenden Saldo</strong> (= aktuelle Höhe). Hover zeigt Rechnung,
        Herkunft &amp; Einzelposten. Endwert <strong>{EUR(netto)}</strong> = der Netto-Balken im Chart oben (eingebaute Selbstkontrolle).
      </Typography.Paragraph>
      <WaterfallChart option={option} rerenderKey={monthLabel || "wf"} />
    </Card>
  );
}

// Eigenständiger Chart-Wrapper mit ResizeObserver: ECharts wird unter dem Fold/in Cards
// gelegentlich mit falscher Größe initialisiert und malt die Serien erst nach einem Resize.
// Der Observer erzwingt ein resize(), sobald der Container seine echte Größe hat -> rendert zuverlässig beim Laden.
function WaterfallChart({ option, rerenderKey }: { option: unknown; rerenderKey: string }) {
  const chartRef = useRef<ReactECharts>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      const inst = chartRef.current?.getEchartsInstance?.();
      if (inst) inst.resize();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={wrapRef} style={{ width: "100%" }}>
      <ReactECharts
        key={rerenderKey}
        ref={chartRef}
        option={option as Record<string, unknown>}
        notMerge
        style={{ height: 420 }}
        opts={{ renderer: "canvas" }}
        onChartReady={(inst: { resize: () => void }) => { setTimeout(() => inst.resize(), 0); }}
      />
    </div>
  );
}
