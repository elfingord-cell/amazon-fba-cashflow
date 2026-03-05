# PFO Logic Audit

## Scope and active code paths

This audit describes the currently routed V2 implementation, not the legacy `src/ui/*` code. The active routes are defined in `src/v2/app/routeCatalog.ts`:

- Dashboard: `dashboard`
- Bestandsprojektion: `inventory/projektion`
- SKU-Planung: `sku-planung`
- Bestellungen: `orders/po`, `orders/fo`, `orders/pfo`, `orders/sku`

The implementation below is grounded in the V2 modules and the shared domain code they call.

## 1. What PO, FO and PFO mean in the current codebase

### PO

POs are persisted purchase-order records in `state.pos`.

- State shape: `src/v2/state/types.ts` -> `AppStateV2.pos`
- Main record builder: `src/v2/modules/po/index.tsx` -> `toPoRecord()`
- PO-from-FO conversion: `src/v2/domain/orderUtils.ts` -> `createPoFromFo()`, `createPoFromFos()`

Current PO record characteristics:

- Stored as real app state in `state.pos`
- Carries `poNo`, `supplierId`, `orderDate`, `etdManual`, `etaManual`, `items`, `milestones`, `paymentLog`, `archived`, etc.
- Used as a real financial object and as real inbound supply

### FO

FOs are persisted forecast-order records in `state.fos`.

- State shape: `src/v2/state/types.ts` -> `AppStateV2.fos`
- Main normalizer: `src/v2/domain/orderUtils.ts` -> `normalizeFoRecord()`
- Main module: `src/v2/modules/fo/index.tsx`

Current FO record characteristics:

- Stored as real app state in `state.fos`
- Planning statuses are `DRAFT` and `ACTIVE`: `src/v2/domain/orderUtils.ts` -> `isFoPlanningStatus()`
- Convertible statuses are the same: `src/v2/domain/orderUtils.ts` -> `isFoConvertibleStatus()`
- Converted or archived FOs remain in `state.fos` but are not planning FOs anymore

### PFO

There is no persisted `state.pfos` collection.

The current codebase has two different PFO-like concepts:

1. Synthetic phantom FO suggestions from `src/v2/domain/phantomFo.ts` -> `buildPhantomFoSuggestions()`
2. Inventory worklist entries in `src/v2/modules/inventory/index.tsx` -> `pfoWorklist` derived from `buildDashboardRobustness()`

The synthetic PFO suggestion is a `PhantomFoSuggestion` plus a synthetic `foRecord`:

- Builder: `src/v2/domain/phantomFo.ts` -> `buildSuggestionForIssue()`
- Synthetic FO flags:
  - `phantom: true`
  - `phantomSource: "robustness_order_duty_v2"`
  - `phantomStatus: "suggested"`
- Synthetic IDs:
  - `buildPhantomFoId()` -> `phantom-fo-*`
  - `buildPhantomFoNumber()` -> `PH-*`

Important current truth:

- PFOs are not first-class persisted records
- Auto-PFOs only exist as derived suggestions unless the user saves a real FO from them
- When a user saves such an FO, the saved record becomes a normal FO in `state.fos`; there is no persisted `phantom` flag path in `normalizeFoRecord()`

## 2. How each object is created, stored, displayed and consumed

