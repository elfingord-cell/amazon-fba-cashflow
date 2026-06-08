// Tab „Radar": PO/FO-Bestellvorschläge (Phantom-FO) mit Dringlichkeit + Einplanen.
import { useMemo, useState, type JSX } from "react";
import type { CfpModel, CfpRadarItem } from "../../domain/cfpModel";
import { SegmentedControl } from "../components/primitives";
import { IconRadar } from "../components/icons";
import { formatCurrency, formatNumber, formatDayMonth, formatMonthLabel } from "../cfpFormat";

type RadarFilter = "all" | "now" | "soon";

function buildFoRoute(item: CfpRadarItem): string {
  const params = new URLSearchParams({
    source: "phantom_fo",
    sku: item.sku,
    phantomId: item.id,
    suggestedUnits: String(Math.max(0, Math.round(item.units))),
    firstRiskMonth: item.firstRiskMonth || "",
    orderMonth: item.orderMonth || "",
    returnTo: "/v2/dashboard",
  });
  return `/v2/orders/fo?${params.toString()}`;
}

export function RadarView({ model, onNavigate }: {
  model: CfpModel;
  onNavigate: (route: string) => void;
}): JSX.Element {
  const [filter, setFilter] = useState<RadarFilter>("all");
  const items = useMemo(() => {
    if (filter === "now") return model.radar.filter((entry) => entry.overdue);
    if (filter === "soon") return model.radar.filter((entry) => !entry.overdue);
    return model.radar;
  }, [filter, model.radar]);

  return (
    <>
      <div className="cfp-radar-hero">
        <span className="cfp-radar-hero-icon"><IconRadar size={20} /></span>
        <div className="cfp-radar-hero-main">
          <div className="cfp-radar-hero-label">Offenes Bestellvolumen</div>
          <div className="cfp-radar-hero-value cfp-num">
            {model.radarTotalValue != null ? formatCurrency(model.radarTotalValue) : `${model.radar.length} offen`}
          </div>
        </div>
        <div className="cfp-radar-hero-badge">
          <strong className="cfp-num">{model.radar.length}</strong>
          Vorschläge
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <SegmentedControl<RadarFilter>
          ariaLabel="Radar-Filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "Alle" },
            { value: "now", label: "Jetzt" },
            { value: "soon", label: "Demnächst" },
          ]}
        />
      </div>

      {items.length === 0 ? (
        <div className="cfp-empty">
          <span className="cfp-empty-icon"><IconRadar size={30} /></span>
          <span>Keine offenen Bestellvorschläge.</span>
        </div>
      ) : (
        items.map((item) => (
          <div className="cfp-radar-card" key={item.id}>
            <div className="cfp-radar-card-head">
              <div className="cfp-radar-tags">
                <span className="cfp-num">{item.sku}</span>
                <span className={`cfp-radar-urgency ${item.overdue ? "is-now" : "is-soon"}`}>
                  {item.overdue ? "Jetzt bestellen" : "Bald"}
                </span>
              </div>
              <span className="cfp-radar-value cfp-num">
                {item.value != null ? formatCurrency(item.value) : `${formatNumber(item.units)} Stk`}
              </span>
            </div>
            <div>
              <div className="cfp-radar-title">{item.alias}</div>
              <div className="cfp-radar-sub">
                {item.supplierId ? `${item.supplierId} · ` : ""}{formatNumber(item.units)} Stk
              </div>
            </div>
            <div className="cfp-radar-meta">
              <div className="cfp-radar-meta-item">
                <span className="cfp-radar-meta-label">Bestellen bis</span>
                <span className="cfp-radar-meta-value cfp-num">{formatDayMonth(item.latestOrderDate)}</span>
              </div>
              <div className="cfp-radar-meta-item">
                <span className="cfp-radar-meta-label">Ankunft</span>
                <span className="cfp-radar-meta-value cfp-num">
                  {item.requiredArrivalDate ? formatMonthLabel(item.requiredArrivalDate.slice(0, 7)) : "–"}
                </span>
              </div>
            </div>
            <div className="cfp-radar-card-foot">
              <span className="cfp-radar-reach cfp-num">
                {item.shortageUnits != null ? `Fehlmenge ${formatNumber(item.shortageUnits)} Stk` : "Vorschlag"}
              </span>
              <button type="button" className="cfp-btn-plan" onClick={() => onNavigate(buildFoRoute(item))}>
                Einplanen
              </button>
            </div>
          </div>
        ))
      )}
    </>
  );
}
