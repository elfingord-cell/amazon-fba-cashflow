import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import type { ColumnDef } from "@tanstack/react-table";
import { validateAll } from "../../../lib/dataHealth.js";
import { DeNumberInput } from "../../components/DeNumberInput";
import { DataTable } from "../../components/DataTable";
import { useWorkspaceState } from "../../state/workspace";
import { ensureAppStateV2 } from "../../state/appState";
import { normalizeEmailKey, readCollaborationDisplayNames } from "../../domain/collaboration";
import { useSyncSession } from "../../sync/session";

const { Paragraph, Text, Title } = Typography;

const CURRENCIES = ["EUR", "USD", "CNY"];
const MONTH_ANCHOR_OPTIONS = [
  { value: "START", label: "Start (1. Tag)" },
  { value: "MID", label: "Mitte (15. Tag)" },
  { value: "END", label: "Ende (letzter Tag)" },
];
const FO_PAYMENT_TRIGGER_OPTIONS = [
  { value: "ORDER_DATE", label: "ORDER_DATE" },
  { value: "PRODUCTION_END", label: "PRODUCTION_END" },
  { value: "ETD", label: "ETD" },
  { value: "ETA", label: "ETA" },
  { value: "DELIVERY", label: "DELIVERY" },
];
const PO_PAYMENT_ANCHOR_OPTIONS = [
  { value: "ORDER_DATE", label: "ORDER_DATE" },
  { value: "PROD_DONE", label: "PROD_DONE" },
  { value: "ETD", label: "ETD" },
  { value: "ETA", label: "ETA" },
];
const SKU_PLANNING_HORIZON_OPTIONS = [
  { value: 6, label: "6 Monate" },
  { value: 12, label: "12 Monate" },
  { value: 18, label: "18 Monate" },
];
const SKU_PLANNING_ABC_OPTIONS = [
  { value: "abc", label: "A + B + C" },
  { value: "ab", label: "Nur A + B" },
  { value: "a", label: "Nur A" },
];

interface SettingsDraft {
  air: number;
  rail: number;
  sea: number;
  defaultBufferDays: number;
  defaultCurrency: string;
  fxRate: number | null;
  eurUsdRate: number | null;
  defaultProductionLeadTimeDays: number;
  dutyRatePct: number;
  eustRatePct: number;
  defaultDdp: boolean;
  safetyStockDohDefault: number;
  robustnessLookaheadDaysNonDdp: number;
  robustnessLookaheadDaysDdp: number;
  foCoverageDohDefault: number;
  moqDefaultUnits: number;
  skuPlanningHorizonMonths: number;
  skuPlanningAbcFilter: "abc" | "ab" | "a";
  skuPlanningMaxPhantomSuggestionsPerSku: number;
  skuPlanningShowSimulationByDefault: boolean;
  monthAnchorDay: string;
  cnyStart: string;
  cnyEnd: string;
  foFreightDueTrigger: string;
  foFreightDueOffsetDays: number;
  foDutyDueTrigger: string;
  foDutyDueOffsetDays: number;
  foEustDueTrigger: string;
  foEustDueOffsetDays: number;
  foEustRefundDueTrigger: string;
  foEustRefundDueOffsetDays: number;
  poFreightDueAnchor: string;
  poFreightDueLagDays: number;
  poDutyDueAnchor: string;
  poDutyDueLagDays: number;
  poEustDueAnchor: string;
  poEustDueLagDays: number;
  poVatRefundDueAnchor: string;
  poVatRefundDueLagDays: number;
}

interface CategoryRow {
  id: string;
  name: string;
  sortOrder: number;
  productCount: number;
}

interface CollaborationNameRow {
  email: string;
  displayName: string;
}

function toNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toRoundedNumber(value: unknown, fallback: number): number {
  return Math.round(toNumber(value, fallback));
}

function normalizeFoTrigger(value: unknown, fallback: string): string {
  const trigger = String(value || "").trim().toUpperCase();
  if (FO_PAYMENT_TRIGGER_OPTIONS.some((entry) => entry.value === trigger)) return trigger;
  return fallback;
}

function normalizePoAnchor(value: unknown, fallback: string): string {
  const anchor = String(value || "").trim().toUpperCase();
  if (PO_PAYMENT_ANCHOR_OPTIONS.some((entry) => entry.value === anchor)) return anchor;
  return fallback;
}

function normalizeSkuPlanningHorizon(value: unknown, fallback = 12): number {
  const parsed = Math.round(Number(value || 0));
  if (parsed === 6 || parsed === 12 || parsed === 18) return parsed;
  return fallback;
}

function normalizeSkuPlanningAbcFilter(value: unknown, fallback: "abc" | "ab" | "a" = "abc"): "abc" | "ab" | "a" {
  const parsed = String(value || "").trim().toLowerCase();
  if (parsed === "a" || parsed === "ab" || parsed === "abc") return parsed;
  return fallback;
}

function toOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function deriveEurUsdRate(fxRate: number | null): number | null {
  if (!Number.isFinite(fxRate as number)) return null;
  const safeFxRate = Number(fxRate);
  if (safeFxRate <= 0) return null;
  return 1 / safeFxRate;
}

function settingsDraftFromState(state: Record<string, unknown>): SettingsDraft {
  const transport = (state.transportLeadTimesDays || {}) as Record<string, unknown>;
  const cny = (state.cny || {}) as Record<string, unknown>;
  const paymentDueDefaults = (state.paymentDueDefaults || {}) as Record<string, unknown>;
  const foDefaults = (paymentDueDefaults.fo || {}) as Record<string, unknown>;
  const poDefaults = (paymentDueDefaults.po || {}) as Record<string, unknown>;
  const fxRate = toOptionalNumber(state.fxRate);
  const eurUsdRate = toOptionalNumber(state.eurUsdRate) ?? deriveEurUsdRate(fxRate);
  const fallbackPoLagDays = Math.max(0, toRoundedNumber(state.freightLagDays, 0));
  const readFo = (key: string, fallbackTrigger: string, fallbackOffset: number): { trigger: string; offsetDays: number } => {
    const row = (foDefaults[key] || {}) as Record<string, unknown>;
    return {
      trigger: normalizeFoTrigger(row.triggerEvent, fallbackTrigger),
      offsetDays: toRoundedNumber(row.offsetDays, fallbackOffset),
    };
  };
  const readPo = (key: string, fallbackAnchor: string, fallbackLagDays: number): { anchor: string; lagDays: number } => {
    const row = (poDefaults[key] || {}) as Record<string, unknown>;
    return {
      anchor: normalizePoAnchor(row.anchor, fallbackAnchor),
      lagDays: toRoundedNumber(row.lagDays, fallbackLagDays),
    };
  };
  const foFreightDue = readFo("freight", "ETD", 0);
  const foDutyDue = readFo("duty", "ETA", 0);
  const foEustDue = readFo("eust", "ETA", 0);
  const foEustRefundDue = readFo("eustRefund", "ETA", 0);
  const poFreightDue = readPo("freight", "ETA", fallbackPoLagDays);
  const poDutyDue = readPo("duty", "ETA", fallbackPoLagDays);
  const poEustDue = readPo("eust", "ETA", fallbackPoLagDays);
  const poVatRefundDue = readPo("vatRefund", "ETA", 0);
  return {
    air: Math.max(0, toNumber(transport.air, 10)),
    rail: Math.max(0, toNumber(transport.rail, 25)),
    sea: Math.max(0, toNumber(transport.sea, 45)),
    defaultBufferDays: Math.max(0, toNumber(state.defaultBufferDays, 0)),
    defaultCurrency: String(state.defaultCurrency || "EUR"),
    fxRate,
    eurUsdRate,
    defaultProductionLeadTimeDays: Math.max(0, toNumber(state.defaultProductionLeadTimeDays, 45)),
    dutyRatePct: Math.max(0, toNumber(state.dutyRatePct, 0)),
    eustRatePct: Math.max(0, toNumber(state.eustRatePct, 0)),
    defaultDdp: state.defaultDdp === true,
    safetyStockDohDefault: Math.max(0, toNumber(state.safetyStockDohDefault, 60)),
    robustnessLookaheadDaysNonDdp: Math.max(1, toNumber(state.robustnessLookaheadDaysNonDdp, 90)),
    robustnessLookaheadDaysDdp: Math.max(1, toNumber(state.robustnessLookaheadDaysDdp, 35)),
    foCoverageDohDefault: Math.max(0, toNumber(state.foCoverageDohDefault, 90)),
    moqDefaultUnits: Math.max(0, Math.round(toNumber(state.moqDefaultUnits, 500))),
    skuPlanningHorizonMonths: normalizeSkuPlanningHorizon(state.skuPlanningHorizonMonths, 12),
    skuPlanningAbcFilter: normalizeSkuPlanningAbcFilter(state.skuPlanningAbcFilter, "abc"),
    skuPlanningMaxPhantomSuggestionsPerSku: Math.max(1, Math.round(toNumber(state.skuPlanningMaxPhantomSuggestionsPerSku, 3))),
    skuPlanningShowSimulationByDefault: state.skuPlanningShowSimulationByDefault !== false,
    monthAnchorDay: String(state.monthAnchorDay || "START"),
    cnyStart: String(cny.start || ""),
    cnyEnd: String(cny.end || ""),
    foFreightDueTrigger: foFreightDue.trigger,
    foFreightDueOffsetDays: foFreightDue.offsetDays,
    foDutyDueTrigger: foDutyDue.trigger,
    foDutyDueOffsetDays: foDutyDue.offsetDays,
    foEustDueTrigger: foEustDue.trigger,
    foEustDueOffsetDays: foEustDue.offsetDays,
    foEustRefundDueTrigger: foEustRefundDue.trigger,
    foEustRefundDueOffsetDays: foEustRefundDue.offsetDays,
    poFreightDueAnchor: poFreightDue.anchor,
    poFreightDueLagDays: poFreightDue.lagDays,
    poDutyDueAnchor: poDutyDue.anchor,
    poDutyDueLagDays: poDutyDue.lagDays,
    poEustDueAnchor: poEustDue.anchor,
    poEustDueLagDays: poEustDue.lagDays,
    poVatRefundDueAnchor: poVatRefundDue.anchor,
    poVatRefundDueLagDays: poVatRefundDue.lagDays,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeDraft(values: SettingsDraft): string {
  return JSON.stringify({
    air: Number(values.air || 0),
    rail: Number(values.rail || 0),
    sea: Number(values.sea || 0),
    defaultBufferDays: Number(values.defaultBufferDays || 0),
    defaultCurrency: String(values.defaultCurrency || ""),
    fxRate: toOptionalNumber(values.fxRate),
    eurUsdRate: toOptionalNumber(values.eurUsdRate),
    defaultProductionLeadTimeDays: Number(values.defaultProductionLeadTimeDays || 0),
    dutyRatePct: Number(values.dutyRatePct || 0),
    eustRatePct: Number(values.eustRatePct || 0),
    defaultDdp: values.defaultDdp === true,
    safetyStockDohDefault: Number(values.safetyStockDohDefault || 0),
    robustnessLookaheadDaysNonDdp: Number(values.robustnessLookaheadDaysNonDdp || 0),
    robustnessLookaheadDaysDdp: Number(values.robustnessLookaheadDaysDdp || 0),
    foCoverageDohDefault: Number(values.foCoverageDohDefault || 0),
    moqDefaultUnits: Number(values.moqDefaultUnits || 0),
    skuPlanningHorizonMonths: normalizeSkuPlanningHorizon(values.skuPlanningHorizonMonths, 12),
    skuPlanningAbcFilter: normalizeSkuPlanningAbcFilter(values.skuPlanningAbcFilter, "abc"),
    skuPlanningMaxPhantomSuggestionsPerSku: Math.max(1, Math.round(toNumber(values.skuPlanningMaxPhantomSuggestionsPerSku, 3))),
    skuPlanningShowSimulationByDefault: values.skuPlanningShowSimulationByDefault === true,
    monthAnchorDay: String(values.monthAnchorDay || ""),
    cnyStart: String(values.cnyStart || ""),
    cnyEnd: String(values.cnyEnd || ""),
    foFreightDueTrigger: String(values.foFreightDueTrigger || ""),
    foFreightDueOffsetDays: Number(values.foFreightDueOffsetDays || 0),
    foDutyDueTrigger: String(values.foDutyDueTrigger || ""),
    foDutyDueOffsetDays: Number(values.foDutyDueOffsetDays || 0),
    foEustDueTrigger: String(values.foEustDueTrigger || ""),
    foEustDueOffsetDays: Number(values.foEustDueOffsetDays || 0),
    foEustRefundDueTrigger: String(values.foEustRefundDueTrigger || ""),
    foEustRefundDueOffsetDays: Number(values.foEustRefundDueOffsetDays || 0),
    poFreightDueAnchor: String(values.poFreightDueAnchor || ""),
    poFreightDueLagDays: Number(values.poFreightDueLagDays || 0),
    poDutyDueAnchor: String(values.poDutyDueAnchor || ""),
    poDutyDueLagDays: Number(values.poDutyDueLagDays || 0),
    poEustDueAnchor: String(values.poEustDueAnchor || ""),
    poEustDueLagDays: Number(values.poEustDueLagDays || 0),
    poVatRefundDueAnchor: String(values.poVatRefundDueAnchor || ""),
    poVatRefundDueLagDays: Number(values.poVatRefundDueLagDays || 0),
  });
}

function isEditableNode(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.matches("input:not([type='hidden']), textarea, [contenteditable='true']")) return true;
  if (target.closest(".ant-select, .ant-picker, .ant-input-number")) return true;
  return false;
}

export default function SettingsModule(): JSX.Element {
  const { state, loading, saving, error, lastSavedAt, saveWith } = useWorkspaceState();
  const syncSession = useSyncSession();
  const settings = (state.settings || {}) as Record<string, unknown>;
  const [form] = Form.useForm<SettingsDraft>();
  const watchedFxRate = Form.useWatch("fxRate", form);
  const derivedEurUsdRate = useMemo(
    () => deriveEurUsdRate(toOptionalNumber(watchedFxRate)),
    [watchedFxRate],
  );
  const [draftSeed, setDraftSeed] = useState(() => settingsDraftFromState(settings));
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCategory, setEditingCategory] = useState<CategoryRow | null>(null);
  const [categoryForm] = Form.useForm<{ name: string; sortOrder: number }>();
  const autoSaveTimerRef = useRef<number | null>(null);
  const lastSavedHashRef = useRef("");
  const [autoSaveHint, setAutoSaveHint] = useState("");
  const [nameForm] = Form.useForm<CollaborationNameRow>();
  const [editingNameEmail, setEditingNameEmail] = useState<string | null>(null);
  const [newDisplayNameEmail, setNewDisplayNameEmail] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");

  useEffect(() => {
    const nextSeed = settingsDraftFromState(settings);
    setDraftSeed(nextSeed);
    form.setFieldsValue(nextSeed);
    lastSavedHashRef.current = normalizeDraft(nextSeed);
  }, [form, settings]);

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current != null) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, []);

  const categoryRows = useMemo(() => {
    const categories = Array.isArray(state.productCategories) ? state.productCategories : [];
    const products = Array.isArray(state.products) ? state.products : [];
    const counts = new Map<string, number>();
    products.forEach((product) => {
      const key = String((product as Record<string, unknown>).categoryId || "");
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return categories
      .map((category) => {
        const row = category as Record<string, unknown>;
        return {
          id: String(row.id || ""),
          name: String(row.name || ""),
          sortOrder: toNumber(row.sortOrder, 0),
          productCount: counts.get(String(row.id || "")) || 0,
        } as CategoryRow;
      })
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }, [state.productCategories, state.products]);

  const collaborationNameRows = useMemo<CollaborationNameRow[]>(() => {
    const map = readCollaborationDisplayNames(settings);
    const rows = Object.entries(map).map(([email, displayName]) => ({ email, displayName }));
    const currentEmail = normalizeEmailKey(syncSession.email);
    if (currentEmail && !rows.some((row) => normalizeEmailKey(row.email) === currentEmail)) {
      rows.push({ email: currentEmail, displayName: "" });
    }
    return rows.sort((a, b) => a.email.localeCompare(b.email));
  }, [settings, syncSession.email]);

  const healthIssues = useMemo(() => {
    const result = validateAll({
      settings: state.settings,
      products: state.products,
      suppliers: state.suppliers,
      pos: state.pos,
      fos: state.fos,
    });
    return result.issues || [];
  }, [state.settings, state.products, state.suppliers, state.pos, state.fos]);

  const categoryColumns = useMemo<ColumnDef<CategoryRow>[]>(() => [
    { header: "Name", accessorKey: "name" },
    { header: "Sortierung", accessorKey: "sortOrder" },
    { header: "Produkte", accessorKey: "productCount" },
    {
      header: "Aktionen",
      cell: ({ row }) => (
        <Space>
          <Button
            size="small"
            onClick={() => {
              setEditingCategory(row.original);
              categoryForm.setFieldsValue({
                name: row.original.name,
                sortOrder: row.original.sortOrder,
              });
            }}
          >
            Bearbeiten
          </Button>
          <Button
            size="small"
            danger
            onClick={() => {
              Modal.confirm({
                title: "Kategorie loeschen?",
                content: "Produkte dieser Kategorie werden auf 'ohne Kategorie' gesetzt.",
                onOk: async () => {
                  await saveWith((current) => {
                    const next = ensureAppStateV2(current);
                    next.productCategories = (Array.isArray(next.productCategories) ? next.productCategories : [])
                      .filter((entry) => String((entry as Record<string, unknown>).id || "") !== row.original.id);
                    next.products = (Array.isArray(next.products) ? next.products : []).map((entry) => {
                      const product = entry as Record<string, unknown>;
                      if (String(product.categoryId || "") !== row.original.id) return product;
                      return { ...product, categoryId: null };
                    });
                    return next;
                  }, "v2:settings:category-delete");
                },
              });
            }}
          >
            Loeschen
          </Button>
        </Space>
      ),
    },
  ], [categoryForm, saveWith]);

  async function handleSaveSettings(values: SettingsDraft, source = "v2:settings:save"): Promise<void> {
    if ((values.cnyStart && !values.cnyEnd) || (!values.cnyStart && values.cnyEnd)) {
      throw new Error("Bitte CNY Start und Ende gemeinsam setzen.");
    }
    if (values.cnyStart && values.cnyEnd && values.cnyStart > values.cnyEnd) {
      throw new Error("CNY Start darf nicht nach dem Ende liegen.");
    }
    const fxRate = toOptionalNumber(values.fxRate);
    const eurUsdRate = deriveEurUsdRate(fxRate);
    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const baseSettings = (next.settings || {}) as Record<string, unknown>;
      next.settings = {
        ...baseSettings,
        transportLeadTimesDays: {
          ...(baseSettings.transportLeadTimesDays as Record<string, unknown> || {}),
          air: Math.max(0, Math.round(values.air)),
          rail: Math.max(0, Math.round(values.rail)),
          sea: Math.max(0, Math.round(values.sea)),
        },
        defaultBufferDays: Math.max(0, Math.round(values.defaultBufferDays)),
        defaultCurrency: values.defaultCurrency,
        fxRate,
        eurUsdRate,
        defaultProductionLeadTimeDays: Math.max(0, Math.round(values.defaultProductionLeadTimeDays)),
        dutyRatePct: Math.max(0, Number(values.dutyRatePct || 0)),
        eustRatePct: Math.max(0, Number(values.eustRatePct || 0)),
        defaultDdp: values.defaultDdp === true,
        safetyStockDohDefault: Math.max(0, Math.round(values.safetyStockDohDefault)),
        robustnessLookaheadDaysNonDdp: Math.max(1, Math.round(values.robustnessLookaheadDaysNonDdp)),
        robustnessLookaheadDaysDdp: Math.max(1, Math.round(values.robustnessLookaheadDaysDdp)),
        foCoverageDohDefault: Math.max(0, Math.round(values.foCoverageDohDefault)),
        moqDefaultUnits: Math.max(0, Math.round(values.moqDefaultUnits)),
        skuPlanningHorizonMonths: normalizeSkuPlanningHorizon(values.skuPlanningHorizonMonths, 12),
        skuPlanningAbcFilter: normalizeSkuPlanningAbcFilter(values.skuPlanningAbcFilter, "abc"),
        skuPlanningMaxPhantomSuggestionsPerSku: Math.max(1, Math.round(toNumber(values.skuPlanningMaxPhantomSuggestionsPerSku, 3))),
        skuPlanningShowSimulationByDefault: values.skuPlanningShowSimulationByDefault === true,
        monthAnchorDay: values.monthAnchorDay,
        cny: {
          start: values.cnyStart || "",
          end: values.cnyEnd || "",
        },
        paymentDueDefaults: {
          fo: {
            freight: {
              triggerEvent: normalizeFoTrigger(values.foFreightDueTrigger, "ETD"),
              offsetDays: toRoundedNumber(values.foFreightDueOffsetDays, 0),
            },
            duty: {
              triggerEvent: normalizeFoTrigger(values.foDutyDueTrigger, "ETA"),
              offsetDays: toRoundedNumber(values.foDutyDueOffsetDays, 0),
            },
            eust: {
              triggerEvent: normalizeFoTrigger(values.foEustDueTrigger, "ETA"),
              offsetDays: toRoundedNumber(values.foEustDueOffsetDays, 0),
            },
            eustRefund: {
              triggerEvent: normalizeFoTrigger(values.foEustRefundDueTrigger, "ETA"),
              offsetDays: toRoundedNumber(values.foEustRefundDueOffsetDays, 0),
            },
          },
          po: {
            freight: {
              anchor: normalizePoAnchor(values.poFreightDueAnchor, "ETA"),
              lagDays: toRoundedNumber(values.poFreightDueLagDays, 0),
            },
            duty: {
              anchor: normalizePoAnchor(values.poDutyDueAnchor, "ETA"),
              lagDays: toRoundedNumber(values.poDutyDueLagDays, 0),
            },
            eust: {
              anchor: normalizePoAnchor(values.poEustDueAnchor, "ETA"),
              lagDays: toRoundedNumber(values.poEustDueLagDays, 0),
            },
            vatRefund: {
              anchor: normalizePoAnchor(values.poVatRefundDueAnchor, "ETA"),
              lagDays: toRoundedNumber(values.poVatRefundDueLagDays, 0),
            },
          },
        },
        freightLagDays: toRoundedNumber(values.poFreightDueLagDays, 0),
        lastUpdatedAt: nowIso(),
      };
      return next;
    }, source);
    lastSavedHashRef.current = normalizeDraft(values);
    setAutoSaveHint(`Gespeichert: ${new Date().toLocaleTimeString("de-DE")}`);
  }

  function scheduleAutoSave(delayMs = 420): void {
    if (autoSaveTimerRef.current != null) {
      window.clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      if (saving) {
        scheduleAutoSave();
        return;
      }
      const values = form.getFieldsValue(true) as SettingsDraft;
      const currentHash = normalizeDraft(values);
      if (currentHash === lastSavedHashRef.current) return;
      void form
        .validateFields()
        .then((validated) => handleSaveSettings(validated as SettingsDraft, "v2:settings:auto"))
        .catch(() => {
          // Validation errors are shown by Form; autosave will retry on next blur/change.
        });
    }, Math.max(80, Number(delayMs) || 420));
  }

  async function upsertDisplayName(inputEmail: string, inputDisplayName: string): Promise<void> {
    const email = normalizeEmailKey(inputEmail);
    const displayName = String(inputDisplayName || "").trim();
    if (!email || !displayName) {
      throw new Error("Bitte E-Mail und Anzeigenamen setzen.");
    }
    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const baseSettings = (next.settings || {}) as Record<string, unknown>;
      const currentMap = readCollaborationDisplayNames(baseSettings);
      currentMap[email] = displayName;
      next.settings = {
        ...baseSettings,
        collaborationDisplayNames: currentMap,
        lastUpdatedAt: nowIso(),
      };
      return next;
    }, "v2:settings:collaboration-name-upsert");
  }

  async function removeDisplayName(inputEmail: string): Promise<void> {
    const email = normalizeEmailKey(inputEmail);
    if (!email) return;
    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const baseSettings = (next.settings || {}) as Record<string, unknown>;
      const currentMap = readCollaborationDisplayNames(baseSettings);
      if (!currentMap[email]) return next;
      delete currentMap[email];
      next.settings = {
        ...baseSettings,
        collaborationDisplayNames: currentMap,
        lastUpdatedAt: nowIso(),
      };
      return next;
    }, "v2:settings:collaboration-name-remove");
  }

  const collaborationNameColumns = useMemo<ColumnDef<CollaborationNameRow>[]>(() => [
    {
      header: "E-Mail",
      accessorKey: "email",
      meta: { width: 320 },
    },
    {
      header: "Anzeigename",
      accessorKey: "displayName",
      meta: { width: 210 },
      cell: ({ row }) => row.original.displayName || "—",
    },
    {
      header: "Aktionen",
      meta: { width: 190 },
      cell: ({ row }) => (
        <div className="v2-actions-nowrap">
          <Button
            size="small"
            onClick={() => {
              setEditingNameEmail(row.original.email);
              nameForm.setFieldsValue({
                email: row.original.email,
                displayName: row.original.displayName,
              });
            }}
          >
            Bearbeiten
          </Button>
          <Button
            size="small"
            danger
            disabled={!row.original.displayName}
            onClick={() => {
              void removeDisplayName(row.original.email);
            }}
          >
            Loeschen
          </Button>
        </div>
      ),
    },
  ], [nameForm, removeDisplayName]);

  async function handleAddCategory(): Promise<void> {
    const name = newCategoryName.trim();
    if (!name) return;
    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const categories = Array.isArray(next.productCategories) ? [...next.productCategories] : [];
      const exists = categories.some((entry) => String((entry as Record<string, unknown>).name || "").trim().toLowerCase() === name.toLowerCase());
      if (exists) {
        throw new Error("Kategorie existiert bereits.");
      }
      categories.push({
        id: randomId("cat"),
        name,
        sortOrder: categories.length,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
      next.productCategories = categories;
      return next;
    }, "v2:settings:category-add");
    setNewCategoryName("");
  }

  async function handleUpdateCategory(values: { name: string; sortOrder: number }): Promise<void> {
    if (!editingCategory) return;
    const nextName = values.name.trim();
    if (!nextName) return;
    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      next.productCategories = (Array.isArray(next.productCategories) ? next.productCategories : []).map((entry) => {
        const category = entry as Record<string, unknown>;
        if (String(category.id || "") !== editingCategory.id) return category;
        return {
          ...category,
          name: nextName,
          sortOrder: Math.max(0, Math.round(values.sortOrder || 0)),
          updatedAt: nowIso(),
        };
      });
      return next;
    }, "v2:settings:category-update");
    setEditingCategory(null);
    categoryForm.resetFields();
  }

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <div className="v2-page-head">
          <div>
            <Title level={3}>Settings</Title>
            <Paragraph>
              Lead Times, Defaults, CNY-Fenster und Kategorien für die operative Planung.
            </Paragraph>
          </div>
        </div>
        <div className="v2-toolbar">
          <div className="v2-toolbar-row">
            {saving ? <Tag color="processing">Speichern...</Tag> : null}
            {lastSavedAt ? <Tag color="green">Gespeichert: {new Date(lastSavedAt).toLocaleTimeString("de-DE")}</Tag> : null}
            {autoSaveHint ? <Tag color="blue">{autoSaveHint}</Tag> : null}
          </div>
        </div>
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}

      <Card>
        <Form<SettingsDraft>
          name="v2-settings-form"
          form={form}
          layout="vertical"
          initialValues={draftSeed}
          onValuesChange={() => {
            setAutoSaveHint("Ungespeicherte Aenderungen");
            scheduleAutoSave(360);
          }}
          onBlurCapture={(event) => {
            if (!isEditableNode(event.target)) return;
            scheduleAutoSave(120);
          }}
        >
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item label="Air (Tage)" name="air" rules={[{ required: true }]}>
                <DeNumberInput mode="int" min={0} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="Rail (Tage)" name="rail" rules={[{ required: true }]}>
                <DeNumberInput mode="int" min={0} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="Sea (Tage)" name="sea" rules={[{ required: true }]}>
                <DeNumberInput mode="int" min={0} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item label="Buffer Days" name="defaultBufferDays" rules={[{ required: true }]}>
                <DeNumberInput mode="int" min={0} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="Default Currency" name="defaultCurrency" rules={[{ required: true }]}>
                <Select options={CURRENCIES.map((currency) => ({ value: currency, label: currency }))} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="Monats-Anker" name="monthAnchorDay" rules={[{ required: true }]}>
                <Select options={MONTH_ANCHOR_OPTIONS} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item label="FX Kurs (USD je EUR)" name="fxRate">
                <DeNumberInput mode="fx" min={0} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item
                label="FX Kurs (EUR je USD)"
                extra="Automatisch aus USD je EUR berechnet."
              >
                <DeNumberInput
                  mode="fx"
                  min={0}
                  value={derivedEurUsdRate ?? undefined}
                  disabled
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="MOQ Default (Units)" name="moqDefaultUnits">
                <DeNumberInput mode="int" min={0} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item label="Safety Stock DOH" name="safetyStockDohDefault">
                <DeNumberInput mode="int" min={0} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="FO Coverage DOH" name="foCoverageDohDefault">
                <DeNumberInput mode="int" min={0} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="Default Production Lead Time (Tage)" name="defaultProductionLeadTimeDays">
                <DeNumberInput mode="int" min={0} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item label="Robustheit Lookahead (Tage) Standard" name="robustnessLookaheadDaysNonDdp">
                <DeNumberInput mode="int" min={1} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="Robustheit Lookahead (Tage) DDP" name="robustnessLookaheadDaysDdp">
                <DeNumberInput mode="int" min={1} />
              </Form.Item>
            </Col>
          </Row>

          <Title level={5} style={{ marginTop: 4 }}>SKU Planung (Simulation)</Title>
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item label="Planungshorizont" name="skuPlanningHorizonMonths" rules={[{ required: true }]}>
                <Select options={SKU_PLANNING_HORIZON_OPTIONS} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="ABC-Klassen" name="skuPlanningAbcFilter" rules={[{ required: true }]}>
                <Select options={SKU_PLANNING_ABC_OPTIONS} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="Max. Phantom-FO Vorschlaege je SKU" name="skuPlanningMaxPhantomSuggestionsPerSku">
                <DeNumberInput mode="int" min={1} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="skuPlanningShowSimulationByDefault" valuePropName="checked">
                <Checkbox>Simulation standardmaessig anzeigen</Checkbox>
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item label="Default Zollsatz %" name="dutyRatePct">
                <DeNumberInput mode="percent" min={0} max={100} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="Default EUSt %" name="eustRatePct">
                <DeNumberInput mode="percent" min={0} max={100} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="defaultDdp" valuePropName="checked" style={{ marginTop: 30 }}>
                <Checkbox>Default DDP aktiv</Checkbox>
              </Form.Item>
            </Col>
          </Row>

          <Title level={5} style={{ marginTop: 4 }}>Fälligkeit Defaults FO (Auto-Zahlungen)</Title>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item label="FO Freight Trigger" name="foFreightDueTrigger" rules={[{ required: true }]}>
                <Select options={FO_PAYMENT_TRIGGER_OPTIONS} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="FO Freight Offset (Tage)" name="foFreightDueOffsetDays" rules={[{ required: true }]}>
                <DeNumberInput mode="int" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item label="FO Duty Trigger" name="foDutyDueTrigger" rules={[{ required: true }]}>
                <Select options={FO_PAYMENT_TRIGGER_OPTIONS} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="FO Duty Offset (Tage)" name="foDutyDueOffsetDays" rules={[{ required: true }]}>
                <DeNumberInput mode="int" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item label="FO EUSt Trigger" name="foEustDueTrigger" rules={[{ required: true }]}>
                <Select options={FO_PAYMENT_TRIGGER_OPTIONS} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="FO EUSt Offset (Tage)" name="foEustDueOffsetDays" rules={[{ required: true }]}>
                <DeNumberInput mode="int" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item label="FO EUSt Refund Trigger" name="foEustRefundDueTrigger" rules={[{ required: true }]}>
                <Select options={FO_PAYMENT_TRIGGER_OPTIONS} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="FO EUSt Refund Offset (Tage)" name="foEustRefundDueOffsetDays" rules={[{ required: true }]}>
                <DeNumberInput mode="int" />
              </Form.Item>
            </Col>
          </Row>

          <Title level={5} style={{ marginTop: 4 }}>Fälligkeit Defaults PO (Auto-Zahlungen)</Title>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item label="PO Freight Anchor" name="poFreightDueAnchor" rules={[{ required: true }]}>
                <Select options={PO_PAYMENT_ANCHOR_OPTIONS} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="PO Freight Offset (Tage)" name="poFreightDueLagDays" rules={[{ required: true }]}>
                <DeNumberInput mode="int" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item label="PO Duty Anchor" name="poDutyDueAnchor" rules={[{ required: true }]}>
                <Select options={PO_PAYMENT_ANCHOR_OPTIONS} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="PO Duty Offset (Tage)" name="poDutyDueLagDays" rules={[{ required: true }]}>
                <DeNumberInput mode="int" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item label="PO EUSt Anchor" name="poEustDueAnchor" rules={[{ required: true }]}>
                <Select options={PO_PAYMENT_ANCHOR_OPTIONS} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="PO EUSt Offset (Tage)" name="poEustDueLagDays" rules={[{ required: true }]}>
                <DeNumberInput mode="int" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item label="PO VAT Refund Anchor" name="poVatRefundDueAnchor" rules={[{ required: true }]}>
                <Select options={PO_PAYMENT_ANCHOR_OPTIONS} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="PO VAT Refund Offset (Tage)" name="poVatRefundDueLagDays" rules={[{ required: true }]}>
                <DeNumberInput mode="int" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item label="CNY Start" name="cnyStart">
                <Input type="date" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label="CNY Ende" name="cnyEnd">
                <Input type="date" />
              </Form.Item>
            </Col>
          </Row>

        </Form>
      </Card>

      <Card>
        <Title level={4}>Team Anzeige-Namen</Title>
        <Paragraph>
          Hinterlege optionale Vornamen pro E-Mail. Diese Namen werden in Live-Presence und Modal-Hinweisen angezeigt.
        </Paragraph>
        <Space style={{ marginBottom: 12 }} wrap>
          <Input
            value={newDisplayNameEmail}
            onChange={(event) => setNewDisplayNameEmail(event.target.value)}
            placeholder="E-Mail"
            style={{ width: 280 }}
          />
          <Input
            value={newDisplayName}
            onChange={(event) => setNewDisplayName(event.target.value)}
            placeholder="Anzeigename (z. B. Pierre)"
            style={{ width: 220 }}
          />
          <Button
            onClick={() => {
              void upsertDisplayName(newDisplayNameEmail, newDisplayName)
                .then(() => {
                  setNewDisplayNameEmail("");
                  setNewDisplayName("");
                });
            }}
          >
            Speichern
          </Button>
        </Space>
        <DataTable
          data={collaborationNameRows}
          columns={collaborationNameColumns}
          minTableWidth={880}
          tableLayout="auto"
        />
      </Card>

      <Card>
        <Title level={4}>Produktkategorien</Title>
        <Space style={{ marginBottom: 12 }}>
          <Input
            value={newCategoryName}
            onChange={(event) => setNewCategoryName(event.target.value)}
            placeholder="Neue Kategorie"
            style={{ width: 260 }}
          />
          <Button onClick={() => { void handleAddCategory(); }}>
            Hinzufuegen
          </Button>
        </Space>
        <DataTable data={categoryRows} columns={categoryColumns} />
      </Card>

      <Card>
        <Title level={4}>Data Health</Title>
        {healthIssues.length ? (
          <Space direction="vertical" size={6}>
            <Tag color="orange">{healthIssues.length} Issues</Tag>
            {healthIssues.slice(0, 10).map((issue) => (
              <Text key={issue.id}>
                {issue.message}
              </Text>
            ))}
          </Space>
        ) : (
          <Text type="secondary">Keine Issues gefunden.</Text>
        )}
      </Card>

      <Modal
        title="Kategorie bearbeiten"
        open={Boolean(editingCategory)}
        onCancel={() => setEditingCategory(null)}
        onOk={() => {
          void categoryForm
            .validateFields()
            .then((values) => handleUpdateCategory(values))
            .catch(() => {});
        }}
      >
        <Form form={categoryForm} layout="vertical">
          <Form.Item name="name" label="Name" rules={[{ required: true, message: "Name ist erforderlich." }]}>
            <Input />
          </Form.Item>
          <Form.Item name="sortOrder" label="Sortierung" rules={[{ required: true }]}>
            <DeNumberInput mode="int" min={0} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Anzeigename bearbeiten"
        open={Boolean(editingNameEmail)}
        onCancel={() => setEditingNameEmail(null)}
        onOk={() => {
          void nameForm.validateFields().then((values) => {
            void upsertDisplayName(values.email, values.displayName).then(() => {
              setEditingNameEmail(null);
              nameForm.resetFields();
            });
          }).catch(() => {});
        }}
      >
        <Form form={nameForm} layout="vertical">
          <Form.Item
            name="email"
            label="E-Mail"
            rules={[{ required: true, message: "E-Mail fehlt." }]}
          >
            <Input disabled />
          </Form.Item>
          <Form.Item
            name="displayName"
            label="Anzeigename"
            rules={[{ required: true, message: "Anzeigename fehlt." }]}
          >
            <Input placeholder="z. B. Pierre" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