| Object | Created by | Stored at | Displayed in | Consumed by |
| --- | --- | --- | --- | --- |
| PO | `src/v2/modules/po/index.tsx` -> `toPoRecord()`; FO conversion via `src/v2/modules/fo/index.tsx` -> `convertFo()`, `convertFoMerge()` calling `createPoFromFo()` / `createPoFromFos()` | `state.pos` | PO tab, Orders SKU timeline, Inventory inbound/projection, Dashboard cashflow/P&L/Kontostand | `src/domain/inventoryProjection.js` -> `buildInboundDetailMaps()`; `src/domain/cashflow.js` -> `computeSeries()`; `src/v2/domain/orderUtils.ts` -> `buildInboundBySku()` |
| FO | `src/v2/modules/fo/index.tsx` save flow using `normalizeFoRecord()`; can be opened prefilled from inventory or phantom routes | `state.fos` | FO tab, Orders SKU timeline, Inventory inbound/projection, Dashboard cashflow/P&L/Kontostand | `src/domain/inventoryProjection.js` -> `buildInboundDetailMaps()`; `src/domain/cashflow.js` -> `computeSeries()`; `src/v2/domain/orderUtils.ts` -> `buildInboundBySku()`; PO conversion in FO module |
| Auto PFO | `src/v2/domain/phantomFo.ts` -> `buildPhantomFoSuggestions()` | Not persisted as its own state key; only ephemeral suggestion objects | Dashboard tag and optional chart effect, Orders PFO tab, Orders SKU timeline, SKU-Planung | `src/v2/domain/phantomFo.ts` -> `buildStateWithPhantomFos()` for chaining/in-memory simulation; Dashboard optionally uses them in `computeSeries()` |
| Inventory PFO worklist entry | `src/v2/modules/inventory/index.tsx` -> `pfoWorklist` from `buildDashboardRobustness().months[].coverage.orderDutyIssues` | Not persisted as a PFO; only decisions are persisted | Bestandsprojektion “PFO-Arbeitsliste” | FO prefill flow; optional suppression via `settings.phantomFoWorklistDecisionById` |
| Manual SKU-Planung phantom | `src/v2/modules/sku-planning/index.tsx` -> `addManualPhantom()` | Local React state only: `manualPhantomsBySku` | SKU-Planung only | SKU-Planung simulation only |

## 3. Where the current system stores related state

Real order state:

- POs: `state.pos`
- FOs: `state.fos`

No first-class PFO state:

- There is no `state.pfos`

Risk acceptance state:

- `settings.phantomFoShortageAcceptBySku`
- Parsed in:
  - `src/v2/domain/dashboardRobustness.ts` -> `resolveShortageAcceptancesBySku()`
  - `src/v2/domain/phantomFo.ts` -> `resolveShortageAcceptancesBySku()`
  - `src/v2/modules/inventory/index.tsx` -> `resolveShortageAcceptancesBySku()`
  - `src/v2/modules/sku-planning/index.tsx` -> `resolveShortageAcceptancesBySku()`

Inventory worklist conversion decisions:

- `settings.phantomFoWorklistDecisionById`
- Read/write only in:
  - `src/v2/modules/inventory/index.tsx`
  - `src/v2/modules/fo/index.tsx`

Current acceptance key format:

- Builder name: `buildShortageAcceptanceStorageKey()`
- Format: `skuLower::reason::acceptedFromMonth`
- Stored fields:
  - `sku`
  - `reason`
  - `acceptedFromMonth`
  - `acceptedUntilMonth`
  - `durationMonths`

## 4. Which objects affect which views

| View / module | PO | FO | Auto PFO | Manual SKU phantom |
| --- | --- | --- | --- | --- |
| Dashboard robustness | Yes | Yes | No | No |
| Dashboard chart / P&L / Kontostand | Yes | Yes | Only if `settings.dashboardShowPhantomFoInChart === true` | No |
| Bestandsprojektion grid | Yes | Yes | No | No |
| Bestandsprojektion PFO-Arbeitsliste | Indirectly through robustness | Indirectly through robustness | No; it uses its own worklist source | No |
| SKU-Planung overview/detail | Yes | Yes | Yes, as overlay/simulation | Yes, local-only overlay |
| Orders tab `po` | Yes | No | No | No |
| Orders tab `fo` | No | Yes | No | No |
| Orders tab `pfo` | No | No | Yes | No |
| Orders tab `sku` | Yes | Yes | Yes | No |

Important implementation details:

- Dashboard chart/P&L/Kontostand path:
  - `src/v2/modules/dashboard/index.tsx`
  - `buildPhantomFoSuggestions()`
  - `buildStateWithPhantomFos()`
  - `computeSeries()`
- Dashboard robustness path is separate and always uses the real state:
  - `src/v2/modules/dashboard/index.tsx` -> `buildDashboardRobustness({ state: stateObject, months: visibleMonths })`
- Bestandsprojektion grid uses only real `state.pos` and `state.fos` through `src/domain/inventoryProjection.js` -> `computeInventoryProjection()`
- Orders FO tab rows are built only from real `state.fos`:
  - `src/v2/modules/fo/index.tsx` -> `rows`
- Orders PFO tab is read-only and uses only `buildPhantomFoSuggestions()`:
  - `src/v2/modules/orders/PfoListView.tsx`
- Orders SKU tab mixes real POs, real FOs and synthetic PFO `foRecord`s:
  - `src/v2/modules/orders/SkuTimelineView.tsx`
