import {
  BugOutlined,
  CalculatorOutlined,
  DashboardOutlined,
  ExperimentOutlined,
  FormOutlined,
  InboxOutlined,
  LineChartOutlined,
  ProjectOutlined,
  SettingOutlined,
  ShoppingCartOutlined,
  TagsOutlined,
  TeamOutlined,
  UploadOutlined,
  CreditCardOutlined,
  FileTextOutlined,
  FundProjectionScreenOutlined,
  PieChartOutlined,
} from "@ant-design/icons";
import { lazy, type ComponentType } from "react";

function lazyRoute(importer: () => Promise<{ default: ComponentType<any> }>): ComponentType<any> {
  return lazy(importer) as unknown as ComponentType<any>;
}

const DashboardModule = lazyRoute(() => import("../modules/dashboard"));
const MonthPlanningModule = lazyRoute(() => import("../modules/month-planning"));
const SandboxModule = lazyRoute(() => import("../modules/sandbox"));
const MethodikModule = lazyRoute(() => import("../modules/methodik"));
const SollIstModule = lazyRoute(() => import("../modules/soll-ist"));
const PlanProductsModule = lazyRoute(() => import("../modules/plan-products"));
const ProductsModule = lazyRoute(() => import("../modules/products"));
const ForecastModule = lazyRoute(() => import("../modules/forecast"));
const AbcInsightsModule = lazyRoute(() => import("../modules/abc-insights"));
const InventorySnapshotPage = lazyRoute(() => import("../modules/inventory/snapshot"));
const InventoryProjectionPage = lazyRoute(() => import("../modules/inventory/projection"));
const SkuPlanningModule = lazyRoute(() => import("../modules/sku-planning"));
const OrdersModule = lazyRoute(() => import("../modules/orders"));
const SuppliersModule = lazyRoute(() => import("../modules/suppliers"));
const SettingsModule = lazyRoute(() => import("../modules/settings"));
const InputsModule = lazyRoute(() => import("../modules/inputs"));
const FixcostsModule = lazyRoute(() => import("../modules/fixcosts"));
const DividendPlanningModule = lazyRoute(() => import("../modules/dividend-planning"));
const VatModule = lazyRoute(() => import("../modules/vat"));
const ExportImportModule = lazyRoute(() => import("../modules/export-import"));
const AccountingExportModule = lazyRoute(() => import("../modules/accounting-export"));
const DebugModule = lazyRoute(() => import("../modules/debug"));

export type V2RouteSection = "cockpit" | "operations" | "masterdata" | "finance" | "system";

export interface V2RouteItem {
  key: string;
  path: string;
  label: string;
  section: V2RouteSection;
  icon: ComponentType;
  Component: ComponentType;
  parentKey?: string;
  sidebarVisible?: boolean;
  menuPath?: string;
  redirectFrom?: string[];
}

export interface V2RouteRedirect {
  from: string;
  to: string;
}

