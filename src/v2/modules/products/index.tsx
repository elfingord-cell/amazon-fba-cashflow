import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Form,
  Input,
  message,
  Modal,
  Segmented,
  Select,
  Space,
  Table,
  Tooltip,
  Tag,
  Typography,
} from "antd";
import type { ColumnDef } from "@tanstack/react-table";
import { TanStackGrid } from "../../components/TanStackGrid";
import { DeNumberInput } from "../../components/DeNumberInput";
import { readCollaborationDisplayNames, resolveCollaborationUserLabel } from "../../domain/collaboration";
import { buildCategoryOrderMap, sortCategoryGroups } from "../../domain/categoryOrder";
import { resolveProductFieldResolution, type ResolvedField } from "../../domain/productFieldResolution";
import { evaluateProductCompletenessV2 } from "../../domain/productCompletenessV2";
import { computeSeasonalityProfileFromForecastImport } from "../../domain/seasonalityProfile";
import { buildProductGridRows, type ProductGridRow } from "../../domain/tableModels";
import { sourceChipClass } from "../../domain/masterDataHierarchy";
import { formatMonthLabel } from "../../domain/months";
import { buildPlanVsLiveComparisonRows, normalizePlanProductMappingRecord } from "../../../domain/planProducts.js";
import { useWorkspaceState } from "../../state/workspace";
import { ensureAppStateV2 } from "../../state/appState";
import {
  getModuleExpandedCategoryKeys,
  hasModuleExpandedCategoryKeys,
  setModuleExpandedCategoryKeys,
} from "../../state/uiPrefs";
import { useSyncSession } from "../../sync/session";
import { useModalCollaboration } from "../../sync/modalCollaboration";
import { useLocation } from "react-router-dom";

const { Paragraph, Text, Title } = Typography;

const STATUS_OPTIONS = [
  { value: "active", label: "Aktiv" },
  { value: "prelaunch", label: "Noch nicht gelauncht" },
  { value: "inactive", label: "Inaktiv" },
];

const TRANSPORT_MODES = ["AIR", "RAIL", "SEA"];
const CURRENCIES = ["EUR", "USD", "CNY"];

type ProductRow = ProductGridRow;
type ProductIssueFilter = "all" | "needs_fix" | "revenue" | "blocked";

const COMPLETENESS_FIELD_TO_FORM_FIELDS: Record<string, Array<keyof ProductDraft>> = {
  unitPriceUsd: ["templateUnitPriceUsd"],
  avgSellingPriceGrossEUR: ["avgSellingPriceGrossEUR"],
  sellerboardMarginPct: ["sellerboardMarginPct"],
  moqUnits: ["moqUnits"],
  productionLeadTimeDaysDefault: ["productionLeadTimeDaysDefault"],
  incoterm_ddp: ["templateDdp"],
  hsCode: ["hsCode"],
  goodsDescription: ["goodsDescription"],
  landedUnitCostEur: ["landedUnitCostEur"],
};

const ADVANCED_FORM_FIELDS = new Set<keyof ProductDraft>([
  "moqUnits",
  "sellerboardMarginPct",
  "templateDdp",
]);

interface ProductDraft {
  id?: string;
  sku: string;
  alias: string;
  hsCode: string;
  goodsDescription: string;
  supplierId: string;
  categoryId: string | null;
  status: "active" | "prelaunch" | "inactive";
  avgSellingPriceGrossEUR: number | null;
  sellerboardMarginPct: number | null;
  moqUnits: number | null;
  safetyStockDohOverride: number | null;
  foCoverageDohOverride: number | null;
  moqOverrideUnits: number | null;
  landedUnitCostEur: number | null;
  logisticsPerUnitEur: number | null;
  productionLeadTimeDaysDefault: number | null;
  templateUnitPriceUsd: number | null;
  templateTransportMode: string;
  templateProductionDays: number | null;
  templateTransitDays: number | null;
  templateFreightEur: number | null;
  templateDutyPct: number | null;
  templateVatImportPct: number | null;
  templateFxRate: number | null;
  templateCurrency: string;
  templateDdp: boolean;
}

const PRODUCT_FIELD_LABELS: Partial<Record<keyof ProductDraft, string>> = {
  sku: "SKU",
  alias: "Alias",
  hsCode: "HS-Code",
  goodsDescription: "Warenbeschreibung",
  supplierId: "Supplier",
  categoryId: "Kategorie",
  status: "Status",
  avgSellingPriceGrossEUR: "Verkaufspreis (EUR)",
  sellerboardMarginPct: "Marge %",
  moqUnits: "MOQ Units",
  landedUnitCostEur: "Einstand (EUR)",
  logisticsPerUnitEur: "Shipping (EUR/Stk)",
  productionLeadTimeDaysDefault: "Production Lead Time",
  templateUnitPriceUsd: "EK (USD)",
  templateTransitDays: "Transit-Tage",
  templateDdp: "Incoterm / DDP",
};

interface BulkEditDraft {
  scope: "filtered" | "selected";
  selectedSkus: string[];
  applyTemplateUnitPriceUsd: boolean;
  templateUnitPriceUsd: number | null;
  applyAvgSellingPriceGrossEUR: boolean;
  avgSellingPriceGrossEUR: number | null;
  applySellerboardMarginPct: boolean;
  sellerboardMarginPct: number | null;
  applyMoqUnits: boolean;
  moqUnits: number | null;
  applyProductionLeadTimeDaysDefault: boolean;
  productionLeadTimeDaysDefault: number | null;
  applyTemplateTransitDays: boolean;
  templateTransitDays: number | null;
  applyTemplateDdp: boolean;
  templateDdp: boolean;
}

const BULK_EDIT_INITIAL: BulkEditDraft = {
  scope: "filtered",
  selectedSkus: [],
  applyTemplateUnitPriceUsd: false,
  templateUnitPriceUsd: null,
  applyAvgSellingPriceGrossEUR: false,
  avgSellingPriceGrossEUR: null,
  applySellerboardMarginPct: false,
  sellerboardMarginPct: null,
  applyMoqUnits: false,
  moqUnits: null,
  applyProductionLeadTimeDaysDefault: false,
  productionLeadTimeDaysDefault: null,
  applyTemplateTransitDays: false,
  templateTransitDays: null,
  applyTemplateDdp: false,
  templateDdp: true,
};

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pickFxUsdPerEur(input: {
  formFx: unknown;
  settingsFx: unknown;
  settingsEurUsd: unknown;
  resolvedFx: unknown;
}): number | null {
  const directCandidates = [
    asNumber(input.formFx),
    asNumber(input.settingsFx),
    asNumber(input.resolvedFx),
  ];
  for (let i = 0; i < directCandidates.length; i += 1) {
    const value = directCandidates[i];
    if (value != null && value > 0 && value < 10) return value;
  }
  const eurUsd = asNumber(input.settingsEurUsd);
  if (eurUsd != null && eurUsd > 0 && eurUsd < 10) {
    const inverted = 1 / eurUsd;
    if (Number.isFinite(inverted) && inverted > 0) return inverted;
  }
  for (let i = 0; i < directCandidates.length; i += 1) {
    const value = directCandidates[i];
    if (value != null && value > 0) return value;
  }
  return null;
}

function formatNumber(value: number | null, digits = 2): string {
  if (!Number.isFinite(value as number)) return "—";
  return Number(value).toLocaleString("de-DE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatResolvedField(
  field: ResolvedField<number | string | boolean>,
  options?: { digits?: number; kind?: "number" | "text" | "boolean" },
): string {
  const kind = options?.kind || "number";
  if (kind === "boolean") return field.value === true ? "Ja" : "Nein";
  if (kind === "text") return String(field.value || "—");
  return formatNumber(typeof field.value === "number" ? field.value : null, options?.digits ?? 2);
}

function completenessTag(status: "blocked" | "warn" | "ok"): JSX.Element {
  if (status === "ok") return <Tag color="green">OK</Tag>;
  if (status === "warn") return <Tag color="orange">WARN</Tag>;
  return <Tag color="red">BLOCKED</Tag>;
}

function seasonalityClassificationTag(
  value: "unterdurchschnittlich" | "durchschnittlich" | "ueberdurchschnittlich" | "keine_daten",
): JSX.Element {
  if (value === "ueberdurchschnittlich") return <Tag color="green">ueberdurchschnittlich</Tag>;
  if (value === "unterdurchschnittlich") return <Tag color="orange">unterdurchschnittlich</Tag>;
  if (value === "durchschnittlich") return <Tag color="blue">durchschnittlich</Tag>;
  return <Tag>keine Daten</Tag>;
}

function normalizeStatusFilter(value: unknown): "all" | "active" | "prelaunch" | "inactive" | null {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "all" || raw === "active" || raw === "prelaunch" || raw === "inactive") return raw;
  return null;
}

function normalizeIssueFilter(value: unknown): ProductIssueFilter {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "needs_fix") return "needs_fix";
  if (raw === "revenue") return "revenue";
  if (raw === "blocked") return "blocked";
  return "all";
}

function hasRevenueIssue(row: ProductRow): boolean {
  const price = Number(row.avgSellingPriceGrossEUR);
  const missingPrice = !Number.isFinite(price) || price <= 0;
  return missingPrice || row.completeness === "blocked";
}