- SKU-Planung combines real projection data with auto suggestions and local manual phantom rows:
  - `src/v2/modules/sku-planning/index.tsx`

## 5. How “robuste Monate” are determined today

Primary function:

- `src/v2/domain/dashboardRobustness.ts` -> `buildDashboardRobustness()`

Current robustness checks per month:

- `sku_coverage`
- `cash_in`
- `fixcost`
- `vat`
- `revenue_inputs`

A month is robust only if all checks pass:

- `buildDashboardRobustness()` -> `const robust = checks.every((entry) => entry.passed);`

How the counters are derived:

- `robustMonthsCount`: counts all robust months in the evaluated list
- `robustUntilMonth`: only the last consecutive robust month from the start of the evaluated month list

Current non-robust conditions:

- Coverage is not `full` or `wide`
- No cash-in basis for the month: `monthHasCashIn()`
- No fixcost basis at all: `hasFixcostBasis`
- VAT active but not configured for the month: `isVatConfiguredForMonth()`
- Missing revenue basis:
  - price missing
  - product completeness blocked
  - `buildRevenueInputIssues()`

Coverage status logic:

- `src/v2/domain/dashboardRobustness.ts` -> `resolveCoverageStatus()`
- `full`: 100% coverage and no blockers
- `wide`: `>= 95%` coverage and no A/B blockers and no order-duty blocker
- `partial`: `>= 80%`, or `>= 95%` but with order-duty blocker
- `insufficient`: `< 80%` or any A/B blocker

Only `full` and `wide` count as passed coverage.

## 6. How stock risk, “Unter Safety” and “OOS” are detected

Base projection engine:

- `src/domain/inventoryProjection.js` -> `computeInventoryProjection()`

The projection row computes:

- `endAvailable`
- `safetyUnits`
- `doh`
- `safetyDays`
- `daysToOos`
- `oosDate`

Base safety classifier:

- `src/domain/inventoryProjection.js` -> `getProjectionSafetyClass()`

Current rule order in `getProjectionSafetyClass()`:

1. If `endAvailable <= 0` -> `safety-negative` -> OOS
2. Else if `daysToOos < safetyDays` -> `safety-low` -> Unter Safety
3. Else, if `daysToOos` was passed at all, legacy DOH/units fallback is skipped
4. Only when `daysToOos` is omitted by the caller do the fallback thresholds apply:
   - DOH fallback: `doh < safetyDays`
   - units fallback: `endAvailable < safetyUnits`

### What that means in the current views

#### Bestandsprojektion

- File: `src/v2/modules/inventory/index.tsx`
- Risk classification calls `getProjectionSafetyClass()` and passes `daysToOos`

Because `computeInventoryProjection()` always sets `daysToOos` to a number or `null`, the practical Bestandsprojektion rule is:

- OOS = `endAvailable <= 0`
- Unter Safety = `daysToOos < safetyDays`
- The `projectionMode` toggle does not restore legacy unit/DOH fallback while `daysToOos` is present

#### Dashboard robustness stock blockers

- File: `src/v2/domain/dashboardRobustness.ts`
- Function: `projectionRiskClassByDoh()`

This passes `projectionMode: "doh"` and also passes `daysToOos`.

So current dashboard stock blockers are effectively also:

- OOS = `endAvailable <= 0`
- Unter Safety = `daysToOos < safetyDays`

The additional dashboard-specific rule is the lookahead window:

- `resolveStockLookaheadDays()`
- Defaults:
  - non-DDP: `90` days
  - DDP: `35` days
- A month is blocked if the first unaccepted breach appears anywhere in that lookahead window

#### SKU-Planung

- File: `src/v2/modules/sku-planning/index.tsx`
- Function: `classifyRisk()`

This intentionally omits `daysToOos` and forces `projectionMode: "units"`.

So current SKU-Planung overview risk is:

- OOS = `endAvailable <= 0`
- Unter Safety = `endAvailable < safetyUnits`

This is not the same rule used by Bestandsprojektion or dashboard robustness.

### Direct answer: are risks based on Bestellmonat, Ankunftsmonat, DOH, Units, or something else?

Current code uses multiple mechanisms:

- Bestandsprojektion stock colors: effectively `endAvailable` + `daysToOos` vs `safetyDays`
- Dashboard stock robustness: effectively `endAvailable` + `daysToOos` vs `safetyDays`, plus lookahead window
- SKU-Planung overview: `endAvailable` vs `safetyUnits`
- Order-duty / PFO generation:
  - first detect the first future shortage month
  - treat that shortage month as the required arrival month
  - then back-calculate `latestOrderDate` and `orderMonth`

