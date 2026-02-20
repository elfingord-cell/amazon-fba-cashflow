import { useMemo, useRef, useState } from "react";
import { Alert, Button, Card, Col, Row, Space, Tag, Typography, message } from "antd";
import { expandFixcostInstances } from "../../../domain/cashflow.js";
import { ensureAppStateV2 } from "../../state/appState";
import { createWorkspaceBackup } from "../../sync/storageAdapters";
import { useWorkspaceState } from "../../state/workspace";

const { Paragraph, Text, Title } = Typography;

interface ValidationResult {
  errors: string[];
  warnings: string[];
}

function parseDE(value: unknown): number {
  const parsed = parseDENull(value);
  return parsed == null ? 0 : parsed;
}

function parseDENull(value: unknown): number | null {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw) return 0;
  const cleaned = raw.replace(/\./g, "").replace(",", ".");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function formatDE(value: unknown): string {
  return parseDE(value).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function looksLikeMonth(value: unknown): boolean {
  return /^\d{4}-\d{2}$/.test(String(value || ""));
}

function isValidIsoDate(value: unknown): boolean {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const [year, month, day] = raw.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return (
    Number.isFinite(date.getTime())
    && date.getFullYear() === year
    && date.getMonth() + 1 === month
    && date.getDate() === day
  );
}

function validateState(state: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const settings = (state.settings || {}) as Record<string, unknown>;
  const opening = parseDE(settings.openingBalance);
  if (opening < 0) errors.push("Opening Balance darf nicht negativ sein.");
  if (!looksLikeMonth(settings.startMonth)) errors.push("Startmonat fehlt oder ist ungueltig (settings.startMonth).");
  const horizon = Number(settings.horizonMonths || 0);
  if (!Number.isFinite(horizon) || horizon <= 0) errors.push("Horizont fehlt oder ist ungueltig (settings.horizonMonths).");

  (Array.isArray(state.incomings) ? state.incomings : []).forEach((entry, index) => {
    const row = (entry || {}) as Record<string, unknown>;
    if (!looksLikeMonth(row.month)) errors.push(`Incomings ${index + 1}: Monat fehlt/ungueltig.`);
    const revenue = parseDENull(row.revenueEur);
    if (!(Number.isFinite(revenue) && revenue >= 0)) errors.push(`Incomings ${index + 1}: Umsatz ungueltig.`);
    let payout = Number(row.payoutPct || 0);
    if (!Number.isFinite(payout)) payout = 0;
    if (payout > 1) payout /= 100;
    if (!(payout >= 0 && payout <= 1)) {
      errors.push(`Incomings ${index + 1}: payoutPct muss 0..1 oder 0..100 sein.`);
    }

    const month = String(row.month || "");
    const calibrationCutoffDate = String(row.calibrationCutoffDate || "").trim();
    if (calibrationCutoffDate) {
      if (!isValidIsoDate(calibrationCutoffDate)) {
        errors.push(`Incomings ${index + 1}: calibrationCutoffDate ungueltig (erwartet JJJJ-MM-TT).`);
      } else if (looksLikeMonth(month) && calibrationCutoffDate.slice(0, 7) !== month) {
        errors.push(`Incomings ${index + 1}: calibrationCutoffDate muss im selben Monat wie row.month liegen.`);
      }
    }

    const calibrationRevenueToDateRaw = row.calibrationRevenueToDateEur;
    if (calibrationRevenueToDateRaw != null && String(calibrationRevenueToDateRaw).trim() !== "") {
      const value = parseDENull(calibrationRevenueToDateRaw);
      if (!(Number.isFinite(value) && value >= 0)) {
        errors.push(`Incomings ${index + 1}: calibrationRevenueToDateEur muss numerisch und >= 0 sein.`);
      }
    }

    const calibrationSellerboardRaw = row.calibrationSellerboardMonthEndEur;
    if (calibrationSellerboardRaw != null && String(calibrationSellerboardRaw).trim() !== "") {
      const value = parseDENull(calibrationSellerboardRaw);
      if (!(Number.isFinite(value) && value >= 0)) {
        errors.push(`Incomings ${index + 1}: calibrationSellerboardMonthEndEur muss numerisch und >= 0 sein.`);
      }
    }

    const calibrationPayoutRateToDateRaw = row.calibrationPayoutRateToDatePct;
    if (calibrationPayoutRateToDateRaw != null && String(calibrationPayoutRateToDateRaw).trim() !== "") {
      const value = parseDENull(calibrationPayoutRateToDateRaw);
      if (!Number.isFinite(value) || value < 0) {
        errors.push(`Incomings ${index + 1}: calibrationPayoutRateToDatePct muss numerisch und >= 0 sein.`);
      }
    }
  });

  (Array.isArray(state.extras) ? state.extras : []).forEach((entry, index) => {
    const row = (entry || {}) as Record<string, unknown>;
    const month = row.month || (row.date ? String(row.date).slice(0, 7) : "");
    if (!looksLikeMonth(month)) warnings.push(`Extras ${index + 1}: Monat fehlt.`);
    if (parseDENull(row.amountEur) == null) errors.push(`Extras ${index + 1}: Betrag ungueltig.`);
  });

  (Array.isArray(state.fixcosts) ? state.fixcosts : []).forEach((entry, index) => {
    const row = (entry || {}) as Record<string, unknown>;
    if (!String(row.name || "").trim()) errors.push(`Fixkosten ${index + 1}: Name fehlt.`);
    if (!(parseDE(row.amount) > 0)) errors.push(`Fixkosten ${index + 1}: Betrag ungueltig.`);
    if (looksLikeMonth(row.startMonth) && looksLikeMonth(row.endMonth) && String(row.startMonth) > String(row.endMonth)) {
      errors.push(`Fixkosten ${index + 1}: Startmonat darf nicht nach Endmonat liegen.`);
    }
  });

  const overrides = (state.fixcostOverrides && typeof state.fixcostOverrides === "object")
    ? state.fixcostOverrides as Record<string, Record<string, Record<string, unknown>>>
    : {};
  Object.entries(overrides).forEach(([fixId, monthRows]) => {
    if (!monthRows || typeof monthRows !== "object") return;
    Object.entries(monthRows).forEach(([monthKey, values]) => {
      if (values?.amount != null && parseDENull(values.amount) == null) {
        errors.push(`Fixkosten-Override ${fixId}/${monthKey}: Betrag ungueltig.`);
      }
      if (values?.dueDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(values.dueDate))) {
        warnings.push(`Fixkosten-Override ${fixId}/${monthKey}: dueDate sollte JJJJ-MM-TT sein.`);
      }
    });
  });

  return { errors, warnings };
}