function productDraftFromRow(row?: ProductRow): ProductDraft {
  const templateSource = (row?.raw.template as Record<string, unknown> | undefined) || {};
  const template = (
    templateSource.fields && typeof templateSource.fields === "object"
      ? templateSource.fields
      : templateSource
  ) as Record<string, unknown>;
  return {
    id: row?.id,
    sku: row?.sku || "",
    alias: row?.alias || "",
    hsCode: String(row?.raw.hsCode || ""),
    goodsDescription: String(row?.raw.goodsDescription || ""),
    supplierId: row?.supplierId || "",
    categoryId: row?.categoryId || null,
    status: row?.status || "active",
    avgSellingPriceGrossEUR: row?.avgSellingPriceGrossEUR ?? null,
    sellerboardMarginPct: row?.sellerboardMarginPct ?? null,
    moqUnits: row?.moqUnits ?? null,
    safetyStockDohOverride: asNumber(row?.raw.safetyStockDohOverride),
    foCoverageDohOverride: asNumber(row?.raw.foCoverageDohOverride),
    moqOverrideUnits: asNumber(row?.raw.moqOverrideUnits),
    landedUnitCostEur: asNumber(row?.raw.landedUnitCostEur),
    logisticsPerUnitEur: asNumber(row?.raw.logisticsPerUnitEur ?? row?.raw.freightPerUnitEur),
    productionLeadTimeDaysDefault: asNumber(row?.raw.productionLeadTimeDaysDefault),
    templateUnitPriceUsd: asNumber(template.unitPriceUsd),
    templateTransportMode: String(template.transportMode || "SEA"),
    templateProductionDays: asNumber(template.productionDays),
    templateTransitDays: asNumber(template.transitDays),
    templateFreightEur: asNumber(template.freightEur),
    templateDutyPct: asNumber(template.dutyPct),
    templateVatImportPct: asNumber(template.vatImportPct),
    templateFxRate: asNumber(template.fxRate),
    templateCurrency: String(template.currency || "USD"),
    templateDdp: template.ddp === true,
  };
}