So order-duty risk is anchored to the first shortage month, not directly to an existing bestellmonat.

## 7. How “Bestellpflicht” / order-duty is detected

Main function:

- `src/v2/domain/dashboardRobustness.ts` -> `buildOrderDutyProfiles()`

Current logic:

1. Compute future inventory projection for active products
2. For each SKU, scan future months from `nowMonth`
3. Take the first future month with a shortage risk that is not already accepted
4. Resolve lead time with `resolveLeadTimeForProduct()`
5. Back-calculate:
   - `latestOrderDate`
   - `orderMonth`
   - `requiredArrivalDate = firstRiskMonth + "-01"`
6. Mark `overdue` if `orderMonth < nowMonth`

Important current behavior:

- One order-duty profile per SKU exists at a time inside `buildOrderDutyProfiles()`
- `shortageUnits` is calculated as `ceil(safetyUnits - endAvailable)` when those numbers are finite
- `recommendedOrderDate` is currently set equal to `latestOrderDate` in `buildOrderDutyProfiles()`

## 8. Current “Risiko akzeptieren” logic

### Where it is stored

Accepted shortage risk is stored in:

- `settings.phantomFoShortageAcceptBySku`

Inventory worklist conversion suppression is stored separately in:

- `settings.phantomFoWorklistDecisionById`

Current worklist-decision behavior:

- written only when an FO is saved from the inventory PFO worklist route:
  - `src/v2/modules/fo/index.tsx` -> save flow with `pendingPfoWorklistDecision`
- read only by the inventory module:
  - `src/v2/modules/inventory/index.tsx` -> `resolvePfoWorklistDecisionById()`
- suppresses only the inventory PFO worklist row with decision `fo_converted`
- no expiry logic was found
- does not suppress dashboard robustness
- does not suppress `buildPhantomFoSuggestions()`

### How long it lasts

There is no arbitrary-duration acceptance UI in the current code.

Current writer paths:

- Inventory worklist:
  - `src/v2/modules/inventory/index.tsx` -> `acceptPfoRisk()`
  - always writes exactly `1` month
- SKU-Planung:
  - `src/v2/modules/sku-planning/index.tsx` -> `acceptShortageForEntry()`
  - writes `1` or `2` months

Current acceptance anchor:

- `acceptedFromMonth = max(firstRiskMonth, currentMonth)`
- not `orderMonth`
- not exact order date

So the acceptance window is shortage-month based.

### What it suppresses

The same acceptance store suppresses:

- Dashboard stock blockers
- Dashboard order-duty blockers
- Phantom suggestion generation
- Inventory PFO worklist entries
- SKU-Planung overview blocker state
- SKU-Planung auto PFO suggestions

Current code paths:

- `src/v2/domain/dashboardRobustness.ts`
- `src/v2/domain/phantomFo.ts`
- `src/v2/modules/inventory/index.tsx`
- `src/v2/modules/sku-planning/index.tsx`

### What it does not suppress

It does not change the underlying inventory projection rows:

- Bestandsprojektion still computes the same `computeInventoryProjection()` result
- Cell colors / row values are not rewritten by acceptance state

### Does it affect robustness?

Yes.

Because `buildDashboardRobustness()` reads `settings.phantomFoShortageAcceptBySku` before building stock blockers and order-duty blockers, an acceptance can remove blockers and make a month robust.

## 9. How PFO generation works today

Primary function:

- `src/v2/domain/phantomFo.ts` -> `buildPhantomFoSuggestions()`

### 9.1 Issue detection

Issue detection is not direct inventory-cell scanning. It is built on top of dashboard robustness:

- `collectOrderDutyIssues()` calls `buildDashboardRobustness()`
- it reads `monthRow.coverage.orderDutyIssues`

That means auto PFO generation is driven by order-duty issues, not by a separate PFO-only engine.

### 9.2 Dedupe rules

Current selection key:

- `src/v2/domain/phantomFo.ts` -> `issueSelectionKey()`
- key = `sku|issueType|orderMonth|firstRiskMonth`

Current dedupe layers:

