import { Card, Typography } from "antd";
import ReactECharts from "echarts-for-react";
import { buildCashflowWaterfall, type WaterfallStep } from "../domain/cashflowWaterfall";

const EUR = (v: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(v) || 0);

// Nachrechenbarer Monats-Wasserfall: Brutto-Umsatz (VO) → … → Netto-Cashflow.
// Reine Anzeige; Datenquelle ist buildCashflowWaterfall (rekonziliert per Konstruktion zum Netto-Balken).
export function CashflowWaterfall({ report, month, monthLabel }: { report: unknown; month: string; monthLabel?: string }) {
  const steps: WaterfallStep[] = month ? buildCashflowWaterfall(report, month) : [];
  if (!steps.length) {
    return (
      <Card size="small" style={{ marginTop: 12 }} title="Wie der Cashflow zustande kommt">
        <Typography.Text type="secondary">Wähle oben einen Monat (Klick auf einen Balken), um die Herleitung Brutto → Netto zu sehen.</Typography.Text>
      </Card>
    );
  }
  const cats = steps.map((s) => s.label);
  const floors: number[] = [];
  const bars: Array<{ value: number; itemStyle: { color: string } }> = [];
  steps.forEach((s) => {
    if (s.kind === "start" || s.kind === "end") {
      floors.push(0);
      bars.push({ value: s.outValue, itemStyle: { color: "#2f4b7c" } });
    } else {
      const hi = Math.max(s.inValue, s.outValue);
      const lo = Math.min(s.inValue, s.outValue);
      floors.push(lo);
      bars.push({ value: hi - lo, itemStyle: { color: s.outValue >= s.inValue ? "#3c9d4e" : "#c0392b" } });
    }
  });
  const netto = steps[steps.length - 1].outValue;

  const option = {
    grid: { left: 8, right: 16, top: 16, bottom: 110, containLabel: true },
    xAxis: { type: "category", data: cats, axisLabel: { interval: 0, rotate: 32, fontSize: 10, width: 96, overflow: "truncate" } },
    yAxis: { type: "value", axisLabel: { formatter: (v: number) => EUR(v) } },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: Array<{ dataIndex: number }>) => {
        const s = steps[params[0]?.dataIndex ?? 0];
        if (!s) return "";
        const op = s.kind === "multiply"
          ? `Faktor × ${s.factor}`
          : (s.amount != null ? `${s.amount > 0 ? "+" : ""}${EUR(s.amount)}` : "");
        let html = `<b>${s.label}</b>`;
        if (op) html += `<br/>${op}`;
        html += `<br/>Ergebnis: <b>${EUR(s.outValue)}</b>`;
        if (s.items && s.items.length) {
          html += "<br/><span style='font-size:11px;color:#888'>"
            + s.items.slice(0, 10).map((it) => `• ${it.label}: ${EUR(it.amount)}`).join("<br/>")
            + (s.items.length > 10 ? `<br/>… +${s.items.length - 10} weitere` : "")
            + "</span>";
        }
        return html;
      },
    },
    series: [
      { type: "bar", stack: "wf", silent: true, itemStyle: { color: "transparent" }, emphasis: { itemStyle: { color: "transparent" } }, data: floors },
      { type: "bar", stack: "wf", data: bars, label: { show: true, position: "top", fontSize: 9, formatter: (p: { dataIndex: number }) => EUR(steps[p.dataIndex].outValue) } },
    ],
  };

  return (
    <Card size="small" style={{ marginTop: 12 }} title={`Wie der Cashflow zustande kommt — ${monthLabel || month}`}>
      <Typography.Paragraph type="secondary" style={{ marginTop: 0, fontSize: 12 }}>
        Vom <strong>Brutto-Umsatz (VO-Prognose)</strong> zum <strong>Netto-Cashflow</strong>. Hover zeigt Rechnung + Einzelposten.
        Endwert <strong>{EUR(netto)}</strong> = der Netto-Balken im Chart oben (eingebaute Selbstkontrolle).
      </Typography.Paragraph>
      <ReactECharts option={option} style={{ height: 360 }} notMerge lazyUpdate />
    </Card>
  );
}