export default function ProductsModule(): JSX.Element {
  const location = useLocation();
  const { state, loading, saving, error, lastSavedAt, saveWith } = useWorkspaceState();
  const syncSession = useSyncSession();
  const hasStoredExpandedPrefs = hasModuleExpandedCategoryKeys("products");
  const appliedDashboardQueryRef = useRef(false);
  const [productsGridMode, setProductsGridMode] = useState<"management" | "logistics">("management");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "prelaunch" | "inactive">("all");
  const [issueFilter, setIssueFilter] = useState<ProductIssueFilter>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [logisticsManualOverride, setLogisticsManualOverride] = useState(false);
  const [advancedOpenKeys, setAdvancedOpenKeys] = useState<string[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<string[]>(() => getModuleExpandedCategoryKeys("products"));
  const [expandFromQuery, setExpandFromQuery] = useState(false);
  const [form] = Form.useForm<ProductDraft>();
  const [bulkForm] = Form.useForm<BulkEditDraft>();
  const draftValues = Form.useWatch([], form) as ProductDraft | undefined;
  const bulkDraftValues = Form.useWatch([], bulkForm) as BulkEditDraft | undefined;
  const stateObject = state as unknown as Record<string, unknown>;
  const settings = (state.settings || {}) as Record<string, unknown>;
  const forecastState = (state.forecast && typeof state.forecast === "object")
    ? state.forecast as Record<string, unknown>
    : {};
  const forecastImportMap = (forecastState.forecastImport && typeof forecastState.forecastImport === "object")
    ? forecastState.forecastImport as Record<string, unknown>
    : {};
  const displayNameMap = useMemo(() => readCollaborationDisplayNames(settings), [settings]);
  const ownDisplayName = useMemo(() => {
    return resolveCollaborationUserLabel({
      userId: syncSession.userId,
      userEmail: syncSession.email,
    }, displayNameMap);
  }, [displayNameMap, syncSession.email, syncSession.userId]);
  const modalScope = useMemo(() => {
    const entityId = String(editing?.id || "new");
    return `products:edit:${entityId}`;
  }, [editing?.id]);
  const modalCollab = useModalCollaboration({
    workspaceId: syncSession.workspaceId,
    modalScope,
    isOpen: modalOpen,
    userId: syncSession.userId,
    userEmail: syncSession.email,
    userDisplayName: ownDisplayName,
    displayNames: displayNameMap,
  });

  useEffect(() => {
    if (appliedDashboardQueryRef.current) return;
    const params = new URLSearchParams(location.search);
    const source = String(params.get("source") || "");
    if (source !== "dashboard" && source !== "plan-products") return;
    appliedDashboardQueryRef.current = true;

    const sku = String(params.get("sku") || "").trim();
    if (sku) setSearch(sku);

    if (source === "dashboard") {
      setIssueFilter(normalizeIssueFilter(params.get("issues")));
      const nextStatus = normalizeStatusFilter(params.get("status"));
      if (nextStatus) setStatusFilter(nextStatus);
      if (params.get("expand") === "all") setExpandFromQuery(true);
    }
  }, [location.search]);

  const categories = useMemo(() => {
    return (Array.isArray(state.productCategories) ? state.productCategories : [])
      .map((entry) => ({
        id: String((entry as Record<string, unknown>).id || ""),
        name: String((entry as Record<string, unknown>).name || "Ohne Kategorie"),
      }))
      .filter((entry) => entry.id);
  }, [state.productCategories]);

  const suppliers = useMemo(() => {
    return (Array.isArray(state.suppliers) ? state.suppliers : [])
      .map((entry) => ({
        id: String((entry as Record<string, unknown>).id || ""),
        name: String((entry as Record<string, unknown>).name || ""),
      }))
      .filter((entry) => entry.id);
  }, [state.suppliers]);

  const categoryLabelById = useMemo(() => new Map(categories.map((entry) => [entry.id, entry.name])), [categories]);
  const supplierLabelById = useMemo(() => new Map(suppliers.map((entry) => [entry.id, entry.name])), [suppliers]);
  const categoryOrderMap = useMemo(() => buildCategoryOrderMap(stateObject), [state.productCategories]);

  const baseRows = useMemo(() => {
    return buildProductGridRows({
      state: stateObject,
      search,
      statusFilter,
      categoryLabelById,
      supplierLabelById,
    });
  }, [categoryLabelById, search, stateObject, statusFilter, supplierLabelById]);

  const issueCounts = useMemo(() => {
    return baseRows.reduce((acc, row) => {
      const revenueIssue = hasRevenueIssue(row);
      const needsFix = row.completeness !== "ok" || revenueIssue;
      if (revenueIssue) acc.revenue += 1;
      if (needsFix) acc.needsFix += 1;
      if (row.completeness === "blocked") acc.blocked += 1;
      return acc;
    }, {
      revenue: 0,
      needsFix: 0,
      blocked: 0,
    });
  }, [baseRows]);

  const rows = useMemo(() => {
    if (issueFilter === "all") return baseRows;
    return baseRows.filter((row) => {
      const revenueIssue = hasRevenueIssue(row);
      if (issueFilter === "revenue") return revenueIssue;
      if (issueFilter === "blocked") return row.completeness === "blocked";
      return row.completeness !== "ok" || revenueIssue;
    });
  }, [baseRows, issueFilter]);

  const groupedRows = useMemo(() => {
    const groups = new Map<string, ProductRow[]>();
    rows.forEach((row) => {
      const categoryLabel = row.categoryId ? (categoryLabelById.get(row.categoryId) || "Ohne Kategorie") : "Ohne Kategorie";
      if (!groups.has(categoryLabel)) groups.set(categoryLabel, []);
      groups.get(categoryLabel)?.push(row);
    });
    const mapped = Array.from(groups.entries())
      .map(([category, items]) => ({
        key: category,
        label: category,
        rows: items.sort((a, b) => a.sku.localeCompare(b.sku)),
      }));
    return sortCategoryGroups(mapped, categoryOrderMap);
  }, [categoryLabelById, categoryOrderMap, rows]);

  const bulkCandidateRows = useMemo(
    () => rows.filter((row) => row.status === "active" || row.status === "prelaunch"),
    [rows],
  );

  const bulkSkuOptions = useMemo(
    () => bulkCandidateRows.map((row) => ({ value: row.sku, label: `${row.alias || row.sku} · ${row.sku}` })),
    [bulkCandidateRows],
  );

  const bulkDraft = bulkDraftValues || BULK_EDIT_INITIAL;
  const bulkTargetSkus = useMemo(() => {
    if (bulkDraft.scope === "selected") {
      const validSkuSet = new Set(bulkCandidateRows.map((row) => row.sku));
      return (Array.isArray(bulkDraft.selectedSkus) ? bulkDraft.selectedSkus : [])
        .map((sku) => String(sku || "").trim())
        .filter((sku) => sku && validSkuSet.has(sku));
    }
    return bulkCandidateRows.map((row) => row.sku);
  }, [bulkCandidateRows, bulkDraft.scope, bulkDraft.selectedSkus]);

  useEffect(() => {
    setExpandedCategories((current) => {
      if (!groupedRows.length) return [];
      const validKeys = new Set(groupedRows.map((group) => group.key));
      const filtered = current.filter((key) => validKeys.has(key));
      if (filtered.length || hasStoredExpandedPrefs) return filtered;
      return groupedRows.map((group) => group.key);
    });
  }, [groupedRows, hasStoredExpandedPrefs]);

  useEffect(() => {
    if (!expandFromQuery) return;
    if (!groupedRows.length) return;
    setExpandedCategories(groupedRows.map((group) => group.key));
    setExpandFromQuery(false);
  }, [expandFromQuery, groupedRows]);

  useEffect(() => {
    setModuleExpandedCategoryKeys("products", expandedCategories);
  }, [expandedCategories]);

  function formatMoney(value: number | null): string {
    if (value == null || !Number.isFinite(value)) return "—";
    return value.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function openEditModal(row: ProductRow): void {
    const draft = productDraftFromRow(row);
    setEditing(row);
    form.setFieldsValue(draft);
    setLogisticsManualOverride(draft.logisticsPerUnitEur != null);
    setModalOpen(true);
  }

  function toggleProductStatus(row: ProductRow): void {
    const nextStatus = row.status === "active"
      ? "inactive"
      : row.status === "inactive"
        ? "prelaunch"
        : "active";
    void saveWith((current) => {
      const next = ensureAppStateV2(current);
      next.products = (Array.isArray(next.products) ? next.products : []).map((entry) => {
        const product = entry as Record<string, unknown>;
        if (String(product.sku || "").toLowerCase() !== row.sku.toLowerCase()) return product;
        return {
          ...product,
          status: nextStatus,
          updatedAt: nowIso(),
        };
      });
      return next;
    }, "v2:products:toggle-status");
  }

  function deleteProductRow(row: ProductRow): void {
    Modal.confirm({
      title: `Produkt "${row.sku}" loeschen?`,
      onOk: async () => {
        await saveWith((current) => {
          const next = ensureAppStateV2(current);
          next.products = (Array.isArray(next.products) ? next.products : [])
            .filter((entry) => String((entry as Record<string, unknown>).sku || "").toLowerCase() !== row.sku.toLowerCase());
          return next;
        }, "v2:products:delete");
      },
    });
  }

  async function copyLogistics(row: ProductRow): Promise<void> {
    const payload = `${row.hsCode || ""}\t${row.goodsDescription || ""}`;
    try {
      await navigator.clipboard.writeText(payload);
      message.success("Kopiert");
    } catch {
      message.error("Kopieren fehlgeschlagen");
    }
  }

  const columns = useMemo<ColumnDef<ProductRow>[]>(() => {
    const sharedColumns: ColumnDef<ProductRow>[] = [
      {
        header: "Alias",
        accessorKey: "alias",
        meta: { width: 260, minWidth: 260 },
        cell: ({ row }) => (
          <div className="v2-proj-alias">
            <Text className="v2-proj-alias-main">{row.original.alias || row.original.sku}</Text>
            <Text className="v2-proj-sku-secondary" type="secondary">{row.original.sku}</Text>
          </div>
        ),
      },
      {
        header: "Supplier",
        meta: { width: 190 },
        cell: ({ row }) => (row.original.supplierId ? supplierLabelById.get(row.original.supplierId) || row.original.supplierId : "—"),
      },
    ];

    const actionColumn: ColumnDef<ProductRow> = {
      header: "Aktionen",
      meta: { width: productsGridMode === "logistics" ? 274 : 230, minWidth: productsGridMode === "logistics" ? 274 : 230 },
      cell: ({ row }) => (
        <div className="v2-actions-nowrap">
          {productsGridMode === "logistics" ? (
            <Button
              size="small"
              onClick={() => { void copyLogistics(row.original); }}
            >
              Copy
            </Button>
          ) : null}
          <Button
            size="small"
            onClick={() => openEditModal(row.original)}
          >
            Bearbeiten
          </Button>
          <Button
            size="small"
            onClick={() => toggleProductStatus(row.original)}
          >
            Status
          </Button>
          <Button
            size="small"
            danger
            onClick={() => deleteProductRow(row.original)}
          >
            Loeschen
          </Button>
        </div>
      ),
    };

    if (productsGridMode === "logistics") {
      return [
        ...sharedColumns,
        {
          header: "HS-Code",
          accessorKey: "hsCode",
          meta: { width: 160 },
          cell: ({ row }) => row.original.hsCode || "—",
        },
        {
          header: "Warenbeschreibung",
          accessorKey: "goodsDescription",
          meta: { minWidth: 320, width: 420 },
          cell: ({ row }) => row.original.goodsDescription || "—",
        },
        actionColumn,
      ];
    }

    return [
      ...sharedColumns,
      {
        header: "Status",
        meta: { width: 96 },
        cell: ({ row }) => (
          row.original.status === "inactive"
            ? <Tag>Inaktiv</Tag>
            : row.original.status === "prelaunch"
              ? <Tag color="gold">Noch nicht gelauncht</Tag>
              : <Tag color="green">Aktiv</Tag>
        ),
      },
      {
        header: "Completeness",
        meta: { width: 122 },
        cell: ({ row }) => completenessTag(row.original.completeness),
      },
      {
        header: "Ø VK (EUR)",
        meta: { width: 120, align: "right" },
        cell: ({ row }) => formatMoney(row.original.avgSellingPriceGrossEUR),
      },
      {
        header: "Ø EK (USD)",
        meta: { width: 120, align: "right" },
        cell: ({ row }) => formatMoney(row.original.templateUnitPriceUsd),
      },
      {
        header: "Ø Einstand (EUR)",
        meta: { width: 140, align: "right" },
        cell: ({ row }) => formatMoney(row.original.landedUnitCostEur),
      },
      {
        header: "Ø Shipping China->Lager/3PL (EUR/Stk)",
        meta: { width: 220, align: "right" },
        cell: ({ row }) => formatMoney(row.original.shippingPerUnitEur),
      },
      actionColumn,
    ];
  }, [form, productsGridMode, saveWith, supplierLabelById]);

  const draftProductRecord = useMemo(() => {
    const baseRaw = (editing?.raw || {}) as Record<string, unknown>;
    const baseTemplate = (((baseRaw.template as Record<string, unknown> | undefined)?.fields as Record<string, unknown> | undefined)
      || (baseRaw.template as Record<string, unknown> | undefined)
      || {}) as Record<string, unknown>;
    const current = draftValues || productDraftFromRow(editing || undefined);

    const draftProduct: Record<string, unknown> = {
      ...baseRaw,
      sku: current.sku || baseRaw.sku || "",
      alias: current.alias || baseRaw.alias || "",
      hsCode: current.hsCode || baseRaw.hsCode || "",
      goodsDescription: current.goodsDescription || baseRaw.goodsDescription || "",
      supplierId: current.supplierId || baseRaw.supplierId || "",
      categoryId: current.categoryId ?? baseRaw.categoryId ?? null,
      moqUnits: current.moqUnits ?? baseRaw.moqUnits ?? null,
      moqOverrideUnits: current.moqOverrideUnits ?? baseRaw.moqOverrideUnits ?? null,
      safetyStockDohOverride: current.safetyStockDohOverride ?? baseRaw.safetyStockDohOverride ?? null,
      foCoverageDohOverride: current.foCoverageDohOverride ?? baseRaw.foCoverageDohOverride ?? null,
      landedUnitCostEur: current.landedUnitCostEur ?? baseRaw.landedUnitCostEur ?? null,
      logisticsPerUnitEur: current.logisticsPerUnitEur ?? baseRaw.logisticsPerUnitEur ?? null,
      freightPerUnitEur: current.logisticsPerUnitEur ?? baseRaw.freightPerUnitEur ?? null,
      productionLeadTimeDaysDefault: current.productionLeadTimeDaysDefault ?? baseRaw.productionLeadTimeDaysDefault ?? null,
      template: {
        scope: "SKU",
        name: "Standard (SKU)",
        fields: {
          ...baseTemplate,
          unitPriceUsd: current.templateUnitPriceUsd ?? baseTemplate.unitPriceUsd ?? null,
          transportMode: current.templateTransportMode || String(baseTemplate.transportMode || "SEA"),
          productionDays: current.templateProductionDays ?? baseTemplate.productionDays ?? null,
          transitDays: current.templateTransitDays ?? baseTemplate.transitDays ?? null,
          freightEur: current.templateFreightEur ?? baseTemplate.freightEur ?? null,
          dutyPct: current.templateDutyPct ?? baseTemplate.dutyPct ?? null,
          vatImportPct: current.templateVatImportPct ?? baseTemplate.vatImportPct ?? null,
          fxRate: current.templateFxRate ?? baseTemplate.fxRate ?? settings.fxRate ?? null,
          currency: current.templateCurrency || String(baseTemplate.currency || settings.defaultCurrency || "EUR"),
          ddp: current.templateDdp ?? baseTemplate.ddp ?? false,
        },
      },
    };

    return draftProduct;
  }, [draftValues, editing, settings.defaultCurrency, settings.fxRate, stateObject]);

  const resolvedDraft = useMemo(() => {
    return resolveProductFieldResolution({
      product: draftProductRecord,
      state: stateObject,
      supplierId: String(draftProductRecord.supplierId || ""),
    });
  }, [draftProductRecord, stateObject]);

  const draftCompleteness = useMemo(
    () => evaluateProductCompletenessV2({ product: draftProductRecord, state: stateObject }),
    [draftProductRecord, stateObject],
  );
  const seasonalitySku = useMemo(
    () => String(draftValues?.sku || editing?.sku || "").trim(),
    [draftValues?.sku, editing?.sku],
  );
  const seasonalityProfile = useMemo(() => {
    if (!seasonalitySku) return null;
    return computeSeasonalityProfileFromForecastImport({
      forecastImport: forecastImportMap,
      sku: seasonalitySku,
    });
  }, [forecastImportMap, seasonalitySku]);
  const seasonalityChartRows = useMemo(() => {
    if (!seasonalityProfile) return [];
    const availableFactors = seasonalityProfile.months
      .map((entry) => Number(entry.factor))
      .filter((value): value is number => Number.isFinite(value));
    const maxFactor = availableFactors.length ? Math.max(...availableFactors) : 1;
    const scaleMax = Math.max(1, maxFactor);

    return seasonalityProfile.months.map((entry) => ({
      key: String(entry.monthNumber),
      monthLabel: entry.monthLabel,
      factor: entry.factor,
      averageUnits: entry.averageUnits,
      sampleCount: entry.sampleCount,
      classification: entry.classification,
      widthPercent: entry.factor ? (Math.min(100, (Number(entry.factor) / scaleMax) * 100)) : 0,
      scaleMax: Number(scaleMax),
    }));
  }, [seasonalityProfile]);
  const latestPlanMapping = useMemo(() => {
    const sku = String(draftValues?.sku || editing?.sku || "").trim();
    if (!sku) return null;
    const mappings = (Array.isArray(state.planProductMappings) ? state.planProductMappings : [])
      .map((entry, index) => normalizePlanProductMappingRecord(entry as Record<string, unknown>, index))
      .filter((entry) => entry.sku.toLowerCase() === sku.toLowerCase())
      .sort((a, b) => String(b.mappedAt || "").localeCompare(String(a.mappedAt || "")));
    return mappings[0] || null;
  }, [draftValues?.sku, editing?.sku, state.planProductMappings]);
  const planVsLiveRows = useMemo(() => {
    if (!latestPlanMapping) return [];
    return buildPlanVsLiveComparisonRows({
      mapping: latestPlanMapping,
      forecastImport: forecastImportMap,
      maxMonths: 18,
    });
  }, [forecastImportMap, latestPlanMapping]);

  const fieldIssues = useMemo(() => {
    const map = new Map<keyof ProductDraft, { level: "error" | "warning"; messages: string[] }>();
    const push = (field: keyof ProductDraft, level: "error" | "warning", message: string): void => {
      const current = map.get(field);
      if (!current) {
        map.set(field, { level, messages: [message] });
        return;
      }
      if (level === "error") current.level = "error";
      if (!current.messages.includes(message)) current.messages.push(message);
    };

    const blockingLevel: "error" | "warning" = draftCompleteness.blockScope ? "error" : "warning";
    draftCompleteness.blockingMissing.forEach((issue) => {
      const targets = COMPLETENESS_FIELD_TO_FORM_FIELDS[issue.fieldKey] || [];
      targets.forEach((field) => push(field, blockingLevel, issue.reason || issue.label));
    });
    draftCompleteness.importantMissing.forEach((issue) => {
      const targets = COMPLETENESS_FIELD_TO_FORM_FIELDS[issue.fieldKey] || [];
      targets.forEach((field) => push(field, "warning", issue.reason || issue.label));
    });
    return map;
  }, [draftCompleteness]);

  const hasAdvancedIssue = useMemo(() => {
    return Array.from(fieldIssues.keys()).some((field) => ADVANCED_FORM_FIELDS.has(field));
  }, [fieldIssues]);

  function fieldValidateStatus(field: keyof ProductDraft): "error" | "warning" | undefined {
    return fieldIssues.get(field)?.level;
  }

  function fieldHelp(field: keyof ProductDraft): string | undefined {
    const issue = fieldIssues.get(field);
    if (!issue || !issue.messages.length) return undefined;
    return `Prüfen: ${issue.messages.join(" · ")}`;
  }

  const orderedFieldIssues = useMemo(() => {
    return Array.from(fieldIssues.entries()).map(([field, issue]) => ({
      field,
      level: issue.level,
      messages: issue.messages,
      label: PRODUCT_FIELD_LABELS[field] || String(field),
    }));
  }, [fieldIssues]);

  function focusIssueField(field: keyof ProductDraft): void {
    if (ADVANCED_FORM_FIELDS.has(field)) {
      setAdvancedOpenKeys(["advanced"]);
    }
    window.setTimeout(() => {
      try {
        form.scrollToField(field, { block: "center" });
      } catch {
        // noop
      }
      const instance = form.getFieldInstance(field) as { focus?: () => void } | undefined;
      if (instance && typeof instance.focus === "function") {
        instance.focus();
      }
    }, 80);
  }

  function focusFirstIssueField(): void {
    const first = orderedFieldIssues[0]?.field;
    if (!first) return;
    focusIssueField(first);
  }

  const shippingSuggestion = useMemo(() => {
    const values = draftValues || ({} as ProductDraft);
    const fxUsed = pickFxUsdPerEur({
      formFx: values.templateFxRate,
      settingsFx: settings.fxRate,
      settingsEurUsd: settings.eurUsdRate,
      resolvedFx: resolvedDraft.fxRate.value,
    });
    const unitCostUsd = asNumber(values.templateUnitPriceUsd);
    const landedUnitCostEur = asNumber(values.landedUnitCostEur);
    const goodsCostEur = (
      unitCostUsd != null
      && fxUsed != null
      && fxUsed > 0
    ) ? (unitCostUsd / fxUsed) : null;
    const raw = (
      landedUnitCostEur != null
      && goodsCostEur != null
    ) ? (landedUnitCostEur - goodsCostEur) : null;
    return {
      value: Number.isFinite(raw as number) ? Math.max(0, Number(raw)) : null,
      warning: Number.isFinite(raw as number) ? Number(raw) < 0 : false,
      goodsCostEur,
      fxUsed,
      landedUnitCostEur,
      unitCostUsd,
    };
  }, [draftValues, resolvedDraft.fxRate.value, settings.eurUsdRate, settings.fxRate]);

  useEffect(() => {
    if (!modalOpen || logisticsManualOverride) return;
    const suggested = Number(shippingSuggestion.value);
    if (!Number.isFinite(suggested)) return;
    const rounded = Math.round(suggested * 100) / 100;
    const current = asNumber(form.getFieldValue("logisticsPerUnitEur"));
    if (current == null || Math.abs(current - rounded) > 0.00001) {
      form.setFieldValue("logisticsPerUnitEur", rounded);
    }
  }, [form, logisticsManualOverride, modalOpen, shippingSuggestion.value]);

  useEffect(() => {
    if (!modalOpen || !modalCollab.readOnly || !modalCollab.remoteDraftPatch) return;
    form.setFieldsValue(modalCollab.remoteDraftPatch as unknown as Partial<ProductDraft>);
  }, [form, modalCollab.readOnly, modalCollab.remoteDraftPatch, modalCollab.remoteDraftVersion, modalOpen]);

  useEffect(() => {
    if (!modalOpen) {
      setAdvancedOpenKeys([]);
      return;
    }
    if (hasAdvancedIssue) {
      setAdvancedOpenKeys(["advanced"]);
    }
  }, [hasAdvancedIssue, modalOpen]);

  function resetField(field: keyof ProductDraft): void {
    form.setFieldsValue({ [field]: null } as Partial<ProductDraft>);
    if (field === "logisticsPerUnitEur") {
      setLogisticsManualOverride(false);
      const suggested = Number(shippingSuggestion.value);
      if (Number.isFinite(suggested)) {
        form.setFieldValue("logisticsPerUnitEur", Math.round(suggested * 100) / 100);
      }
    }
  }

  function renderResolvedMeta(
    field: ResolvedField<number | string | boolean>,
    options?: { digits?: number; kind?: "number" | "text" | "boolean"; extraHint?: string },
  ): JSX.Element {
    const source = String(field.source || "missing") as "order_override" | "product" | "supplier" | "settings" | "missing" | "computed";
    const missingRequired = field.source === "missing" && field.required === true;
    return (
      <span className="v2-field-meta">
        <span>Effektiv: {formatResolvedField(field, options)}</span>
        <span className="v2-field-meta-source">
          <span>Quelle:</span>
          <span className={sourceChipClass(source === "computed" ? "settings" : source, missingRequired)}>{field.sourceLabel}</span>
        </span>
        <span>{options?.extraHint || field.hint}</span>
      </span>
    );
  }

  function labelWithReset(label: string, field: keyof ProductDraft): JSX.Element {
    const value = draftValues?.[field];
    const active = value !== null && value !== undefined && value !== "";
    return (
      <span className="v2-field-meta-row">
        <span>{label}</span>
        {active ? (
          <Button
            type="link"
            size="small"
            className="v2-field-reset"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              resetField(field);
            }}
          >
            Zuruecksetzen
          </Button>
        ) : null}
      </span>
    );
  }

  function openCreateModal(): void {
    const draft = productDraftFromRow(undefined);
    setEditing(null);
    form.setFieldsValue(draft);
    setLogisticsManualOverride(draft.logisticsPerUnitEur != null);
    setAdvancedOpenKeys([]);
    setModalOpen(true);
  }

  function openBulkModal(): void {
    bulkForm.setFieldsValue({
      ...BULK_EDIT_INITIAL,
      scope: "filtered",
      selectedSkus: bulkCandidateRows.map((row) => row.sku),
    });
    setBulkModalOpen(true);
  }

  function extractTemplateAndFields(product: Record<string, unknown>): {
    template: Record<string, unknown>;
    fields: Record<string, unknown>;
  } {
    const templateSource = (product.template && typeof product.template === "object")
      ? product.template as Record<string, unknown>
      : {};
    const fieldSource = (templateSource.fields && typeof templateSource.fields === "object")
      ? templateSource.fields as Record<string, unknown>
      : templateSource;
    return {
      template: templateSource,
      fields: fieldSource,
    };
  }

  function validateBulkInput(values: BulkEditDraft, targetSkus: string[]): void {
    if (!targetSkus.length) {
      throw new Error("Keine aktiven/prelaunch SKUs im aktuellen Zielumfang.");
    }
    const hasAnyField = (
      values.applyTemplateUnitPriceUsd
      || values.applyAvgSellingPriceGrossEUR
      || values.applySellerboardMarginPct
      || values.applyMoqUnits
      || values.applyProductionLeadTimeDaysDefault
      || values.applyTemplateTransitDays
      || values.applyTemplateDdp
    );
    if (!hasAnyField) {
      throw new Error("Bitte mindestens ein Feld für den Bulk-Update aktivieren.");
    }

    const requireFinite = (flag: boolean, value: unknown, label: string): void => {
      if (!flag) return;
      const number = Number(value);
      if (!Number.isFinite(number)) {
        throw new Error(`Bitte gültigen Wert setzen: ${label}.`);
      }
    };
    requireFinite(values.applyTemplateUnitPriceUsd, values.templateUnitPriceUsd, "Ø EK (USD)");
    requireFinite(values.applyAvgSellingPriceGrossEUR, values.avgSellingPriceGrossEUR, "Ø VK (EUR)");
    requireFinite(values.applySellerboardMarginPct, values.sellerboardMarginPct, "Marge (%)");
    requireFinite(values.applyMoqUnits, values.moqUnits, "MOQ");
    requireFinite(values.applyProductionLeadTimeDaysDefault, values.productionLeadTimeDaysDefault, "Production Lead Time");
    requireFinite(values.applyTemplateTransitDays, values.templateTransitDays, "Transit-Tage");
  }

  async function applyBulkEdit(values: BulkEditDraft): Promise<void> {
    const validSkuSet = new Set(bulkCandidateRows.map((row) => row.sku));
    const targetSkus = values.scope === "selected"
      ? (Array.isArray(values.selectedSkus) ? values.selectedSkus : [])
        .map((sku) => String(sku || "").trim())
        .filter((sku) => sku && validSkuSet.has(sku))
      : bulkCandidateRows.map((row) => row.sku).filter((sku) => validSkuSet.has(sku));
    const targetSkuSet = new Set(targetSkus);
    validateBulkInput(values, targetSkus);
    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const products = Array.isArray(next.products) ? [...next.products] : [];
      const now = nowIso();
      let updatedCount = 0;

      next.products = products.map((entry) => {
        const product = entry as Record<string, unknown>;
        const sku = String(product.sku || "").trim();
        if (!sku || !targetSkuSet.has(sku)) return product;
        const status = String(product.status || "active").trim().toLowerCase();
        const inScope = status === "active" || status === "prelaunch" || status === "aktiv" || status === "not_launched" || status === "planned";
        if (!inScope) return product;

        const updated: Record<string, unknown> = { ...product };
        const { template, fields } = extractTemplateAndFields(product);
        const nextFields: Record<string, unknown> = { ...fields };

        if (values.applyAvgSellingPriceGrossEUR) {
          updated.avgSellingPriceGrossEUR = Number(values.avgSellingPriceGrossEUR);
        }
        if (values.applySellerboardMarginPct) {
          updated.sellerboardMarginPct = Number(values.sellerboardMarginPct);
        }
        if (values.applyMoqUnits) {
          updated.moqUnits = Math.max(0, Math.round(Number(values.moqUnits)));
        }
        if (values.applyProductionLeadTimeDaysDefault) {
          updated.productionLeadTimeDaysDefault = Math.max(0, Math.round(Number(values.productionLeadTimeDaysDefault)));
        }
        if (values.applyTemplateUnitPriceUsd) {
          nextFields.unitPriceUsd = Number(values.templateUnitPriceUsd);
        }
        if (values.applyTemplateTransitDays) {
          nextFields.transitDays = Math.max(0, Math.round(Number(values.templateTransitDays)));
        }
        if (values.applyTemplateDdp) {
          nextFields.ddp = Boolean(values.templateDdp);
        }

        updated.template = {
          ...template,
          scope: template.scope || "SKU",
          name: template.name || "Standard (SKU)",
          fields: nextFields,
        };
        updated.updatedAt = now;
        updatedCount += 1;
        return updated;
      });

      if (!updatedCount) {
        throw new Error("Keine passenden aktiven/prelaunch SKUs im Zielumfang gefunden.");
      }

      return next;
    }, "v2:products:bulk-update");
    message.success(`Bulk-Update gespeichert (${targetSkus.length} SKU${targetSkus.length === 1 ? "" : "s"}).`);
    setBulkModalOpen(false);
    bulkForm.resetFields();
  }

  async function handleSave(values: ProductDraft): Promise<void> {
    if (modalCollab.readOnly) {
      throw new Error("Dieses Produkt wird gerade von einem anderen Nutzer bearbeitet.");
    }
    const sku = values.sku.trim();
    if (!sku) {
      throw new Error("SKU ist erforderlich.");
    }
    await saveWith((current) => {
      const next = ensureAppStateV2(current);
      const products = Array.isArray(next.products) ? [...next.products] : [];
      const lowerSku = sku.toLowerCase();
      const duplicate = products.find((entry) => {
        const product = entry as Record<string, unknown>;
        return String(product.sku || "").toLowerCase() === lowerSku
          && String(product.id || "") !== String(values.id || "");
      });
      if (duplicate) {
        throw new Error("SKU existiert bereits.");
      }

      const existingIndex = products.findIndex((entry) => String((entry as Record<string, unknown>).id || "") === String(values.id || ""));
      const existing = existingIndex >= 0 ? products[existingIndex] as Record<string, unknown> : null;
      const now = nowIso();

      const templateFields: Record<string, unknown> = {
        unitPriceUsd: values.templateUnitPriceUsd,
        transportMode: values.templateTransportMode,
        productionDays: values.templateProductionDays,
        transitDays: values.templateTransitDays,
        freightEur: values.templateFreightEur,
        dutyPct: values.templateDutyPct,
        vatImportPct: values.templateVatImportPct,
        fxRate: values.templateFxRate,
        currency: values.templateCurrency,
        ddp: values.templateDdp,
      };

      const payload: Record<string, unknown> = {
        ...(existing || {}),
        id: values.id || existing?.id || randomId("prod"),
        sku,
        alias: values.alias.trim() || sku,
        hsCode: String(values.hsCode || "").trim(),
        goodsDescription: String(values.goodsDescription || "").trim(),
        supplierId: values.supplierId || "",
        categoryId: values.categoryId || null,
        status: values.status || "active",
        avgSellingPriceGrossEUR: values.avgSellingPriceGrossEUR,
        sellerboardMarginPct: values.sellerboardMarginPct,
        moqUnits: values.moqUnits,
        safetyStockDohOverride: values.safetyStockDohOverride,
        foCoverageDohOverride: values.foCoverageDohOverride,
        moqOverrideUnits: values.moqOverrideUnits,
        landedUnitCostEur: values.landedUnitCostEur,
        logisticsPerUnitEur: values.logisticsPerUnitEur,
        freightPerUnitEur: values.logisticsPerUnitEur,
        productionLeadTimeDaysDefault: values.productionLeadTimeDaysDefault,
        template: {
          scope: "SKU",
          name: "Standard (SKU)",
          fields: templateFields,
        },
        updatedAt: now,
      };

      if (!payload.createdAt) {
        payload.createdAt = now;
      }

      const completeness = evaluateProductCompletenessV2({
        product: payload,
        state: next as unknown as Record<string, unknown>,
      });
      if (completeness.status === "blocked" && completeness.blockScope) {
        const fields = completeness.blockingMissing.map((entry) => entry.label).slice(0, 5).join(", ");
        throw new Error(`Blockierende Stammdaten fehlen: ${fields}${completeness.blockingMissing.length > 5 ? " ..." : ""}`);
      }

      if (existingIndex >= 0) {
        products[existingIndex] = payload;
      } else {
        products.push(payload);
      }
      next.products = products;
      return next;
    }, editing ? "v2:products:update" : "v2:products:create");
    modalCollab.clearDraft();
    setEditing(null);
    setModalOpen(false);
    setLogisticsManualOverride(false);
    form.resetFields();
  }

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <div className="v2-page-head">
          <div>
            <Title level={3}>Produkte</Title>
            <Paragraph>
              Produktstammdaten fuer Tagesbetrieb und Logistik-Workflow mit klarer Default-/Override-Anzeige.
            </Paragraph>
          </div>
        </div>
        <div className="v2-toolbar">
          <div className="v2-toolbar-row">
            <Space wrap>
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Suche SKU, Alias, Supplier, Kategorie, HS-Code, Warenbeschreibung"
                style={{ width: 340, maxWidth: "100%" }}
              />
              <Select
                value={statusFilter}
                onChange={(value) => setStatusFilter(value)}
                options={[
                  { value: "all", label: "Alle" },
                  { value: "active", label: "Aktiv" },
                  { value: "prelaunch", label: "Noch nicht gelauncht" },
                  { value: "inactive", label: "Inaktiv" },
                ]}
                style={{ width: 140, maxWidth: "100%" }}
              />
              <div className="v2-products-issue-filters">
                <button
                  type="button"
                  className={`v2-proj-filter-btn ${issueFilter === "all" ? "is-active" : ""}`}
                  onClick={() => setIssueFilter("all")}
                >
                  Alle
                </button>
                <button
                  type="button"
                  className={`v2-proj-filter-btn ${issueFilter === "needs_fix" ? "is-active" : ""}`}
                  onClick={() => setIssueFilter("needs_fix")}
                >
                  Nur korrigieren
                </button>
                <button
                  type="button"
                  className={`v2-proj-filter-btn ${issueFilter === "revenue" ? "is-active" : ""}`}
                  onClick={() => setIssueFilter("revenue")}
                >
                  Umsatzrelevant
                </button>
                <button
                  type="button"
                  className={`v2-proj-filter-btn ${issueFilter === "blocked" ? "is-active" : ""}`}
                  onClick={() => setIssueFilter("blocked")}
                >
                  Nur Blocker
                </button>
              </div>
              <Segmented
                value={productsGridMode}
                onChange={(value) => setProductsGridMode(value as "management" | "logistics")}
                options={[
                  { value: "management", label: "Management" },
                  { value: "logistics", label: "Logistik" },
                ]}
              />
              <Button
                type="primary"
                onClick={openCreateModal}
              >
                Produkt hinzufuegen
              </Button>
              <Button onClick={openBulkModal}>
                Bulk bearbeiten
              </Button>
            </Space>
            <Space wrap>
              <Tag color={issueCounts.needsFix > 0 ? "gold" : "green"}>Korrekturbedarf: {issueCounts.needsFix}</Tag>
              <Tag color={issueCounts.revenue > 0 ? "volcano" : "green"}>Umsatzrelevant: {issueCounts.revenue}</Tag>
              <Tag color={issueCounts.blocked > 0 ? "red" : "green"}>Blocker: {issueCounts.blocked}</Tag>
            </Space>
            {saving ? <Tag color="processing">Speichern...</Tag> : null}
            {lastSavedAt ? <Tag color="green">Gespeichert: {new Date(lastSavedAt).toLocaleTimeString("de-DE")}</Tag> : null}
          </div>
        </div>
      </Card>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {loading ? <Alert type="info" showIcon message="Workspace wird geladen..." /> : null}

      <Card>
        <div className="v2-category-tools">
          <Text type="secondary">{rows.length} Produkte in {groupedRows.length} Kategorien</Text>
          <div className="v2-actions-inline">
            <Button
              size="small"
              onClick={() => setExpandedCategories(groupedRows.map((group) => group.key))}
              disabled={!groupedRows.length}
            >
              Alles auf
            </Button>
            <Button
              size="small"
              onClick={() => setExpandedCategories([])}
              disabled={!expandedCategories.length}
            >
              Alles zu
            </Button>
          </div>
        </div>

        {!groupedRows.length ? (
          <Text type="secondary">Keine Produkte für den aktuellen Filter.</Text>
        ) : (
          <Collapse
            className="v2-category-collapse"
            activeKey={expandedCategories}
            onChange={(nextKeys) => setExpandedCategories((Array.isArray(nextKeys) ? nextKeys : [nextKeys]).map(String))}
            items={groupedRows.map((group) => ({
              key: group.key,
              label: (
                <Space>
                  <Text strong>{group.label}</Text>
                  <span className="v2-category-count">{group.rows.length} Produkte</span>
                </Space>
              ),
              children: (
                <div className="v2-products-grid-host">
                  <TanStackGrid
                    className="v2-products-grid-wrap"
                    data={group.rows}
                    columns={columns}
                    minTableWidth={productsGridMode === "management" ? 1120 : 940}
                    tableLayout="fixed"
                  />
                </div>
              ),
            }))}
          />
        )}
      </Card>

      <Modal
        title="Bulk-Stammdaten bearbeiten"
        rootClassName="v2-form-modal"
        open={bulkModalOpen}
        onCancel={() => {
          setBulkModalOpen(false);
          bulkForm.resetFields();
        }}
        onOk={() => {
          void bulkForm.validateFields().then((values) => applyBulkEdit(values)).catch(() => {});
        }}
        width={900}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 10 }}
          message={`Bulk-Editor für aktive/prelaunch SKUs (${bulkCandidateRows.length} verfügbar)`}
          description="Bulk-Änderungen schreiben explizit auf Produkt-Ebene. Herkunft in Modal/Liste bleibt danach konsistent als „Produkt“."
        />
        <Form<BulkEditDraft>
          form={bulkForm}
          layout="vertical"
          initialValues={BULK_EDIT_INITIAL}
        >
          <div className="v2-form-row">
            <Form.Item name="scope" label="Zielumfang" style={{ flex: 1 }}>
              <Select
                options={[
                  { value: "filtered", label: "Alle aktiven/prelaunch aus aktuellem Filter" },
                  { value: "selected", label: "Manuelle SKU-Auswahl" },
                ]}
              />
            </Form.Item>
            <Form.Item label="Ziel-SKUs (Preview)" style={{ width: 220 }}>
              <Input value={String(bulkTargetSkus.length)} disabled />
            </Form.Item>
          </div>

          {bulkDraft.scope === "selected" ? (
            <Form.Item name="selectedSkus" label="SKUs auswählen">
              <Select
                mode="multiple"
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="SKU(s) wählen"
                options={bulkSkuOptions}
              />
            </Form.Item>
          ) : null}

          <div className="v2-bulk-grid">
            <div className="v2-bulk-field-row">
              <Form.Item name="applyTemplateUnitPriceUsd" valuePropName="checked" style={{ marginBottom: 0 }}>
                <Checkbox>Ø EK (USD)</Checkbox>
              </Form.Item>
              <Tag className={sourceChipClass("product", false)}>Produkt</Tag>
              <Form.Item name="templateUnitPriceUsd" style={{ marginBottom: 0, minWidth: 180 }}>
                <DeNumberInput mode="decimal" min={0} disabled={!bulkDraft.applyTemplateUnitPriceUsd} />
              </Form.Item>
            </div>

            <div className="v2-bulk-field-row">
              <Form.Item name="applyAvgSellingPriceGrossEUR" valuePropName="checked" style={{ marginBottom: 0 }}>
                <Checkbox>Ø VK (EUR)</Checkbox>
              </Form.Item>
              <Tag className={sourceChipClass("product", false)}>Produkt</Tag>
              <Form.Item name="avgSellingPriceGrossEUR" style={{ marginBottom: 0, minWidth: 180 }}>
                <DeNumberInput mode="decimal" min={0} disabled={!bulkDraft.applyAvgSellingPriceGrossEUR} />
              </Form.Item>
            </div>

            <div className="v2-bulk-field-row">
              <Form.Item name="applySellerboardMarginPct" valuePropName="checked" style={{ marginBottom: 0 }}>
                <Checkbox>Marge (%)</Checkbox>
              </Form.Item>
              <Tag className={sourceChipClass("product", false)}>Produkt</Tag>
              <Form.Item name="sellerboardMarginPct" style={{ marginBottom: 0, minWidth: 180 }}>
                <DeNumberInput mode="percent" min={0} max={100} disabled={!bulkDraft.applySellerboardMarginPct} />
              </Form.Item>
            </div>

            <div className="v2-bulk-field-row">
              <Form.Item name="applyMoqUnits" valuePropName="checked" style={{ marginBottom: 0 }}>
                <Checkbox>MOQ (Units)</Checkbox>
              </Form.Item>
              <Tag className={sourceChipClass("product", false)}>Produkt</Tag>
              <Form.Item name="moqUnits" style={{ marginBottom: 0, minWidth: 180 }}>
                <DeNumberInput mode="int" min={0} disabled={!bulkDraft.applyMoqUnits} />
              </Form.Item>
            </div>

            <div className="v2-bulk-field-row">
              <Form.Item name="applyProductionLeadTimeDaysDefault" valuePropName="checked" style={{ marginBottom: 0 }}>
                <Checkbox>Production Lead Time (Tage)</Checkbox>
              </Form.Item>
              <Tag className={sourceChipClass("product", false)}>Produkt</Tag>
              <Form.Item name="productionLeadTimeDaysDefault" style={{ marginBottom: 0, minWidth: 180 }}>
                <DeNumberInput mode="int" min={0} disabled={!bulkDraft.applyProductionLeadTimeDaysDefault} />
              </Form.Item>
            </div>

            <div className="v2-bulk-field-row">
              <Form.Item name="applyTemplateTransitDays" valuePropName="checked" style={{ marginBottom: 0 }}>
                <Checkbox>Transit-Tage</Checkbox>
              </Form.Item>
              <Tag className={sourceChipClass("product", false)}>Produkt</Tag>
              <Form.Item name="templateTransitDays" style={{ marginBottom: 0, minWidth: 180 }}>
                <DeNumberInput mode="int" min={0} disabled={!bulkDraft.applyTemplateTransitDays} />
              </Form.Item>
            </div>

            <div className="v2-bulk-field-row">
              <Form.Item name="applyTemplateDdp" valuePropName="checked" style={{ marginBottom: 0 }}>
                <Checkbox>DDP / Incoterm-Flag</Checkbox>
              </Form.Item>
              <Tag className={sourceChipClass("product", false)}>Produkt</Tag>
              <Form.Item name="templateDdp" style={{ marginBottom: 0, minWidth: 180 }}>
                <Select
                  disabled={!bulkDraft.applyTemplateDdp}
                  options={[
                    { value: true, label: "DDP = Ja" },
                    { value: false, label: "DDP = Nein" },
                  ]}
                />
              </Form.Item>
            </div>
          </div>
        </Form>
      </Modal>

      <Modal
        title={editing ? `Produkt bearbeiten: ${editing.sku}` : "Produkt hinzufuegen"}
        rootClassName="v2-form-modal"
        open={modalOpen}
        onCancel={() => {
          modalCollab.clearDraft();
          setModalOpen(false);
          setLogisticsManualOverride(false);
          setAdvancedOpenKeys([]);
        }}
        onOk={() => {
          if (modalCollab.readOnly) {
            Modal.warning({
              title: "Nur Lesemodus",
              content: `${modalCollab.remoteUserLabel || "Kollege"} bearbeitet dieses Produkt. Bitte Bearbeitung übernehmen oder warten.`,
            });
            return;
          }
          void form.validateFields()
            .then((values) => handleSave(values))
            .catch((saveError: unknown) => {
              focusFirstIssueField();
              const errorMessage = saveError instanceof Error
                ? saveError.message
                : "Stammdaten prüfen";
              message.warning(errorMessage);
            });
        }}
        width={1060}
      >
        {modalCollab.banner ? (
          <Alert
            style={{ marginBottom: 10 }}
            type={modalCollab.banner.tone}
            showIcon
            message={modalCollab.banner.text}
            action={modalCollab.readOnly ? (
              <Button size="small" onClick={modalCollab.takeOver}>
                Bearbeitung uebernehmen
              </Button>
            ) : null}
          />
        ) : null}
        {modalCollab.readOnly && modalCollab.remoteDraftVersion > 0 ? (
          <Tag color="orange" style={{ marginBottom: 10 }}>
            Entwurf von {modalCollab.remoteUserLabel || "Kollege"} wird live gespiegelt.
          </Tag>
        ) : null}
        <Form<ProductDraft>
          name="v2-products-modal"
          form={form}
          layout="vertical"
          disabled={modalCollab.readOnly}
          onValuesChange={(changedValues) => {
            if (modalCollab.readOnly) return;
            modalCollab.publishDraftPatch(changedValues as Record<string, unknown>);
          }}
        >
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>

          {draftCompleteness.status !== "ok" ? (
            <Alert
              style={{ marginBottom: 10 }}
              type={draftCompleteness.status === "blocked" && draftCompleteness.blockScope ? "error" : "warning"}
              showIcon
              message={draftCompleteness.status === "blocked" && draftCompleteness.blockScope
                ? "Blockierende Stammdaten fehlen"
                : "Stammdaten prüfen"}
              description={(
                <Space direction="vertical" size={8} style={{ width: "100%" }}>
                  <span>
                    {[
                      draftCompleteness.blockingMissing.length
                        ? `Blocker: ${draftCompleteness.blockingMissing.map((entry) => entry.label).join(", ")}`
                        : null,
                      draftCompleteness.importantMissing.length
                        ? `Wichtig: ${draftCompleteness.importantMissing.map((entry) => entry.label).join(", ")}`
                        : null,
                    ].filter(Boolean).join(" · ")}
                  </span>
                  {orderedFieldIssues.length ? (
                    <div className="v2-issue-chip-row">
                      {orderedFieldIssues.map((issue) => (
                        <Button
                          key={String(issue.field)}
                          size="small"
                          className={`v2-issue-chip ${issue.level === "error" ? "is-error" : "is-warning"}`}
                          onClick={() => focusIssueField(issue.field)}
                        >
                          {issue.label}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </Space>
              )}
            />
          ) : null}

          <div className="v2-form-section">
            <div className="v2-form-section-head">
              <Title level={5} className="v2-form-section-title">Basis</Title>
              <span className="v2-form-section-desc">Identitaet, Zuordnung und Logistik-Referenzdaten.</span>
            </div>
            <div className="v2-form-row">
              <Form.Item name="sku" label="SKU" style={{ flex: 1 }} rules={[{ required: true, message: "SKU fehlt." }]}>
                <Input />
              </Form.Item>
              <Form.Item name="alias" label="Alias" style={{ flex: 1 }} rules={[{ required: true, message: "Alias fehlt." }]}>
                <Input />
              </Form.Item>
              <Form.Item name="status" label="Status" style={{ width: 140 }}>
                <Select options={STATUS_OPTIONS} />
              </Form.Item>
            </div>
            <div className="v2-form-row">
              <Form.Item name="categoryId" label="Kategorie" style={{ flex: 1 }}>
                <Select
                  allowClear
                  options={categories.map((entry) => ({ value: entry.id, label: entry.name }))}
                />
              </Form.Item>
              <Form.Item name="supplierId" label="Supplier" style={{ flex: 1 }}>
                <Select
                  allowClear
                  options={suppliers.map((entry) => ({ value: entry.id, label: entry.name }))}
                />
              </Form.Item>
              <Form.Item
                name="hsCode"
                label="HS-Code"
                style={{ flex: 1 }}
                validateStatus={fieldValidateStatus("hsCode")}
                help={fieldHelp("hsCode")}
              >
                <Input placeholder="z. B. 3926.90.97" />
              </Form.Item>
            </div>
            <div className="v2-form-row">
              <Form.Item
                name="goodsDescription"
                label="Warenbeschreibung"
                style={{ gridColumn: "1 / -1" }}
                validateStatus={fieldValidateStatus("goodsDescription")}
                help={fieldHelp("goodsDescription")}
              >
                <Input.TextArea rows={2} placeholder="Kurzbeschreibung fuer Zoll / Logistiker" />
              </Form.Item>
            </div>
          </div>

          <div className="v2-form-section">
            <div className="v2-form-section-head">
              <Title level={5} className="v2-form-section-title">Preise & Kosten (operativ)</Title>
              <span className="v2-form-section-desc">Kerndaten fuer Planung sowie FO/PO-Prefill.</span>
            </div>
            <div className="v2-form-row">
              <Form.Item
                name="avgSellingPriceGrossEUR"
                label="Durchschnittlicher Verkaufspreis (EUR)"
                style={{ flex: 1 }}
                validateStatus={fieldValidateStatus("avgSellingPriceGrossEUR")}
                help={fieldHelp("avgSellingPriceGrossEUR")}
              >
                <DeNumberInput mode="decimal" min={0} />
              </Form.Item>
              <Form.Item
                name="templateUnitPriceUsd"
                label={labelWithReset("Durchschnittlicher EK (USD)", "templateUnitPriceUsd")}
                style={{ flex: 1 }}
                validateStatus={fieldValidateStatus("templateUnitPriceUsd")}
                help={fieldHelp("templateUnitPriceUsd")}
                extra={renderResolvedMeta(resolvedDraft.unitPriceUsd, { digits: 2 })}
              >
                <DeNumberInput mode="decimal" min={0} />
              </Form.Item>
              <Form.Item
                name="landedUnitCostEur"
                label="Durchschnittlicher Einstand (EUR)"
                style={{ flex: 1 }}
                validateStatus={fieldValidateStatus("landedUnitCostEur")}
                help={fieldHelp("landedUnitCostEur")}
                extra={<span className="v2-field-meta">Landed Cost je Einheit laut Ist-/Logistikdaten.</span>}
              >
                <DeNumberInput mode="decimal" min={0} />
              </Form.Item>
            </div>
            <div className="v2-form-row">
              <Form.Item
                name="logisticsPerUnitEur"
                label={labelWithReset("Ø Shipping China->Lager/3PL (EUR/Stk)", "logisticsPerUnitEur")}
                style={{ gridColumn: "1 / -1" }}
                extra={(
                  <span className="v2-field-meta">
                    <span>Effektiv: {formatNumber(asNumber(draftValues?.logisticsPerUnitEur), 2)}</span>
                    <span className="v2-field-meta-source">
                      <span>Quelle:</span>
                      <span className={sourceChipClass(
                        logisticsManualOverride
                          ? "product"
                          : (resolvedDraft.logisticsPerUnitEur.source === "computed"
                            ? "settings"
                            : resolvedDraft.logisticsPerUnitEur.source),
                        false,
                      )}
                      >
                        {logisticsManualOverride ? "Produkt" : resolvedDraft.logisticsPerUnitEur.sourceLabel}
                      </span>
                    </span>
                    <span>Vorschlag: {formatNumber(asNumber(shippingSuggestion.value), 2)} EUR/Stk (Formel: Einstand (EUR) - EK in EUR)</span>
                    <span>EK in EUR (aus USD/FX): {formatNumber(asNumber(shippingSuggestion.goodsCostEur), 2)} EUR/Stk</span>
                    <span>FX-Referenz: {formatNumber(asNumber(shippingSuggestion.fxUsed), 4)} USD je EUR</span>
                    <span>Kann je nach Datenbasis auch Zoll/EUSt/Importnebenkosten enthalten.</span>
                  </span>
                )}
              >
                <DeNumberInput
                  mode="decimal"
                  min={0}
                  onChange={() => setLogisticsManualOverride(true)}
                />
              </Form.Item>
            </div>
          </div>

          <div className="v2-form-section">
            <div className="v2-form-section-head">
              <Title level={5} className="v2-form-section-title">Lieferzeit</Title>
              <span className="v2-form-section-desc">Operative Hauptwerte fuer Produktions- und Transitdauer.</span>
            </div>
            <div className="v2-form-row">
              <Form.Item
                name="productionLeadTimeDaysDefault"
                label={labelWithReset("Production Lead Time (Tage)", "productionLeadTimeDaysDefault")}
                style={{ flex: 1 }}
                validateStatus={fieldValidateStatus("productionLeadTimeDaysDefault")}
                help={fieldHelp("productionLeadTimeDaysDefault")}
                extra={renderResolvedMeta(resolvedDraft.productionLeadDays, { digits: 0 })}
              >
                <DeNumberInput mode="int" min={0} />
              </Form.Item>
              <Form.Item
                name="templateTransitDays"
                label={labelWithReset("Transit-Tage", "templateTransitDays")}
                style={{ flex: 1 }}
                extra={renderResolvedMeta(resolvedDraft.transitDays, { digits: 0 })}
              >
                <DeNumberInput mode="int" min={0} />
              </Form.Item>
              <Form.Item
                name="templateTransportMode"
                label="Transportmodus"
                style={{ flex: 1 }}
                extra={renderResolvedMeta(resolvedDraft.transportMode, { kind: "text" })}
              >
                <Select options={TRANSPORT_MODES.map((mode) => ({ value: mode, label: mode }))} />
              </Form.Item>
            </div>
          </div>

          <Collapse
            className="v2-inline-collapse"
            activeKey={advancedOpenKeys}
            onChange={(nextKeys) => {
              const list = Array.isArray(nextKeys) ? nextKeys : [nextKeys];
              setAdvancedOpenKeys(list.map(String).filter(Boolean));
            }}
            items={[
              {
                key: "advanced",
                label: "Erweitert",
                children: (
                  <div className="v2-form-section v2-form-section-nested">
                    <div className="v2-form-section-head">
                      <Title level={5} className="v2-form-section-title">Policies & Beschaffungs-Template</Title>
                      <span className="v2-form-section-desc">Optional: produktspezifische Overrides und tiefe Template-Defaults.</span>
                    </div>
                    <div className="v2-form-row">
                      <Form.Item
                        name="moqUnits"
                        label={labelWithReset("MOQ Units", "moqUnits")}
                        style={{ flex: 1 }}
                        validateStatus={fieldValidateStatus("moqUnits")}
                        help={fieldHelp("moqUnits")}
                        extra={renderResolvedMeta(resolvedDraft.moqEffective, { digits: 0 })}
                      >
                        <DeNumberInput mode="int" min={0} />
                      </Form.Item>
                      <Form.Item
                        name="moqOverrideUnits"
                        label={labelWithReset("MOQ Override Units", "moqOverrideUnits")}
                        style={{ flex: 1 }}
                        extra={<span className="v2-field-meta">Nur fuer dieses Produkt. Leer = Defaultkette.</span>}
                      >
                        <DeNumberInput mode="int" min={0} />
                      </Form.Item>
                      <Form.Item
                        name="sellerboardMarginPct"
                        label="Sellerboard Marge %"
                        style={{ flex: 1 }}
                        validateStatus={fieldValidateStatus("sellerboardMarginPct")}
                        help={fieldHelp("sellerboardMarginPct")}
                        extra={<span className="v2-field-meta">Optional fuer Legacy-Kompatibilitaet / Reporting.</span>}
                      >
                        <DeNumberInput mode="percent" min={0} max={100} />
                      </Form.Item>
                    </div>
                    <div className="v2-form-row">
                      <Form.Item
                        name="safetyStockDohOverride"
                        label={labelWithReset("Safety Stock DOH Override", "safetyStockDohOverride")}
                        style={{ flex: 1 }}
                        extra={renderResolvedMeta(resolvedDraft.safetyDohEffective, { digits: 0 })}
                      >
                        <DeNumberInput mode="int" min={0} />
                      </Form.Item>
                      <Form.Item
                        name="foCoverageDohOverride"
                        label={labelWithReset("FO Coverage DOH Override", "foCoverageDohOverride")}
                        style={{ flex: 1 }}
                        extra={renderResolvedMeta(resolvedDraft.coverageDohEffective, { digits: 0 })}
                      >
                        <DeNumberInput mode="int" min={0} />
                      </Form.Item>
                      <Form.Item
                        name="templateCurrency"
                        label="Waehrung"
                        style={{ flex: 1 }}
                        extra={renderResolvedMeta(resolvedDraft.currency, { kind: "text" })}
                      >
                        <Select options={CURRENCIES.map((currency) => ({ value: currency, label: currency }))} />
                      </Form.Item>
                    </div>
                    <div className="v2-form-row">
                      <Form.Item
                        name="templateProductionDays"
                        label="Template Produktionstage"
                        style={{ flex: 1 }}
                        extra={<span className="v2-field-meta">Nur fuer Template-Fallbacks, falls keine operative Lead-Time gepflegt ist.</span>}
                      >
                        <DeNumberInput mode="int" min={0} />
                      </Form.Item>
                      <Form.Item
                        name="templateFreightEur"
                        label="Template Logistik/Stk (EUR)"
                        style={{ flex: 1 }}
                        extra={<span className="v2-field-meta">Fallback, wenn kein produktspezifischer Shipping-Wert gesetzt ist.</span>}
                      >
                        <DeNumberInput mode="decimal" min={0} />
                      </Form.Item>
                      <Form.Item
                        name="templateFxRate"
                        label={labelWithReset("FX Rate (USD je EUR)", "templateFxRate")}
                        style={{ flex: 1 }}
                        extra={renderResolvedMeta(resolvedDraft.fxRate, { digits: 4 })}
                      >
                        <DeNumberInput mode="fx" min={0} />
                      </Form.Item>
                    </div>
                    <div className="v2-form-row">
                      <Form.Item
                        name="templateDutyPct"
                        label="Zoll %"
                        style={{ flex: 1 }}
                        extra={renderResolvedMeta(resolvedDraft.dutyPct, { digits: 2 })}
                      >
                        <DeNumberInput mode="percent" min={0} max={100} />
                      </Form.Item>
                      <Form.Item
                        name="templateVatImportPct"
                        label="EUSt %"
                        style={{ flex: 1 }}
                        extra={renderResolvedMeta(resolvedDraft.eustPct, { digits: 2 })}
                      >
                        <DeNumberInput mode="percent" min={0} max={100} />
                      </Form.Item>
                      <Form.Item
                        name="templateDdp"
                        label="Incoterm / DDP"
                        valuePropName="checked"
                        validateStatus={fieldValidateStatus("templateDdp")}
                        help={fieldHelp("templateDdp")}
                        extra={renderResolvedMeta(resolvedDraft.ddp, { kind: "boolean" })}
                      >
                        <Checkbox>DDP aktiv (Door-to-Door, Importkosten im Lieferpreis)</Checkbox>
                      </Form.Item>
                    </div>
                  </div>
                ),
              },
              {
                key: "seasonality",
                label: "Saisonalitaet (berechnet)",
                children: (
                  <div className="v2-form-section v2-form-section-nested">
                    <div className="v2-form-section-head">
                      <Title level={5} className="v2-form-section-title">Saisonalitaet aus Forecast-CSV</Title>
                      <span className="v2-form-section-desc">Jan-Dez Faktoren aus den importierten Monats-Units je SKU.</span>
                    </div>
                    <Paragraph type="secondary" style={{ marginBottom: 8 }}>
                      Wir nehmen die Monatsabsatze (Units) aus der importierten CSV, bilden fuer jeden Kalendermonat
                      (z. B. alle Januare) den Durchschnitt und teilen ihn durch den durchschnittlichen Monatswert
                      ueber alle Monate. So entstehen Multiplikatoren, die zeigen, wie stark oder schwach ein Monat
                      typischerweise im Vergleich zum Durchschnitt ist.
                    </Paragraph>
                    {!seasonalitySku ? (
                      <Alert
                        type="info"
                        showIcon
                        message="Keine SKU gesetzt"
                        description="Saisonalitaet wird angezeigt, sobald eine SKU im Produkt gesetzt ist."
                      />
                    ) : !seasonalityProfile ? (
                      <Alert
                        type="warning"
                        showIcon
                        message={`Keine Forecast-Daten fuer SKU ${seasonalitySku}`}
                        description="Bitte Forecast-CSV importieren. Das Profil wird aus den importierten Monats-Units abgeleitet."
                      />
                    ) : (
                      <>
                        <Space wrap style={{ marginBottom: 8 }}>
                          <Tag color="blue">
                            Zeitraum: {formatMonthLabel(seasonalityProfile.startMonth)} bis {formatMonthLabel(seasonalityProfile.endMonth)}
                            {" "}({seasonalityProfile.sampleMonthCount} Monate)
                          </Tag>
                          <Tag color={seasonalityProfile.coveredMonthTypes === 12 ? "green" : "gold"}>
                            Kalendermonate mit Daten: {seasonalityProfile.coveredMonthTypes}/12
                          </Tag>
                          <Tag>
                            Ø Monats-Units (Basis): {formatNumber(seasonalityProfile.overallAverage, 1)} (aus {seasonalityProfile.sampleMonthCount} Monatsdaten)
                          </Tag>
                        </Space>
                        <div className="v2-seasonality-chart" role="group" aria-label="Saisonalitaetsfaktoren">
                          {seasonalityChartRows.map((entry) => (
                            <Tooltip
                              key={entry.key}
                              title={`Faktor: ${formatNumber(asNumber(entry.factor), 2)} | Ø Units: ${formatNumber(asNumber(entry.averageUnits), 1)} | Datenpunkte: ${entry.sampleCount}`}
                            >
                              <div className="v2-seasonality-chart-row">
                                <span className="v2-seasonality-month">{entry.monthLabel}</span>
                                <div className="v2-seasonality-bar-track">
                                  <div className="v2-seasonality-average-line" style={{ left: `${(1 / (entry.scaleMax || 1)) * 100}%` }} />
                                  <div
                                    className={`v2-seasonality-bar v2-seasonality-bar--${entry.classification}`}
                                    style={{ width: `${entry.widthPercent}%` }}
                                  />
                                </div>
                                <span className="v2-seasonality-value">
                                  {formatNumber(asNumber(entry.factor), 2)}
                                  <span className="v2-seasonality-subvalue">
                                    {formatNumber(asNumber(entry.averageUnits), 1)} / n={entry.sampleCount}
                                  </span>
                                </span>
                              </div>
                            </Tooltip>
                          ))}
                        </div>
                        <Paragraph type="secondary" style={{ margin: "8px 0 0" }}>
                          Faktor 1,00 = durchschnittlicher Monat, 1,40 = 40 % ueberdurchschnittlich, 0,70 = 30 % unterdurchschnittlich.
                        </Paragraph>
                      </>
                    )}
                  </div>
                ),
              },
              {
                key: "plan-vs-live",
                label: "Plan-vs-Ist (Plan -> Live)",
                children: (
                  <div className="v2-form-section v2-form-section-nested">
                    <div className="v2-form-section-head">
                      <Title level={5} className="v2-form-section-title">Lessons Learned: Plan vs Live/CSV</Title>
                      <span className="v2-form-section-desc">Monatlicher Vergleich nach Übernahme eines Plan-Produkts in eine Live-SKU.</span>
                    </div>
                    {!seasonalitySku ? (
                      <Alert
                        type="info"
                        showIcon
                        message="Keine SKU gesetzt"
                        description="Plan-vs-Ist wird angezeigt, sobald eine SKU im Produkt gesetzt ist."
                      />
                    ) : !latestPlanMapping ? (
                      <Alert
                        type="info"
                        showIcon
                        message="Kein Plan->Live Mapping für diese SKU"
                        description="Die Ansicht wird automatisch verfügbar, sobald ein Plan-Produkt als gelauncht markiert und dieser SKU zugeordnet wurde."
                      />
                    ) : !planVsLiveRows.length ? (
                      <Alert
                        type="warning"
                        showIcon
                        message="Noch keine überlappenden Monatsdaten"
                        description="Für Plan oder Live/CSV sind aktuell keine gemeinsamen Monatswerte vorhanden."
                      />
                    ) : (
                      <>
                        <Space wrap style={{ marginBottom: 8 }}>
                          <Tag color="blue">Plan: {latestPlanMapping.planProductAlias || latestPlanMapping.planProductId}</Tag>
                          <Tag color="green">Live-SKU: {latestPlanMapping.sku}</Tag>
                          <Tag>Übernommen: {latestPlanMapping.mappedAt ? new Date(latestPlanMapping.mappedAt).toLocaleDateString("de-DE") : "—"}</Tag>
                          <Tag>Launch: {latestPlanMapping.launchDate || "—"}</Tag>
                          <Tag color={planVsLiveRows.length >= 12 ? "green" : "gold"}>Monate im Vergleich: {planVsLiveRows.length}</Tag>
                        </Space>
                        <Table
                          size="small"
                          pagination={false}
                          rowKey="month"
                          dataSource={planVsLiveRows}
                          columns={[
                            {
                              title: "Monat",
                              dataIndex: "month",
                              key: "month",
                              render: (value: string) => formatMonthLabel(value),
                            },
                            {
                              title: "Plan Units",
                              dataIndex: "planUnits",
                              key: "planUnits",
                              align: "right" as const,
                              render: (value: unknown) => formatNumber(asNumber(value), 0),
                            },
                            {
                              title: "Live Units (CSV)",
                              dataIndex: "liveUnits",
                              key: "liveUnits",
                              align: "right" as const,
                              render: (value: unknown) => formatNumber(asNumber(value), 0),
                            },
                            {
                              title: "Delta Units",
                              dataIndex: "deltaUnits",
                              key: "deltaUnits",
                              align: "right" as const,
                              render: (value: unknown) => formatNumber(asNumber(value), 0),
                            },
                            {
                              title: "Delta %",
                              dataIndex: "deltaPct",
                              key: "deltaPct",
                              align: "right" as const,
                              render: (value: unknown) => {
                                const parsed = asNumber(value);
                                if (!Number.isFinite(parsed as number)) return "—";
                                return `${formatNumber(parsed, 1)}%`;
                              },
                            },
                          ]}
                        />
                      </>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </Form>
      </Modal>
    </div>
  );
}