- `toIssueMapBySku()` keeps only the first issue per SKU within each robustness month row
- `collectOrderDutyIssues()` dedupes repeated month-row appearances by `issueSelectionKey()`
- `buildPhantomFoSuggestions()` dedupes final suggestions by synthetic suggestion ID and by existing FO IDs

### 9.3 One-per-SKU vs multiple-per-SKU

Current answer:

- At most one new suggestion per SKU per iteration
- Multiple suggestions per SKU are possible overall

Why:

- `blockedSkuKeys` blocks more than one suggestion for the same SKU in one iteration
- After each iteration, `buildStateWithPhantomFos()` appends the new synthetic FOs into a working state
- The engine then reruns issue detection on that updated in-memory state

This is already a PFO-chain mechanism.

### 9.4 Order-date rules

For each issue, `buildSuggestionForIssue()`:

- resolves lead time
- computes a schedule with `computeFoSchedule()`
- sets synthetic dates on `foRecord`

Current target dates:

- `requiredArrivalDate` defaults to `firstRiskMonth + "-01"`
- `recommendedOrderDate` prefers the issue’s `recommendedOrderDate`, which currently comes from `buildOrderDutyProfiles()` and equals `latestOrderDate`
- the synthetic FO also stores `orderDate`, `etdDate`, `etaDate`, `deliveryDate`

### 9.5 Past-date suppression

Past-dated PFOs are suppressed in the auto-PFO engine.

Files/functions:

- `src/v2/domain/phantomFo.ts` -> `isOrderDateBeforeLocalToday()`
- `src/v2/domain/phantomFo.ts` -> `buildSuggestionForIssue()`
- `src/v2/domain/phantomFo.ts` -> `buildStateWithPhantomFos()`

Current rule:

- If the derived order date is before local today, the suggestion is rejected

Then the engine adds a temporary one-month acceptance for that issue and reruns selection so it can move on to a later issue for the same SKU.

### 9.6 Horizon rules

Default month source:

- `src/v2/domain/phantomFo.ts` -> `resolveMonthList()`

Current rules:

- If caller provides `months`, use those
- Else use `currentMonthKey()` plus `settings.skuPlanningHorizonMonths`
- Allowed settings values are effectively `6`, `12`, `18`
- Fallback constant is `12`

Current max-suggestions-per-SKU:

- `resolveMaxSuggestionsPerSku()`
- uses `settings.skuPlanningMaxPhantomSuggestionsPerSku`
- fallback constant in the engine is `12`

Note:

- `src/v2/modules/settings/index.tsx` normalizes missing settings to `3`
- so UI default and engine fallback are different when the setting is absent

### 9.7 Do PFO chains already exist?

Yes.

Code proof:

- `src/v2/domain/phantomFo.ts` -> `buildPhantomFoSuggestions()`
- `workingState = buildStateWithPhantomFos({ state: workingState, suggestions: iterationSuggestions })`

That is an existing multi-iteration chain process.

## 10. Which view uses which selector/source of truth for PFOs

| View | Current PFO source of truth |
| --- | --- |
| Dashboard phantom count and optional financial simulation | `src/v2/modules/dashboard/index.tsx` -> `buildPhantomFoSuggestions()` |
| Dashboard robustness | `src/v2/domain/dashboardRobustness.ts` on real state only |
| Orders `pfo` tab | `src/v2/modules/orders/PfoListView.tsx` -> `buildPhantomFoSuggestions()` |
| Orders `sku` tab | `src/v2/modules/orders/SkuTimelineView.tsx` -> real `state.pos`, real `state.fos`, plus `buildPhantomFoSuggestions().map((entry) => entry.foRecord)` |
| SKU-Planung auto suggestions | `src/v2/modules/sku-planning/index.tsx` -> `buildPhantomFoSuggestions({ months: planningMonths })` |
| SKU-Planung manual phantoms | local component state `manualPhantomsBySku` only |
| Bestandsprojektion PFO-Arbeitsliste | `src/v2/modules/inventory/index.tsx` -> `buildDashboardRobustness(...).months[].coverage.orderDutyIssues` |

This is the main structural reason the current PFO behavior can diverge across modules: there is no single persisted PFO source of truth.

## 11. Why a PFO may appear in SKU-Planung but not in Bestandsprojektion

Current code-backed reasons:

1. Bestandsprojektion does not inject auto PFOs into the grid at all.
   - It projects only real `state.pos` and real `state.fos` through `computeInventoryProjection()`.
   - SKU-Planung shows phantom entries as a separate overlay/simulation.