export const V2_ROUTES: V2RouteItem[] = [
  { key: "dashboard", path: "dashboard", label: "Dashboard", section: "cockpit", icon: DashboardOutlined, Component: DashboardModule },
  { key: "monatsplanung", path: "monatsplanung", label: "Monatsplanung", section: "cockpit", icon: ProjectOutlined, Component: MonthPlanningModule },
  { key: "soll-ist", path: "soll-ist", label: "Soll vs. Ist", section: "cockpit", icon: CreditCardOutlined, Component: SollIstModule },

  { key: "forecast", path: "forecast", label: "Absatzprognose", section: "operations", icon: LineChartOutlined, Component: ForecastModule },
  {
    key: "inventory-projection",
    path: "inventory/projektion",
    label: "Bestandsprojektion",
    section: "operations",
    icon: FundProjectionScreenOutlined,
    Component: InventoryProjectionPage,
    parentKey: "inventory",
    redirectFrom: ["inventory", "inventory/projection"],
  },
  {
    key: "inventory-snapshot",
    path: "inventory/snapshot",
    label: "Bestandsaufnahme",
    section: "operations",
    icon: InboxOutlined,
    Component: InventorySnapshotPage,
    parentKey: "inventory",
  },
  {
    key: "orders",
    path: "orders/*",
    menuPath: "orders/po",
    label: "Bestellungen",
    section: "operations",
    icon: ShoppingCartOutlined,
    Component: OrdersModule,
    redirectFrom: ["orders"],
  },
  {
    key: "sku-planning",
    path: "sku-planung",
    label: "SKU Planung",
    section: "operations",
    icon: FundProjectionScreenOutlined,
    Component: SkuPlanningModule,
  },
  {
    key: "closing-inputs",
    path: "abschluss/eingaben",
    label: "Cash-in Setup",
    section: "operations",
    icon: FormOutlined,
    Component: InputsModule,
    redirectFrom: ["inputs"],
  },
  { key: "plan-products", path: "plan-products", label: "Neue Produkte", section: "operations", icon: TagsOutlined, Component: PlanProductsModule },

  { key: "products", path: "products", label: "Produkte", section: "masterdata", icon: TagsOutlined, Component: ProductsModule },
  { key: "suppliers", path: "suppliers", label: "Suppliers", section: "masterdata", icon: TeamOutlined, Component: SuppliersModule },

  {
    key: "closing-fixcosts",
    path: "abschluss/fixkosten",
    label: "Fixkosten",
    section: "finance",
    icon: ProjectOutlined,
    Component: FixcostsModule,
    redirectFrom: ["fixcosts"],
  },
  {
    key: "closing-vat",
    path: "abschluss/ust",
    label: "USt Vorschau",
    section: "finance",
    icon: CalculatorOutlined,
    Component: VatModule,
    redirectFrom: ["vat"],
  },
  {
    key: "closing-accounting",
    path: "abschluss/buchhalter",
    label: "Buchhalter Export",
    section: "finance",
    icon: FileTextOutlined,
    Component: AccountingExportModule,
    redirectFrom: ["accounting-export"],
  },
  {
    key: "closing-dividend-planning",
    path: "abschluss/dividendenplanung",
    label: "Dividendenplanung",
    section: "finance",
    icon: PieChartOutlined,
    Component: DividendPlanningModule,
  },

  { key: "methodik", path: "methodik", label: "Methodik & Regeln", section: "system", icon: CalculatorOutlined, Component: MethodikModule },
  { key: "settings", path: "settings", label: "Settings", section: "system", icon: SettingOutlined, Component: SettingsModule },
  { key: "export-import", path: "export-import", label: "Export / Import", section: "system", icon: UploadOutlined, Component: ExportImportModule },
  { key: "sandbox", path: "sandbox", label: "Sandbox", section: "system", icon: ExperimentOutlined, Component: SandboxModule },
  { key: "abc-insights", path: "abc-insights", label: "ABC Insights", section: "system", icon: PieChartOutlined, Component: AbcInsightsModule },
  {
    key: "debug",
    path: "tools/debug",
    label: "Debug",
    section: "system",
    icon: BugOutlined,
    Component: DebugModule,
    redirectFrom: ["debug"],
  },
];

function normalizeRoutePath(path: string): string {
  return String(path || "").replace(/\/\*$/, "").replace(/^\/+/, "").replace(/\/+$/, "");
}

const ROUTE_META_REDIRECTS: V2RouteRedirect[] = V2_ROUTES.flatMap((route) => {
  const target = normalizeRoutePath(route.menuPath || route.path);
  return (route.redirectFrom || []).map((from) => ({ from, to: target }));
});

export const V2_ROUTE_REDIRECTS: V2RouteRedirect[] = [
  ...ROUTE_META_REDIRECTS,
  { from: "plan", to: "orders/po?view=timeline" },
  { from: "fo", to: "orders/fo" },
  { from: "po", to: "orders/po" },
  { from: "sku", to: "orders/sku" },
  { from: "payments-export", to: "abschluss/buchhalter" },
  { from: "abschluss/payments", to: "abschluss/buchhalter" },
].filter((entry, index, list) => list.findIndex((match) => match.from === entry.from && match.to === entry.to) === index);

export const V2_ROUTE_MAP = Object.fromEntries(
  V2_ROUTES.map((route) => [route.key, route]),
) as Record<string, V2RouteItem>;