function buildForecastExport(state: Record<string, unknown>): Record<string, unknown> {
  const settings = (state.settings || {}) as Record<string, unknown>;
  const start = looksLikeMonth(settings.startMonth) ? String(settings.startMonth) : "2025-01";
  const horizon = Math.max(1, Number(settings.horizonMonths || 18));
  const months: string[] = [];
  const [year0, month0] = start.split("-").map(Number);
  for (let i = 0; i < horizon; i += 1) {
    const year = year0 + Math.floor((month0 - 1 + i) / 12);
    const month = ((month0 - 1 + i) % 12) + 1;
    months.push(`${year}-${String(month).padStart(2, "0")}`);
  }

  const forecast = (state.forecast || {}) as Record<string, unknown>;
  const manual = (forecast.forecastManual || {}) as Record<string, Record<string, number>>;
  const imported = (forecast.forecastImport || {}) as Record<string, Record<string, { units?: number }>>;
  const products = (Array.isArray(state.products) ? state.products : []).map((entry) => (entry || {}) as Record<string, unknown>);

  const items = products
    .filter((product) => String(product.sku || "").trim())
    .map((product) => {
      const sku = String(product.sku || "").trim();
      const values: Record<string, number | null> = {};
      const manualOverrideMonths: string[] = [];
      months.forEach((month) => {
        const manualValue = manual?.[sku]?.[month] ?? null;
        const importValue = imported?.[sku]?.[month]?.units ?? null;
        const effective = manualValue ?? importValue ?? null;
        values[month] = effective == null ? null : Number(effective);
        if (manualValue != null) manualOverrideMonths.push(month);
      });
      return {
        sku,
        alias: String(product.alias || ""),
        categoryId: String(product.categoryId || ""),
        avgSellingPriceGrossEUR: Number.isFinite(Number(product.avgSellingPriceGrossEUR))
          ? Number(product.avgSellingPriceGrossEUR)
          : null,
        sellerboardMarginPct: Number.isFinite(Number(product.sellerboardMarginPct))
          ? Number(product.sellerboardMarginPct)
          : null,
        values,
        meta: {
          manualOverridesMonths: manualOverrideMonths,
        },
      };
    });

  return {
    generatedAt: new Date().toISOString(),
    sourcePriority: ["manual", "ventoryOne"],
    lastImportAt: forecast.lastImportAt || null,
    forecastLastImportedAt: forecast.lastImportAt || null,
    months,
    items,
  };
}