2. Bestandsprojektion’s PFO list is not built from `buildPhantomFoSuggestions()`.
   - Inventory uses `buildDashboardRobustness().coverage.orderDutyIssues`.
   - SKU-Planung uses `buildPhantomFoSuggestions()`.

3. Inventory has no chain loop.
   - SKU-Planung auto suggestions can chain because `buildPhantomFoSuggestions()` appends synthetic FOs to a working state and reruns.
   - Inventory worklist only exposes current order-duty issues from the real state.

4. Inventory only shows a 6-month order window.
   - `src/v2/modules/inventory/index.tsx`
   - `pfoSourceMonths = monthRange(currentMonth, 18)`
   - `pfoWindowEndMonth = addMonths(currentMonth, 5)`
   - Items outside current month through current+5 are hidden from the worklist.

5. SKU-Planung can show local manual phantom entries.
   - `manualPhantomsBySku` never exists in Bestandsprojektion.

6. The auto-PFO engine can augment state with virtual plan products from `src/domain/planProducts.js` -> `buildPlanProductForecastRows()`.
   - `buildPhantomFoSuggestions()` adds virtual products/forecast rows before issue detection.
   - `buildDashboardRobustness()` on the real state does not do this.

## 12. Dashboard, P&L and Kontostand behavior

Primary files:

- `src/v2/modules/dashboard/index.tsx`
- `src/domain/cashflow.js` -> `computeSeries()`

Current behavior:

- PO payments always affect dashboard cashflow/P&L/Kontostand because `computeSeries()` iterates all `state.pos`
- FO payments affect dashboard cashflow/P&L/Kontostand only for planning FOs:
  - `src/domain/cashflow.js` -> `isActiveFoStatus()`
  - included: `DRAFT`, `ACTIVE`
  - excluded: `CONVERTED`, `ARCHIVED`
- PFO payments affect dashboard cashflow/P&L/Kontostand only when:
  - `settings.dashboardShowPhantomFoInChart === true`
  - then dashboard uses `planningState = buildStateWithPhantomFos(...)`
  - then `computeSeries(planningState)`

Current direct answer:

- Do PFOs affect P&L? Yes, but only under `settings.dashboardShowPhantomFoInChart === true`.
- Do PFOs affect Kontostand? Yes, under the same toggle.
- Do PFOs affect dashboard robustness? No. Robustness always reads the real `stateObject`.

## 13. Bestellungen tabs/views

File:

- `src/v2/modules/orders/index.tsx`

Current behavior by tab:

- `orders/po`
  - `PoModule`
  - real `state.pos`
- `orders/fo`
  - `FoModule`
  - real `state.fos` only
- `orders/pfo`
  - `PfoListView`
  - read-only derived `buildPhantomFoSuggestions()`
- `orders/sku`
  - `SkuTimelineView`
  - real POs + real FOs + synthetic phantom `foRecord`s

Important consequence:

- The FO tab is not a PFO source of truth
- The PFO tab is not persisted state
- The SKU tab is the only orders view that visually mixes all three

## 14. Contradictions / mismatches in the current implementation

### 14.1 PFOs are derived from two different engines

- Inventory: `src/v2/modules/inventory/index.tsx` -> `buildDashboardRobustness().coverage.orderDutyIssues`
- Dashboard / Orders PFO / Orders SKU / SKU-Planung: `src/v2/domain/phantomFo.ts` -> `buildPhantomFoSuggestions()`

This is the largest current inconsistency.

### 14.2 Dashboard financial simulation and dashboard robustness do not use the same state

- Financial simulation can use `planningState` with synthetic phantom FOs:
  - `src/v2/modules/dashboard/index.tsx` -> `buildStateWithPhantomFos()`
- Robustness always uses real state:
  - `src/v2/modules/dashboard/index.tsx` -> `buildDashboardRobustness({ state: stateObject, ... })`

So the same dashboard can show PFO-adjusted P&L/Kontostand while robustness still reflects no PFO.

### 14.3 Bestandsprojektion and SKU-Planung do not use the same risk rule

- Bestandsprojektion passes `daysToOos` into `getProjectionSafetyClass()`
- SKU-Planung `classifyRisk()` intentionally omits `daysToOos` and forces units mode

So “Unter Safety” is not computed the same way in those two places.

### 14.4 Projection mode is local in inventory but read from persisted inventory settings in robustness

