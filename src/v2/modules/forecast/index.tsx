import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import type { ColumnDef } from "@tanstack/react-table";
import { parseDeNumber } from "../../../lib/dataHealth.js";
import { parseVentoryCsv } from "../../../ui/forecastCsv.js";
import { TanStackGrid } from "../../components/TanStackGrid";
import { currentMonthKey, formatMonthLabel, normalizeMonthKey } from "../../domain/months";
import {
  type ForecastRecord,
  type ForecastViewMode,
  type ManualMap,
  type ForecastProductRow as ProductRow,
  buildCategoryLabelMap,
  buildForecastMonths,
  buildForecastProducts,
  buildForecastRevenueByMonth,
  deriveForecastValue,
  filterForecastProducts,
  getEffectiveUnits,
  getImportValue,
  isForecastProductActive,
  normalizeManualMap,
  serializeManualMap,
} from "../../domain/tableModels";
import { ensureAppStateV2 } from "../../state/appState";
import { useWorkspaceState } from "../../state/workspace";

const { Paragraph, Text, Title } = Typography;

type ForecastRangeMode = "next6" | "next12" | "next18" | "all";

const RANGE_OPTIONS: Array<{ value: ForecastRangeMode; label: string; count: number | null }> = [
  { value: "next6", label: "Nächste 6", count: 6 },
  { value: "next12", label: "Nächste 12", count: 12 },
  { value: "next18", label: "Nächste 18", count: 18 },
  { value: "all", label: "Alle", count: null },
];

function ensureForecastContainers(state: Record<string, unknown>): void {
  if (!state.forecast || typeof state.forecast !== "object") {
    state.forecast = {
      items: [],
      settings: { useForecast: false },
      forecastImport: {},
      forecastManual: {},
      lastImportAt: null,
      importSource: null,
    };
  }
  const forecast = state.forecast as Record<string, unknown>;
  if (!forecast.settings || typeof forecast.settings !== "object") {
    forecast.settings = { useForecast: false };
  }
  if (!forecast.forecastImport || typeof forecast.forecastImport !== "object") {
    forecast.forecastImport = {};
  }
  if (!forecast.forecastManual || typeof forecast.forecastManual !== "object") {
    forecast.forecastManual = {};
  }
}

