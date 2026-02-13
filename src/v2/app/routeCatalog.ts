import {
  BugOutlined,
  CalculatorOutlined,
  DashboardOutlined,
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
} from "@ant-design/icons";
import type { ComponentType } from "react";

import DashboardModule from "../modules/dashboard";
import ProductsModule from "../modules/products";
import ForecastModule from "../modules/forecast";
import InventorySnapshotPage from "../modules/inventory/snapshot";
import InventoryProjectionPage from "../modules/inventory/projection";
import OrdersModule from "../modules/orders";
import SuppliersModule from "../modules/suppliers";
import SettingsModule from "../modules/settings";
import InputsModule from "../modules/inputs";
import FixcostsModule from "../modules/fixcosts";
import VatModule from "../modules/vat";
import ExportImportModule from "../modules/export-import";
import PaymentsExportModule from "../modules/payments-export";
import AccountingExportModule from "../modules/accounting-export";
import PlanModule from "../modules/plan";
import DebugModule from "../modules/debug";

export type V2RouteSection = "overview" | "operations" | "masterdata" | "closing" | "tools";

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
  { key: "dashboard", path: "dashboard", label: "Dashboard", section: "overview", icon: DashboardOutlined, Component: DashboardModule },

  { key: "forecast", path: "forecast", label: "Absatzprognose", section: "operations", icon: LineChartOutlined, Component: ForecastModule },
  { key: "inventory-snapshot", path: "inventory/snapshot", label: "Bestandsaufnahme", section: "operations", icon: InboxOutlined, Component: InventorySnapshotPage },
  {
    key: "inventory-projection",
    path: "inventory/projektion",
    label: "Bestandsprojektion",
    section: "operations",
    icon: FundProjectionScreenOutlined,
    Component: InventoryProjectionPage,
    redirectFrom: ["inventory", "inventory/projection"],
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
  { key: "plan", path: "plan", label: "Plan", section: "operations", icon: ProjectOutlined, Component: PlanModule },

  { key: "products", path: "products", label: "Produkte", section: "masterdata", icon: TagsOutlined, Component: ProductsModule },
  { key: "suppliers", path: "suppliers", label: "Suppliers", section: "masterdata", icon: TeamOutlined, Component: SuppliersModule },
  { key: "settings", path: "settings", label: "Settings", section: "masterdata", icon: SettingOutlined, Component: SettingsModule },

  {
    key: "closing-inputs",
    path: "abschluss/eingaben",
    label: "Eingaben",
    section: "closing",
    icon: FormOutlined,
    Component: InputsModule,
    redirectFrom: ["inputs"],
  },
  {
    key: "closing-fixcosts",
    path: "abschluss/fixkosten",
    label: "Fixkosten",
    section: "closing",
    icon: ProjectOutlined,
    Component: FixcostsModule,
    redirectFrom: ["fixcosts"],
  },
  {
    key: "closing-vat",
    path: "abschluss/ust",
    label: "USt Vorschau",
    section: "closing",
    icon: CalculatorOutlined,
    Component: VatModule,
    redirectFrom: ["vat"],
  },
  {
    key: "closing-payments",
    path: "abschluss/payments",
    label: "Payments Export",
    section: "closing",
    icon: CreditCardOutlined,
    Component: PaymentsExportModule,
    redirectFrom: ["payments-export"],
  },
  {
    key: "closing-accounting",
    path: "abschluss/buchhalter",
    label: "Buchhalter Export",
    section: "closing",
    icon: FileTextOutlined,
    Component: AccountingExportModule,
    redirectFrom: ["accounting-export"],
  },

  { key: "export-import", path: "export-import", label: "Export / Import", section: "tools", icon: UploadOutlined, Component: ExportImportModule },
  {
    key: "debug",
    path: "tools/debug",
    label: "Debug",
    section: "tools",
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
  { from: "fo", to: "orders/fo" },
  { from: "po", to: "orders/po" },
].filter((entry, index, list) => list.findIndex((match) => match.from === entry.from && match.to === entry.to) === index);

export const V2_ROUTE_MAP = Object.fromEntries(
  V2_ROUTES.map((route) => [route.key, route]),
) as Record<string, V2RouteItem>;