- Inventory UI keeps `projectionMode` in local React state:
  - `src/v2/modules/inventory/index.tsx` -> `const [projectionMode, setProjectionMode] = useState("units")`
- Robustness reads:
  - `src/v2/domain/dashboardRobustness.ts` -> `resolveProjectionModeForCoverage(state)`
  - from `state.inventory.settings.projectionMode`

No local writer for `state.inventory.settings.projectionMode` was found in the audited V2 modules.

### 14.5 Past-date suppression differs

- Auto-PFO engine suppresses exact past order dates:
  - `src/v2/domain/phantomFo.ts`
- Inventory worklist filters only by `orderMonth` range:
  - `src/v2/modules/inventory/index.tsx`

So an inventory worklist item can still appear in the current month even if the exact recommended order date is already in the past.

### 14.6 Chain support differs

- Auto-PFO engine: chains exist
- Inventory worklist: no chain loop

### 14.7 Horizon rules differ

- Auto-PFO engine: caller months or `skuPlanningHorizonMonths`
- Inventory worklist: fixed 18-month source scan, but only shows current month through current+5
- Dashboard chart horizon: `computeSeries()` uses `settings.startMonth` and `settings.horizonMonths`

These are three different horizon systems.

### 14.8 Virtual plan products can affect auto-PFO generation but not inventory worklist

- `buildPhantomFoSuggestions()` injects virtual plan products from `buildPlanProductForecastRows()`
- `buildDashboardRobustness()` on the real state does not

So auto-PFO generation can see cases that inventory worklist never sees.

### 14.9 SKU-Planung manual phantoms are local-only

- `manualPhantomsBySku` exists only in `src/v2/modules/sku-planning/index.tsx`

They affect only SKU-Planung simulation and nothing else.

### 14.10 PO inclusion differs across financial and inventory code paths

- `src/domain/inventoryProjection.js` -> `buildInboundDetailMaps()` excludes archived and cancelled POs
- `src/v2/domain/orderUtils.ts` -> `buildInboundBySku()` excludes archived POs but does not explicitly exclude cancelled POs
- `src/domain/cashflow.js` -> `computeSeries()` iterates all `state.pos` without an archived/cancelled filter

So PO inclusion is not aligned across all consumers.

### 14.11 Inventory worklist suppression ID is not the synthetic phantom ID

- Auto-PFO synthetic ID: `phantom-fo-*`
- Inventory worklist decision key: `sku|issueType|orderMonth|firstRiskMonth`

`settings.phantomFoWorklistDecisionById` suppresses inventory worklist rows only; it is not the same identity model as the synthetic PFO engine.

## 15. Current system truth in 10 bullets

1. POs are real persisted records in `state.pos`; FOs are real persisted records in `state.fos`; PFOs are derived suggestions, not a persisted state collection.
2. The app currently has two different PFO pipelines: the synthetic phantom engine in `buildPhantomFoSuggestions()` and the inventory worklist built from `buildDashboardRobustness()`.
3. Bestandsprojektion does not project PFOs into the grid; it only shows real POs and real FOs plus a separate PFO worklist.
4. SKU-Planung does show PFOs, but as overlay/simulation data; it can also show local manual phantom entries that no other view knows about.
5. Dashboard P&L and Kontostand include PFOs only when `settings.dashboardShowPhantomFoInChart === true`.
6. Dashboard robustness never includes synthetic PFOs, even when the chart does.
7. Accepted risk is stored in `settings.phantomFoShortageAcceptBySku` and is shortage-month based, not order-month based.
8. Accepted risk suppresses blockers and PFO generation, and it can make a month robust, but it does not rewrite the underlying projection cells.
9. Auto-PFO generation already supports chains: one suggestion per SKU per iteration, but multiple suggestions per SKU across iterations.
10. A PFO can appear in SKU-Planung and not in Bestandsprojektion because those modules do not read the same PFO source, do not use the same horizon, and Bestandsprojektion never injects phantom suggestions into its grid.

## Known ambiguities

- `state.inventory.settings.projectionMode` is read by `buildDashboardRobustness()`, but no writer for that field was found in the audited V2 modules. It may still be populated by imported or migrated state; that write path is unclear from code.
- Legacy `src/ui/*` files still contain older logic for related domains, but the current routed implementation points to the V2 modules listed at the top of this report. This audit therefore treats the V2 routes plus their shared domain dependencies as the current system.
