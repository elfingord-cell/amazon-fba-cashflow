# CFP Mobile App — Design & Architecture Spec

**Date:** 2026-06-08
**Goal:** Eine eigene Mobile-Version des Cashflow Planners (CFP), die sich wie eine native Mobile-App anfühlt — kein auf Mobile gequetschtes Desktop. Die Desktop/Web-Version bleibt **byte-für-byte unverändert** und darf nicht schlechter werden.

Visuelles Design: erzeugt über **claude.ai/design** (Projekt „FBA Cashflow — Mobile App (CFP)"), abgenommen von Pierre, danach 1:1 in Code portiert.

---

## 1. Harte Constraints

1. **Desktop unverändert.** Der Render-Pfad von `src/v2/modules/dashboard/index.tsx` (DashboardModule) bleibt unangetastet. Einzige Berührung: routeCatalog zeigt auf einen dünnen Wrapper, der auf Desktop **exakt** `<DashboardModule/>` rendert.
2. **Nur V2.** V1 (src/ui/) wird nicht angefasst. (Memory: only_v2)
3. **Keine Datenlogik-Duplizierung der Wahrheit.** Mobile nutzt dieselben **puren Domain-Funktionen** wie Desktop (`computeSeries`, `buildMonthPlanningResult`, `aggregateDashboardMonthEntries`, Breakdown-Pipeline). Es wird **kein** Cashflow-Feld geschrieben (read-only Ansicht; nur Cockpit-Settings via bestehendem `saveWith`, identisch zum Desktop).
4. **CSS additiv & mobile-scoped.** Alle neuen Styles unter einem Root `.cfp-m` (oder `[data-cfp-mobile]`), damit Desktop-CSS nicht tangiert wird.

## 2. Erkennung Mobile vs. Desktop

Bereits vorhanden in `V2Shell.tsx`:
```ts
const screens = Grid.useBreakpoint();
const isDesktop = Boolean(screens.lg);   // lg ~= 992px+
const isMobile = !isDesktop;
```
Dieselbe Logik nutzt der Dashboard-Wrapper. Kein zusätzlicher Breakpoint-Mechanismus.

## 3. Architektur

```
src/v2/
  modules/dashboard/
    index.tsx                 # DESKTOP — unverändert
    DashboardRoute.tsx        # NEU: Grid.useBreakpoint().lg ? <DashboardModule/> : <MobileCfpApp/>
  domain/
    cfpModel.ts               # NEU: pure Orchestrierung -> liefert das komplette Mobile-Datenmodell
    cfpModel.test.ts          # NEU: Smoke/Fixture-Test
  mobile/
    MobileCfpApp.tsx          # NEU: Vollbild-App (eigene Chrome: Header + Bottom-Tab-Bar)
    useMobileCfpModel.ts      # NEU: Hook: useWorkspaceState + cfpModel + lokaler UI-State
    components/
      MobileHeader.tsx        # Sticky App-Bar (Titel, Zeitraum-Segmented)
      MobileTabBar.tsx        # Bottom-Tab-Bar: Cashflow / Monate / Radar / Mehr
      HeroLiquidityCard.tsx   # Kontostand groß, Endsaldo, Sparkline, Liquiditätslücken-Chip
      BalanceSparkline.tsx    # SVG-Sparkline (Saldo-Kurve, Nulllinie)
      KpiStrip.tsx            # Eingänge / Ausgänge / Netto
      MonthTimeline.tsx       # horizontal scrollbare Monats-Chips
      MonthCard.tsx           # Monatskarte (Netto groß, Endsaldo, In/Out-Splitbar, Status-Pill)
      MonthSheet.tsx          # Bottom-Sheet: Monats-Breakdown + Blocker (AntD Drawer placement=bottom)
      BreakdownRow.tsx        # Kategorie-Zeile (Eingänge/Ausgänge), expandierbar zu Line-Items
      StatusPill.tsx          # Robust / Blocker / Coverage-Status
      SettingsView.tsx        # „Mehr": Cockpit (Modus/Buckets/Kalibrierung) + Modul-Links + Sync/Account
    mobile.css                # ALLE Mobile-Styles, gescoped unter .cfp-m
```

### 3.1 Tabs (intern, app-like)
`MobileCfpApp` hält `activeTab`-State (kein Router-Churn): `cashflow | monate | radar | mehr`.
- **Cashflow:** Hero-Karte + Sparkline + KPI-Strip + Monats-Timeline + Liste der Monatskarten (zukünftige Monate). Tap auf Karte → `MonthSheet`.
- **Monate:** vollständige Liste aller sichtbaren Monate als Zeilen (Monat, Netto, Endsaldo, Status, Mini-Sparkline-Spalte); erster Negativmonat hervorgehoben.
- **Radar:** `phantomFoSuggestions` (Bestellvorschläge) + offene Blocker-Übersicht; Links in die Fach-Tabs.
- **Mehr:** Cockpit-Settings (Amazon-Quote Manuell/Empfohlen, Portfolio-Buckets, Kalibrierung) + Liste aller V2-Module (navigiert in die bestehende Ansicht) + Account/Workspace/Sync-Status.

### 3.2 Shell-Branch in V2Shell.tsx
Minimal-invasiver Branch:
- `isMobile && activeKey === 'dashboard'` → Outlet voll-bleed, **ohne** Desktop-Sider/Header/Drawer. `MobileCfpApp` besitzt den ganzen Viewport (eigener Header + Bottom-Bar).
- `isMobile && activeKey !== 'dashboard'` → bestehendes Mobile-Verhalten (Header + Drawer-Nav) bleibt, damit alle übrigen Module nutzbar bleiben.
- `isDesktop` → bestehendes Layout **unverändert**.

Der Desktop-JSX-Zweig wird nicht editiert; es wird nur ein neuer `if (isMobile …)`-Zweig vorangestellt.

## 4. Datenmodell: `cfpModel.ts`

Reine Funktion, spiegelt exakt die Pipeline aus `dashboard/index.tsx` (Querverweis im Kopfkommentar, „keep in sync"):

```
buildCfpModel(state, {
  range,               // 'next6'|'next12'|'next18'|'all'
  bucketScope,         // string[] (Default DEFAULT_V2_BUCKET_SCOPE)
  quoteMode,           // settings.cashInQuoteMode
  revenueBasisMode,    // settings.cashInRevenueBasisMode
  calibrationEnabled,  // settings.cashInCalibrationEnabled !== false
  showAllPastMonths,   // bool
}) => {
  months, visibleMonths, currentMonth,
  rows: [{ month, label, opening, closing, inflow, outflow, net,
           inflowSplit, outflowSplit, status, blockers[], robust }],
  totals: { inflow, outflow, net, minClosing },
  opening, firstNegativeMonth,
  phantomFoSuggestions, robustness,
}
```

Schritte (verbatim aus Desktop, nur als pure Funktion gekapselt):
1. `sharedPlanProjection = buildSharedPlanProductProjection({state})` → `dashboardSeriesState`
2. `requiredHorizon` aus range + settings (gleiche Formel)
3. `calculationState = applyDashboardCalculationOverrides(...) + {horizonMonths}`
4. `report = computeSeries(calculationState)`; `months`, `breakdown`
5. `cashInMirror = buildCashInPayoutMirrorByMonth({months, state: calculationState})`
6. `dashboardBreakdown = alignDashboardCashInToMirror(applyTaxInstancesToBreakdown(breakdown, state), cashInMirror)`
7. Visibility-Window (last-closed-Anker + future window) → `visibleMonths`
8. `visibleBreakdown = applyDashboardBucketScopeToBreakdown(filterByVisibleMonth(dashboardBreakdown), bucketScopeSet)`
9. `robustness = buildMonthPlanningResult({state, months: visibleMonths})`
10. Pro Monat: `aggregateDashboardMonthEntries(row.entries, {bucketScope, provisionalFoIds})` → inflow/outflow-Split
11. Totals: `closing` (Endsaldo), `net`, `inflow`, `outflow`, `minClosing`; `firstNegativeMonth = report.kpis.firstNegativeMonth`

Formatter (de-DE): `formatCurrency`, `formatSignedCurrency`, `formatPercent`, `formatMonthLabel` — werden in `mobile/` als kleine geteilte Utils gespiegelt (oder aus einem gemeinsamen util importiert).

## 5. Native-Feel-Details
- iOS-Statusbar-Safe-Area (`env(safe-area-inset-*)`), `100dvh`, Bottom-Bar mit `padding-bottom: env(safe-area-inset-bottom)`.
- Große, fette tabellarische Zahlen (`font-variant-numeric: tabular-nums`).
- Bottom-Sheet statt Side-Drawer; Drag-Handle; `border-radius` oben.
- Touch-Targets ≥ 44px; `:active`-Pressed-States; momentum-scroll.
- Mint-Gradient-Hero (#3BC2A7 → #2FB79C), Ink-Text (#0F1B2D), Status grün/rot/amber.
- Sparkline als leichtes Inline-SVG (kein ECharts auf Mobile → schlank & schnell).

## 6. Vorgehen (dynamic workflows)
- **Plan-Workflow:** Architektur verifizieren, Datei-Contracts festziehen.
- **Implement-Workflow:** parallele, unabhängige Komponenten (Sparkline, StatusPill, KpiStrip, MonthCard …) + serielles Zusammensetzen (App-Shell, Model-Hook, Route-Wrapper, Shell-Branch).
- **QC-Workflow (mehrstufig):**
  1. Desktop-Regression: build grün, `test:parity:dashboard`, `test:parity:routes`, `test:parity:responsive`; visueller Desktop-Diff (Dashboard unverändert).
  2. Mobile-Verifikation via Preview-Tools auf 390×844: Daten korrekt (== Desktop-Zahlen), Tabs/Sheet/Interaktionen, kein Console-Error.
  3. Adversarialer Review: „Wurde Desktop irgendwo berührt? Stimmen Mobile-Zahlen mit Desktop überein? Native-Feel ok?"

## 7. Risiken & Gegenmaßnahmen
- **Divergenz Mobile↔Desktop-Zahlen:** cfpModel spiegelt Desktop-Pipeline; Fixture-Test + QC-Vergleich.
- **Doppelte Header/Chrome:** Shell-Branch unterdrückt Desktop-Chrome nur für Mobile-Dashboard.
- **Andere Module auf Mobile:** bleiben im bestehenden Drawer-Shell erreichbar (kein Regress).
