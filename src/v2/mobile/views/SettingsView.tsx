// Tab „Mehr"/Cockpit: Cash-in-Modus, Portfolio-Buckets, Kalibrierung,
// Werkzeug-Navigation in die übrigen V2-Module.
import type { JSX } from "react";
import type { CfpModel, CfpQuoteMode } from "../../domain/cfpModel";
import { CFP_BUCKET_OPTIONS } from "../../domain/cfpModel";
import { SegmentedControl, Toggle, BucketPill } from "../components/primitives";
import { IconCalibration, IconBuffer, IconChevron, IconUser } from "../components/icons";
import { formatCompactCurrency } from "../cfpFormat";

const BUFFER_STEP = 5000;

const MODULE_LINKS: Array<{ label: string; route: string }> = [
  { label: "Monatsplanung", route: "/v2/monatsplanung" },
  { label: "Bestellungen (PO/FO)", route: "/v2/orders/po" },
  { label: "Absatzprognose", route: "/v2/forecast" },
  { label: "Bestandsprojektion", route: "/v2/inventory/projektion" },
  { label: "Produkte", route: "/v2/products" },
  { label: "Einstellungen", route: "/v2/settings" },
];

export function SettingsView({ model, onQuoteMode, onToggleBucket, onCalibration, onSetBuffer, onNavigate }: {
  model: CfpModel;
  onQuoteMode: (mode: CfpQuoteMode) => void;
  onToggleBucket: (bucket: string, enabled: boolean) => void;
  onCalibration: (enabled: boolean) => void;
  onSetBuffer: (value: number) => void;
  onNavigate: (route: string) => void;
}): JSX.Element {
  const scope = new Set(model.cockpit.bucketScope);

  return (
    <>
      <div className="cfp-set-group">
        <div className="cfp-set-group-title">Cash-in-Modus</div>
        <div className="cfp-set-card cfp-set-pad">
          <SegmentedControl<CfpQuoteMode>
            ariaLabel="Cash-in-Modus"
            value={model.cockpit.quoteMode}
            onChange={onQuoteMode}
            options={[
              { value: "manual", label: "Manuell" },
              { value: "recommendation", label: "Empfehlung" },
            ]}
          />
          <div className="cfp-set-hint">
            {model.cockpit.quoteMode === "recommendation"
              ? "Auszahlungen werden anhand von Niveau, Saisonmuster und Sicherheitsmarge automatisch vorgeschlagen."
              : "Nutzt deine Monatswerte aus dem Cash-in-Setup."}
          </div>
        </div>
      </div>

      <div className="cfp-set-group">
        <div className="cfp-set-group-title">Portfolio-Buckets</div>
        <div className="cfp-set-card cfp-set-pad">
          <div className="cfp-set-pills">
            {CFP_BUCKET_OPTIONS.map((opt) => {
              const on = scope.has(opt.value);
              const lastOn = on && scope.size <= 1;
              return (
                <BucketPill
                  key={opt.value}
                  label={opt.label}
                  on={on}
                  disabled={lastOn}
                  onClick={() => onToggleBucket(opt.value, !on)}
                />
              );
            })}
          </div>
          <div className="cfp-set-hint">Bestimmt, welche Produktgruppen in Kontostand &amp; P&amp;L einfließen. Mindestens eine bleibt aktiv.</div>
        </div>
      </div>

      <div className="cfp-set-group">
        <div className="cfp-set-group-title">Planung</div>
        <div className="cfp-set-card">
          <div className="cfp-set-row">
            <span className="cfp-set-row-icon"><IconCalibration size={15} /></span>
            <span className="cfp-set-row-main">
              <span className="cfp-set-row-label">Auto-Kalibrierung</span>
              <span className="cfp-set-row-sub">Prognose an Ist-Zahlen anpassen</span>
            </span>
            <Toggle on={model.cockpit.calibrationEnabled} onChange={onCalibration} ariaLabel="Auto-Kalibrierung" />
          </div>
          <div className="cfp-set-row">
            <span className="cfp-set-row-icon"><IconBuffer size={15} /></span>
            <span className="cfp-set-row-main">
              <span className="cfp-set-row-label">Cash-Puffer</span>
              <span className="cfp-set-row-sub">Mindest-Liquidität für die Ampel</span>
            </span>
            <span className="cfp-stepper">
              <button type="button" aria-label="Cash-Puffer verringern" onClick={() => onSetBuffer(Math.max(0, model.cashBuffer - BUFFER_STEP))}>−</button>
              <span className="cfp-stepper-val cfp-num">{model.cashBuffer > 0 ? formatCompactCurrency(model.cashBuffer) : "aus"}</span>
              <button type="button" aria-label="Cash-Puffer erhöhen" onClick={() => onSetBuffer(model.cashBuffer + BUFFER_STEP)}>+</button>
            </span>
          </div>
          <button type="button" className="cfp-set-row" onClick={() => onNavigate("/v2/settings")}>
            <span className="cfp-set-row-icon"><IconBuffer size={15} /></span>
            <span className="cfp-set-row-main">
              <span className="cfp-set-row-label">Mindestbestand</span>
              <span className="cfp-set-row-sub">Lager-Sicherheitsbestand · in Einstellungen</span>
            </span>
            <span className="cfp-set-row-chev"><IconChevron size={16} /></span>
          </button>
        </div>
      </div>

      <div className="cfp-set-group">
        <div className="cfp-set-group-title">Werkzeuge</div>
        <div className="cfp-set-card">
          {MODULE_LINKS.map((link) => (
            <button key={link.route} type="button" className="cfp-set-row" onClick={() => onNavigate(link.route)}>
              <span className="cfp-set-row-main">
                <span className="cfp-set-row-label">{link.label}</span>
              </span>
              <span className="cfp-set-row-chev"><IconChevron size={16} /></span>
            </button>
          ))}
        </div>
      </div>

      <div className="cfp-set-group">
        <div className="cfp-set-card">
          <button type="button" className="cfp-set-row" onClick={() => onNavigate("/v2/settings")}>
            <span className="cfp-set-row-icon"><IconUser size={15} /></span>
            <span className="cfp-set-row-main">
              <span className="cfp-set-row-label">Konto &amp; Workspace</span>
              <span className="cfp-set-row-sub">Anmeldung, Sync &amp; Mitarbeiter</span>
            </span>
            <span className="cfp-set-row-chev"><IconChevron size={16} /></span>
          </button>
        </div>
      </div>
    </>
  );
}
