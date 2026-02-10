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
  "#export": () => import("../ui/export.js"),
  "#plan": () => import("../ui/plan.js"),
  "#debug": () => import("../ui/debug.js"),
};

export const WIDE_ROUTES = new Set([
  "#dashboard",
  "#po",
  "#inventory",
  "#forecast",
  "#produkte",
  "#payments-export",
]);

export const MENU_SECTIONS = [
  {
    key: "overview",
    label: "Überblick",
    children: [
      { key: "#dashboard", label: "Dashboard" },
    ],
  },
  {
    key: "planning",
    label: "Planung",
    children: [
      { key: "#produkte", label: "Produkte" },
      { key: "#forecast", label: "Absatzprognose" },
      { key: "#inventory", label: "Inventory (Bestände)" },
      { key: "#fo", label: "Forecast Orders (FO)" },
      { key: "#po", label: "Bestellungen (PO)" },
      { key: "#suppliers", label: "Suppliers" },
      { key: "#settings", label: "Settings" },
      { key: "#eingaben", label: "Eingaben" },
      { key: "#fixkosten", label: "Fixkosten" },
      { key: "#ust", label: "USt-Vorschau" },
    ],
  },
  {
    key: "tools",
    label: "Werkzeuge",
    children: [
      { key: "#export", label: "Export / Import" },
      { key: "#payments-export", label: "Payments Export" },
      { key: "#debug", label: "Debug" },
      { key: "#plan", label: "Plan" },
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