function buildCleanJson(state: Record<string, unknown>): Record<string, unknown> {
  const clean = structuredClone(state);
  if (clean && typeof clean === "object" && "_computed" in clean) {
    delete (clean as Record<string, unknown>)._computed;
  }
  (clean as Record<string, unknown>).export = {
    forecast: buildForecastExport(clean as Record<string, unknown>),
  };
  return clean as Record<string, unknown>;
}

function buildFileName(prefix: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${prefix}-${stamp}.json`;
}

function downloadJson(payload: unknown, fileName: string): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function WorkspaceTransferPanel(): JSX.Element {
  const { state, loading, saving, error, saveWith } = useWorkspaceState();
  const [messageApi, contextHolder] = message.useMessage();
  const [importResult, setImportResult] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stateObject = state as unknown as Record<string, unknown>;
  const cleanJson = useMemo(() => buildCleanJson(stateObject), [state]);
  const cleanPreview = useMemo(() => JSON.stringify(cleanJson, null, 2), [cleanJson]);
  const validation = useMemo(() => validateState(stateObject), [state]);

  const incomings = (Array.isArray(state.incomings) ? state.incomings : []) as Array<Record<string, unknown>>;
  const extras = (Array.isArray(state.extras) ? state.extras : []) as Array<Record<string, unknown>>;
  const settings = (state.settings || {}) as Record<string, unknown>;
  const opening = parseDE(settings.openingBalance);
  const salesPayout = incomings.reduce((sum, row) => {
    const revenue = parseDE(row.revenueEur);
    let payout = Number(row.payoutPct || 0);
    if (!Number.isFinite(payout)) payout = 0;
    if (payout > 1) payout /= 100;
    return sum + revenue * payout;
  }, 0);
  const extrasTotal = extras.reduce((sum, row) => sum + parseDE(row.amountEur), 0);
  const fixcostInstances = (expandFixcostInstances(stateObject, { today: new Date() }) || []) as Array<Record<string, unknown>>;
  const fixcostTotal = fixcostInstances.reduce((sum, row) => sum + Number(row.amount || 0), 0);

  async function importWorkspaceJson(file: File): Promise<void> {
    setImportResult("");
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      messageApi.error("Datei ist kein gueltiges JSON.");
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      messageApi.error("JSON muss ein Objekt enthalten.");
      return;
    }
    const input = parsed as Record<string, unknown>;
    if (Number(input.schemaVersion) !== 2) {
      messageApi.warning("Legacy JSON erkannt. Bitte im Tab 'Legacy Migration Wizard' importieren.");
      return;
    }

 	    const confirmed = window.confirm("Workspace durch diese JSON-Datei ersetzen?");
  	    if (!confirmed) return;

	    const inputState = ensureAppStateV2(input);
	    const backupId = createWorkspaceBackup("v2:workspace-transfer:pre-import", ensureAppStateV2(state));
	    try {
	      await saveWith(() => inputState, "v2:workspace-transfer:import");
	      const resultMessage = `Import erfolgreich. Backup: ${backupId}`;
	      setImportResult(resultMessage);
	      messageApi.success(resultMessage);
	    } catch (error) {
	      const reason = error instanceof Error ? error.message : "Unbekannter Fehler";
	      messageApi.error(`Import fehlgeschlagen: ${reason}`);
	    }
	  }

  return (
    <div className="v2-import-wizard">
      {contextHolder}
      <Card>
        <Title level={4}>Workspace JSON Transfer</Title>
        <Paragraph>
          Export/Import fuer Workspace-JSON. Legacy-Dateien bitte ueber den Migration Wizard importieren.
        </Paragraph>
        <Space wrap>
          <Button
            type="primary"
            onClick={() => downloadJson(cleanJson, buildFileName("amazon-fba-cashflow-v2-clean"))}
            disabled={validation.errors.length > 0}
          >
            JSON herunterladen
          </Button>
          <Button onClick={() => downloadJson(stateObject, buildFileName("amazon-fba-cashflow-v2-backup"))}>
            Backup JSON herunterladen
          </Button>
          <Button
            onClick={() => fileInputRef.current?.click()}
            loading={saving}
          >
            JSON importieren
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void importWorkspaceJson(file);
              }
              event.target.value = "";
            }}
          />
          <Tag color="blue">Namespace: Workspace Storage</Tag>
        </Space>
        {importResult ? <Alert style={{ marginTop: 12 }} type="success" showIcon message={importResult} /> : null}
        {error ? <Alert style={{ marginTop: 12 }} type="error" showIcon message={error} /> : null}
        {loading ? <Alert style={{ marginTop: 12 }} type="info" showIcon message="Workspace wird geladen..." /> : null}
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card>
            <Title level={5}>Aktueller Stand</Title>
            <Space direction="vertical" size={4}>
              <Text>Opening: <strong>{formatDE(opening)} EUR</strong></Text>
              <Text>Sales x Payout: <strong>{formatDE(salesPayout)} EUR</strong></Text>
              <Text>Extras (Summe): <strong>{formatDE(extrasTotal)} EUR</strong></Text>
              <Text>Fixkosten (Summe): <strong>{formatDE(fixcostTotal)} EUR</strong></Text>
              <Text>Zeitraum: <strong>{String(settings.startMonth || "-")}, {String(settings.horizonMonths || 0)} Monate</strong></Text>
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card>
            <Title level={5}>Validierung</Title>
            {!validation.errors.length && !validation.warnings.length ? (
              <Alert type="success" showIcon message="Keine Probleme gefunden." />
            ) : (
              <Space direction="vertical" style={{ width: "100%" }}>
                {validation.errors.length ? (
                  <Alert
                    type="error"
                    showIcon
                    message={`Fehler: ${validation.errors.length}`}
                    description={(
                      <ul style={{ margin: 0, paddingLeft: 16 }}>
                        {validation.errors.map((entry) => <li key={entry}>{entry}</li>)}
                      </ul>
                    )}
                  />
                ) : null}
                {validation.warnings.length ? (
                  <Alert
                    type="warning"
                    showIcon
                    message={`Hinweise: ${validation.warnings.length}`}
                    description={(
                      <ul style={{ margin: 0, paddingLeft: 16 }}>
                        {validation.warnings.map((entry) => <li key={entry}>{entry}</li>)}
                      </ul>
                    )}
                  />
                ) : null}
              </Space>
            )}
          </Card>
        </Col>
      </Row>

      <Card>
        <Title level={5}>JSON Vorschau</Title>
        <pre
          style={{
            margin: 0,
            maxHeight: 460,
            overflow: "auto",
            background: "#fff",
            border: "1px solid rgba(15, 27, 45, 0.12)",
            borderRadius: 10,
            padding: 12,
          }}
        >
          {cleanPreview}
        </pre>
      </Card>
    </div>
  );
}