function formatMoneyState(value: number): string {
  return Number(value || 0).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDisplay(value: number | null, digits = 0): string {
  if (!Number.isFinite(value as number)) return "—";
  return Number(value).toLocaleString("de-DE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export default function ForecastModule(): JSX.Element {
  const { state, loading, saving, error, lastSavedAt, saveWith } = useWorkspaceState();
  const [search, setSearch] = useState("");
  const [range, setRange] = useState<ForecastRangeMode>("next12");
  const [view, setView] = useState<ForecastViewMode>("units");
  const [onlyActive, setOnlyActive] = useState(true);
  const [onlyWithForecast, setOnlyWithForecast] = useState(false);
  const [manualDraft, setManualDraft] = useState<ManualMap>({});
  const [manualDirty, setManualDirty] = useState(false);
  const [importRecords, setImportRecords] = useState<ForecastRecord[]>([]);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importError, setImportError] = useState("");
  const [importMode, setImportMode] = useState<"merge" | "overwrite">("merge");
  const [importOnlyActive, setImportOnlyActive] = useState(true);
  const [importSourceLabel, setImportSourceLabel] = useState("");
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferSelection, setTransferSelection] = useState<string[]>([]);

  const settings = (state.settings || {}) as Record<string, unknown>;
  const forecast = (state.forecast || {}) as Record<string, unknown>;
  const forecastImport = (forecast.forecastImport || {}) as Record<string, unknown>;
  const stateObject = state as unknown as Record<string, unknown>;

  useEffect(() => {
    setManualDraft(normalizeManualMap((forecast.forecastManual || {}) as Record<string, unknown>));
    setManualDirty(false);
  }, [forecast.forecastManual]);

  const allMonths = useMemo(() => {
    return buildForecastMonths(settings);
  }, [settings.horizonMonths, settings.startMonth]);

  const visibleMonths = useMemo(() => {
    const option = RANGE_OPTIONS.find((entry) => entry.value === range);
    if (!option || option.count == null) return allMonths;
    return allMonths.slice(0, option.count);
  }, [allMonths, range]);

  const categoriesById = useMemo(() => {
    return buildCategoryLabelMap(stateObject);
  }, [stateObject]);

  const products = useMemo(() => {
    return buildForecastProducts(stateObject, categoriesById);
  }, [categoriesById, stateObject]);

  const filteredProducts = useMemo(() => {
    return filterForecastProducts({
      products,
      search,
      onlyActive,
      onlyWithForecast,
      visibleMonths,
      manualDraft,
      forecastImport,
    });
  }, [forecastImport, manualDraft, onlyActive, onlyWithForecast, products, search, visibleMonths]);

  const revenueByMonth = useMemo(() => {
    return buildForecastRevenueByMonth({
      allMonths,
      products,
      manualDraft,
      forecastImport,
    });
  }, [allMonths, forecastImport, manualDraft, products]);

  const columns = useMemo<ColumnDef<ProductRow>[]>(() => {
    const base: ColumnDef<ProductRow>[] = [
      { header: "SKU", accessorKey: "sku" },
      { header: "Alias", accessorKey: "alias" },
      { header: "Kategorie", accessorKey: "categoryLabel" },
      {
        header: "Status",
        cell: ({ row }) => row.original.isActive ? <Tag color="green">Aktiv</Tag> : <Tag>Inaktiv</Tag>,
      },
    ];

    const monthColumns: ColumnDef<ProductRow>[] = visibleMonths.map((month) => ({
      id: month,
      header: formatMonthLabel(month),
      cell: ({ row }) => {
        const sku = row.original.sku;
        const manualValue = manualDraft?.[sku]?.[month];
        const imported = getImportValue(forecastImport, sku, month);
        const effectiveUnits = getEffectiveUnits(manualDraft, forecastImport, sku, month);

        if (view === "units") {
          return (
            <div className="v2-forecast-cell">
              <InputNumber
                value={Number.isFinite(manualValue) ? manualValue : null}
                onChange={(nextValue) => {
                  setManualDraft((prev) => {
                    const next = { ...prev };
                    const skuMap = { ...(next[sku] || {}) };
                    const parsed = typeof nextValue === "number" && Number.isFinite(nextValue) ? nextValue : null;
                    if (parsed == null) {
                      delete skuMap[month];
                    } else {
                      skuMap[month] = parsed;
                    }
                    if (Object.keys(skuMap).length) {
                      next[sku] = skuMap;
                    } else {
                      delete next[sku];
                    }
                    return next;
                  });
                  setManualDirty(true);
                }}
                min={0}
                controls={false}
                placeholder={Number.isFinite(effectiveUnits as number) ? String(Math.round(Number(effectiveUnits))) : "—"}
                style={{ width: "100%" }}
              />
              <Text type="secondary" style={{ fontSize: 11 }}>
                Imp: {formatDisplay(imported?.units ?? null, 0)}
              </Text>
            </div>
          );
        }

        const derived = deriveForecastValue(view, effectiveUnits, row.original);
        return (
          <div>
            <div>{formatDisplay(derived, 2)}</div>
            <Text type="secondary" style={{ fontSize: 11 }}>
              Units: {formatDisplay(effectiveUnits, 0)}
            </Text>
          </div>
        );
      },
    }));

    return [...base, ...monthColumns];
  }, [forecastImport, manualDraft, view, visibleMonths]);

  async function saveManualForecast(): Promise<void> {
    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const nextState = next as unknown as Record<string, unknown>;
      ensureForecastContainers(nextState);
      const forecastTarget = nextState.forecast as Record<string, unknown>;
      forecastTarget.forecastManual = serializeManualMap(manualDraft);
      return next;
    }, "v2:forecast:manual-save");
    setManualDirty(false);
  }

  async function toggleUseForecast(nextValue: boolean): Promise<void> {
    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const nextState = next as unknown as Record<string, unknown>;
      ensureForecastContainers(nextState);
      const forecastTarget = nextState.forecast as Record<string, unknown>;
      const settingsTarget = (forecastTarget.settings || {}) as Record<string, unknown>;
      settingsTarget.useForecast = nextValue;
      forecastTarget.settings = settingsTarget;
      return next;
    }, "v2:forecast:toggle-useForecast");
  }

  async function handleCsvImport(file: File): Promise<void> {
    setImportError("");
    setImportWarnings([]);
    try {
      const text = await file.text();
      const parsed = parseVentoryCsv(text);
      if (parsed.error) {
        setImportRecords([]);
        setImportError(parsed.error);
        setImportWarnings(parsed.warnings || []);
        return;
      }
      const records = (parsed.records || []).map((entry) => ({
        sku: String(entry.sku || "").trim(),
        month: normalizeMonthKey(entry.month) || String(entry.month || ""),
        units: parseDeNumber(entry.units),
        revenueEur: parseDeNumber(entry.revenueEur),
        profitEur: parseDeNumber(entry.profitEur),
      })).filter((entry) => entry.sku && normalizeMonthKey(entry.month));
      setImportRecords(records);
      setImportWarnings(parsed.warnings || []);
      setImportSourceLabel(file.name);
    } catch (importReadError) {
      setImportError(importReadError instanceof Error ? importReadError.message : "Datei konnte nicht gelesen werden.");
      setImportRecords([]);
    }
  }

  async function applyCsvImport(): Promise<void> {
    if (!importRecords.length) return;
    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const nextState = next as unknown as Record<string, unknown>;
      ensureForecastContainers(nextState);
      const forecastTarget = nextState.forecast as Record<string, unknown>;
      const importTarget = (importMode === "overwrite")
        ? {}
        : { ...((forecastTarget.forecastImport || {}) as Record<string, unknown>) };
      const productBySku = new Map(
        (Array.isArray(next.products) ? next.products : [])
          .map((entry) => {
            const product = entry as Record<string, unknown>;
            return [String(product.sku || "").trim(), product];
          }),
      );

      importRecords.forEach((record) => {
        const sku = record.sku;
        const product = productBySku.get(sku);
        if (!product) return;
        if (importOnlyActive && !isForecastProductActive(product)) return;
        const month = normalizeMonthKey(record.month);
        if (!month) return;
        if (!importTarget[sku] || typeof importTarget[sku] !== "object") {
          importTarget[sku] = {};
        }
        (importTarget[sku] as Record<string, unknown>)[month] = {
          units: record.units,
          revenueEur: record.revenueEur,
          profitEur: record.profitEur,
        };
      });

      forecastTarget.forecastImport = importTarget;
      forecastTarget.lastImportAt = new Date().toISOString();
      forecastTarget.importSource = importSourceLabel || "CSV";
      return next;
    }, `v2:forecast:import:${importMode}`);
  }

  async function transferRevenueToInputs(): Promise<void> {
    if (!transferSelection.length) return;
    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const nextState = next as unknown as Record<string, unknown>;
      const incomings = Array.isArray(nextState.incomings) ? [...(nextState.incomings as Record<string, unknown>[])] : [];
      const lastPayout = incomings
        .slice()
        .reverse()
        .find((entry) => String(entry.payoutPct || "").trim())?.payoutPct;

      transferSelection.forEach((month) => {
        const revenue = Number(revenueByMonth.get(month) || 0);
        const formatted = formatMoneyState(revenue);
        const index = incomings.findIndex((entry) => String(entry.month || "") === month);
        if (index >= 0) {
          incomings[index] = {
            ...incomings[index],
            month,
            revenueEur: formatted,
            payoutPct: incomings[index].payoutPct || lastPayout || "0",
            source: "forecast",
          };
          return;
        }
        incomings.push({
          month,
          revenueEur: formatted,
          payoutPct: lastPayout || "0",
          source: "forecast",
        });
      });

      incomings.sort((a, b) => String(a.month || "").localeCompare(String(b.month || "")));
      nextState.incomings = incomings;
      return next;
    }, "v2:forecast:transfer-revenue");
    setTransferOpen(false);
  }

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <div className="v2-page-head">
          <div>
            <Title level={3}>Forecast</Title>
            <Paragraph>
              Manuelle Forecast-Eingaben, Ventory CSV-Import und Übertragung der Forecast-Umsätze in `Eingaben`.
            </Paragraph>
          </div>
        </div>
        <div className="v2-toolbar">
          <div className="v2-toolbar-row">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Suche SKU, Alias, Kategorie"
              style={{ width: 320, maxWidth: "100%" }}
            />
            <Select
              value={range}
              onChange={(value) => setRange(value)}
              options={RANGE_OPTIONS.map((entry) => ({ value: entry.value, label: entry.label }))}
              style={{ width: 140, maxWidth: "100%" }}
            />
            <Radio.Group value={view} onChange={(event) => setView(event.target.value as ForecastViewMode)}>
              <Radio.Button value="units">Units</Radio.Button>
              <Radio.Button value="revenue">Umsatz</Radio.Button>
              <Radio.Button value="profit">Gewinn</Radio.Button>
            </Radio.Group>
            <Checkbox checked={onlyActive} onChange={(event) => setOnlyActive(event.target.checked)}>
              Nur aktive Produkte
            </Checkbox>
            <Checkbox checked={onlyWithForecast} onChange={(event) => setOnlyWithForecast(event.target.checked)}>
              Nur mit Forecast
            </Checkbox>
            <Checkbox
              checked={Boolean((forecast.settings as Record<string, unknown> | undefined)?.useForecast)}
              onChange={(event) => {
                void toggleUseForecast(event.target.checked);
              }}
            >
              `useForecast` aktiv
            </Checkbox>
          </div>
          <div className="v2-toolbar-row">
            <Button type="primary" onClick={() => { void saveManualForecast(); }} disabled={!manualDirty} loading={saving}>
              Manuelle Änderungen speichern
            </Button>
            <Button
              onClick={() => {
                const defaults = visibleMonths.filter((month) => Number(revenueByMonth.get(month) || 0) > 0);
                setTransferSelection(defaults);
                setTransferOpen(true);
              }}
            >
              Umsatz übertragen
            </Button>
            {manualDirty ? <Tag color="orange">Ungespeicherte Änderungen</Tag> : <Tag color="green">Synchron</Tag>}
            {lastSavedAt ? <Tag color="green">Gespeichert: {new Date(lastSavedAt).toLocaleTimeString("de-DE")}</Tag> : null}
          </div>
        </div>
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}

      <Card>
        <Title level={4}>Ventory CSV Import</Title>
        <Space direction="vertical" style={{ width: "100%" }}>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void handleCsvImport(file);
            }}
          />
          <Space wrap>
            <Radio.Group value={importMode} onChange={(event) => setImportMode(event.target.value as "merge" | "overwrite")}>
              <Radio.Button value="merge">Merge</Radio.Button>
              <Radio.Button value="overwrite">Overwrite</Radio.Button>
            </Radio.Group>
            <Checkbox checked={importOnlyActive} onChange={(event) => setImportOnlyActive(event.target.checked)}>
              Nur aktive SKUs importieren
            </Checkbox>
            <Button onClick={() => { void applyCsvImport(); }} disabled={!importRecords.length} loading={saving}>
              Import anwenden
            </Button>
            {importSourceLabel ? <Tag>{importSourceLabel}</Tag> : null}
          </Space>
          {importError ? <Alert type="error" showIcon message={importError} /> : null}
          {importWarnings.length ? (
            <Alert
              type="warning"
              showIcon
              message={`${importWarnings.length} Warnung(en) beim Import`}
              description={importWarnings.slice(0, 5).join(" | ")}
            />
          ) : null}
          {importRecords.length ? (
            <Text type="secondary">{importRecords.length} Forecast-Zeilen erkannt.</Text>
          ) : (
            <Text type="secondary">Noch keine Importdaten geladen.</Text>
          )}
        </Space>
      </Card>

      <Card>
        <TanStackGrid
          data={filteredProducts}
          columns={columns}
          minTableWidth={1200}
          tableLayout="auto"
        />
      </Card>

      <Modal
        title="Umsatz in Eingaben übertragen"
        open={transferOpen}
        onCancel={() => setTransferOpen(false)}
        onOk={() => { void transferRevenueToInputs(); }}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Text type="secondary">Monate auswählen, deren Forecast-Umsatz in `incomings` übernommen wird.</Text>
          <Checkbox.Group
            value={transferSelection}
            onChange={(values) => setTransferSelection(values as string[])}
            style={{ width: "100%" }}
          >
            <Space direction="vertical" style={{ width: "100%" }}>
              {allMonths.map((month) => (
                <Checkbox key={month} value={month}>
                  {month} · {formatDisplay(revenueByMonth.get(month) || 0, 2)} €
                </Checkbox>
              ))}
            </Space>
          </Checkbox.Group>
        </Space>
      </Modal>
    </div>
  );
}
