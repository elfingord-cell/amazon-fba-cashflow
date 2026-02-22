export const ROUTE_LOADERS = {
  "#dashboard": () => import("../ui/dashboard.js"),
  "#eingaben": () => import("../ui/eingaben.js"),
  "#fixkosten": () => import("../ui/fixkosten.js"),
  "#po": () => import("../ui/po.js"),
  "#forecast": () => import("../ui/forecast.js"),
  "#fo": () => import("../ui/fo.js"),
  "#inventory": () => import("../ui/inventory.js"),
  "#ust": () => import("../ui/ust.js"),
  "#produkte": () => import("../ui/products.js"),
  "#suppliers": () => import("../ui/suppliers.js"),
  "#settings": () => import("../ui/settings.js"),
  "#payments-export": () => import("../ui/paymentsExport.js"),
  "#accounting-export": () => import("../ui/accountantExport.js"),
  "#export": () => import("../ui/export.js"),
  "#plan": () => import("../ui/plan.js"),
  "#debug": () => import("../ui/debug.js"),
};

export const WIDE_ROUTES = new Set([]);

export const MENU_SECTIONS = [
  {
    key: "overview",
    label: "Überblick",
    children: [
      { key: "#dashboard", label: "Dashboard", icon: "dashboard" },
    ],
  },
  {
    key: "planning",
    label: "Planung",
    children: [
      { key: "#produkte", label: "Produkte", icon: "products" },
      { key: "#forecast", label: "Absatzprognose", icon: "forecast" },
      { key: "#inventory", label: "Inventory (Bestände)", icon: "inventory" },
      { key: "#fo", label: "Forecast Orders (FO)", icon: "fo" },
      { key: "#po", label: "Bestellungen (PO)", icon: "po" },
      { key: "#suppliers", label: "Suppliers", icon: "suppliers" },
      { key: "#settings", label: "Settings", icon: "settings" },
      { key: "#eingaben", label: "Cash-in Setup", icon: "inputs" },
      { key: "#fixkosten", label: "Fixkosten", icon: "fixed" },
      { key: "#ust", label: "USt-Vorschau", icon: "tax" },
    ],
  },
  {
    key: "tools",
    label: "Werkzeuge",
    children: [
      { key: "#export", label: "Export / Import", icon: "export" },
      { key: "#payments-export", label: "Payments Export", icon: "payments" },
      { key: "#accounting-export", label: "Buchhalter Export", icon: "accounting" },
      { key: "#debug", label: "Debug", icon: "debug" },
      { key: "#plan", label: "Plan", icon: "plan" },
    ],
  },
];

export function normalizeHash(hash) {
  if (!hash) return "#dashboard";
  return hash.startsWith("#") ? hash : `#${hash}`;
}

export function parseHash(hash) {
  const normalised = normalizeHash(hash || "#dashboard");
  const [base, queryRaw] = normalised.split("?");
  const params = new URLSearchParams(queryRaw || "");
  const query = {};
  params.forEach((value, key) => {
    query[key] = value;
  });
  return { base, query };
}

export function resolveRoute(hash) {
  const { base, query } = parseHash(hash);
  const resolvedBase = ROUTE_LOADERS[base] ? base : "#dashboard";
  return {
    base: resolvedBase,
    query,
    normalized: query && Object.keys(query).length
      ? `${resolvedBase}?${new URLSearchParams(query).toString()}`
      : resolvedBase,
  };
}

export function pickRenderer(mod) {
  if (typeof mod?.default === "function") return mod.default;
  if (typeof mod?.render === "function") return mod.render;
  if (mod?.default && typeof mod.default.render === "function") return mod.default.render;
  if (typeof mod?.mount === "function") return mod.mount;
  return null;
}
