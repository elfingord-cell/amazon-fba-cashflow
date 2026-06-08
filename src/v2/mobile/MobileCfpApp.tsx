// Native CFP-Mobile-App: eigener Header + Bottom-Tab-Bar + 4 Views + Detail-Sheet.
// Wird vom Dashboard-Route nur auf Mobile gerendert; Desktop bleibt unberührt.
import { useMemo, useState, type JSX } from "react";
import { useNavigate } from "react-router-dom";
import "./mobile.css";
import { useMobileCfpModel } from "./useMobileCfpModel";
import { CFP_RANGE_OPTIONS, type CfpRange } from "../domain/cfpModel";
import { SegmentedControl } from "./components/primitives";
import { MonthSheet } from "./components/MonthSheet";
import { CashflowView } from "./views/CashflowView";
import { MonateView } from "./views/MonateView";
import { SettingsView } from "./views/SettingsView";
import {
  IconCashflow, IconMonate, IconMehr,
  IconBell, IconRefresh, IconCalendar, IconUser,
} from "./components/icons";

type Tab = "cashflow" | "monate" | "mehr";

const TABS: Array<{ key: Tab; label: string; Icon: (p: { size?: number }) => JSX.Element }> = [
  { key: "cashflow", label: "Cashflow", Icon: IconCashflow },
  { key: "monate", label: "Monate", Icon: IconMonate },
  { key: "mehr", label: "Mehr", Icon: IconMehr },
];

function actionLabel(Icon: (p: { size?: number }) => JSX.Element): string {
  if (Icon === IconRefresh) return "Aktualisieren";
  if (Icon === IconBell) return "Benachrichtigungen";
  if (Icon === IconCalendar) return "Kalender";
  if (Icon === IconUser) return "Konto";
  return "Aktion";
}

export default function MobileCfpApp(): JSX.Element {
  const navigate = useNavigate();
  const cfp = useMobileCfpModel();
  const [tab, setTab] = useState<Tab>("cashflow");
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);

  const selectedRow = useMemo(
    () => (selectedMonth ? cfp.model.rows.find((row) => row.month === selectedMonth) || null : null),
    [selectedMonth, cfp.model.rows],
  );

  const header = useMemo(() => {
    switch (tab) {
      case "monate":
        return { title: "Monate", sub: `${cfp.model.rows.length}-Monats-Vorschau · Endsaldo je Monat`, actions: [IconCalendar], showRange: true };
      case "mehr":
        return { title: "Cockpit", sub: "Einstellungen & Steuerung", actions: [IconUser], showRange: false };
      default:
        return { title: "Cashflow", sub: "mahona GmbH · Liquiditätsplanung", actions: [IconBell, IconRefresh], showRange: true };
    }
  }, [tab, cfp.model.rows.length]);

  function handleNavigate(route: string): void {
    navigate(route);
  }

  return (
    <div className="cfp-m">
      <header className={`cfp-appbar${scrolled ? " is-scrolled" : ""}`}>
        <div className="cfp-appbar-row">
          <div>
            <h1 className="cfp-appbar-title">{header.title}</h1>
            <p className="cfp-appbar-sub">{header.sub}</p>
          </div>
          <div className="cfp-appbar-actions">
            {header.actions.map((Icon, idx) => (
              <button
                key={idx}
                type="button"
                className="cfp-iconbtn"
                aria-label={actionLabel(Icon)}
                onClick={() => { if (Icon === IconRefresh) cfp.reload(); else if (Icon === IconUser) navigate("/v2/settings"); }}
              >
                <Icon size={18} />
              </button>
            ))}
          </div>
        </div>
        {header.showRange ? (
          <SegmentedControl<CfpRange>
            ariaLabel="Zeitraum"
            value={cfp.range}
            onChange={cfp.setRange}
            options={CFP_RANGE_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
          />
        ) : null}
      </header>

      <div className="cfp-scroll" onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}>
        {cfp.error ? (
          <div className="cfp-empty"><span>{cfp.error}</span></div>
        ) : cfp.loading && cfp.model.rows.length === 0 ? (
          <div className="cfp-empty"><span>Workspace wird geladen …</span></div>
        ) : (
          <>
            {tab === "cashflow" ? <CashflowView model={cfp.model} selectedMonth={selectedMonth} onSelectMonth={setSelectedMonth} /> : null}
            {tab === "monate" ? <MonateView model={cfp.model} onSelectMonth={setSelectedMonth} /> : null}
            {tab === "mehr" ? (
              <SettingsView
                model={cfp.model}
                onQuoteMode={cfp.setQuoteMode}
                onToggleBucket={cfp.toggleBucket}
                onCalibration={cfp.setCalibration}
                onNavigate={handleNavigate}
              />
            ) : null}
          </>
        )}
      </div>

      <nav className="cfp-tabbar">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            className={`cfp-tab${tab === key ? " is-active" : ""}`}
            aria-current={tab === key ? "page" : undefined}
            onClick={() => setTab(key)}
          >
            <span className="cfp-tab-icon"><Icon size={22} /></span>
            <span className="cfp-tab-label">{label}</span>
          </button>
        ))}
      </nav>

      {selectedRow ? (
        <MonthSheet
          row={selectedRow}
          bucketScope={cfp.model.cockpit.bucketScope}
          onClose={() => setSelectedMonth(null)}
          onNavigate={(month) => {
            setSelectedMonth(null);
            navigate(`/v2/monatsplanung?month=${encodeURIComponent(month)}`);
          }}
        />
      ) : null}
    </div>
  );
}
