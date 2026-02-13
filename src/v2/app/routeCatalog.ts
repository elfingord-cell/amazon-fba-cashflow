import {
  BugOutlined,
  CalculatorOutlined,
  DashboardOutlined,
  DeploymentUnitOutlined,
  DollarOutlined,
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
} from "@ant-design/icons";
import type { ComponentType } from "react";

import DashboardModule from "../modules/dashboard";
import ProductsModule from "../modules/products";
import ForecastModule from "../modules/forecast";
import InventoryModule from "../modules/inventory";
import FoModule from "../modules/fo";
import PoModule from "../modules/po";
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

export interface V2RouteItem {
  key: string;
  label: string;
  section: "overview" | "planning" | "tools";
  icon: ComponentType;
  Component: ComponentType;
}

export const V2_ROUTES: V2RouteItem[] = [
  { key: "dashboard", label: "Dashboard", section: "overview", icon: DashboardOutlined, Component: DashboardModule },

  { key: "products", label: "Produkte", section: "planning", icon: TagsOutlined, Component: ProductsModule },
  { key: "forecast", label: "Absatzprognose", section: "planning", icon: LineChartOutlined, Component: ForecastModule },
  { key: "inventory", label: "Inventory", section: "planning", icon: InboxOutlined, Component: InventoryModule },
  { key: "fo", label: "Forecast Orders", section: "planning", icon: DeploymentUnitOutlined, Component: FoModule },
  { key: "po", label: "Purchase Orders", section: "planning", icon: ShoppingCartOutlined, Component: PoModule },
  { key: "suppliers", label: "Suppliers", section: "planning", icon: TeamOutlined, Component: SuppliersModule },
  { key: "settings", label: "Settings", section: "planning", icon: SettingOutlined, Component: SettingsModule },
  { key: "inputs", label: "Eingaben", section: "planning", icon: FormOutlined, Component: InputsModule },
  { key: "fixcosts", label: "Fixkosten", section: "planning", icon: DollarOutlined, Component: FixcostsModule },
  { key: "vat", label: "USt Vorschau", section: "planning", icon: CalculatorOutlined, Component: VatModule },

  { key: "export-import", label: "Export / Import", section: "tools", icon: UploadOutlined, Component: ExportImportModule },
  { key: "payments-export", label: "Payments Export", section: "tools", icon: CreditCardOutlined, Component: PaymentsExportModule },
  { key: "accounting-export", label: "Buchhalter Export", section: "tools", icon: FileTextOutlined, Component: AccountingExportModule },
  { key: "plan", label: "Plan", section: "tools", icon: ProjectOutlined, Component: PlanModule },
  { key: "debug", label: "Debug", section: "tools", icon: BugOutlined, Component: DebugModule },
];

export const V2_ROUTE_MAP = Object.fromEntries(
  V2_ROUTES.map((route) => [route.key, route]),
) as Record<string, V2RouteItem>;
