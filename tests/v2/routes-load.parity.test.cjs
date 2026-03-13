const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { createServer } = require("vite");

test("v2 route smoke: lazy modules resolve via dynamic imports", async () => {
  const root = path.resolve(__dirname, "../..");
  const routerStubPath = path.join(root, "tests/v2/stubs/react-router-dom.mjs");
  const supabaseStubPath = path.join(root, "tests/v2/stubs/supabase-js.mjs");
  const server = await createServer({
    root,
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    resolve: {
      alias: {
        "react-router-dom": routerStubPath,
        "@supabase/supabase-js": supabaseStubPath,
      },
    },
    server: {
      middlewareMode: true,
      hmr: false,
      watch: null,
    },
    optimizeDeps: {
      noDiscovery: true,
      entries: [],
    },
    ssr: {
      noExternal: [
        "react-router-dom",
        "@supabase/supabase-js",
      ],
    },
  });

  try {
    const routeCatalog = await server.ssrLoadModule("/src/v2/app/routeCatalog.ts");
    const ordersTabs = await server.ssrLoadModule("/src/v2/modules/orders/tabs.ts");
    const taxesTabs = await server.ssrLoadModule("/src/v2/modules/taxes/tabs.ts");
    const vatModule = await server.ssrLoadModule("/src/v2/modules/vat/index.tsx");
    const routes = Array.isArray(routeCatalog.V2_ROUTES) ? routeCatalog.V2_ROUTES : [];
    assert.ok(routes.length > 0, "Keine V2-Routen gefunden.");
    assert.equal(
      routes.some((route) => String(route?.key || "") === "monatsplanung"),
      true,
      "Monatsplanung-Route fehlt in V2.",
    );
    assert.equal(
      routes.some((route) => String(route?.key || "") === "plan"),
      false,
      "Plan-Route darf nicht mehr als eigener V2-Tab erscheinen.",
    );
    assert.equal(
      routes.some((route) => String(route?.key || "") === "closing-taxes" && String(route?.path || "") === "abschluss/steuern"),
      true,
      "Steuern-Route fehlt in V2.",
    );
    const redirects = Array.isArray(routeCatalog.V2_ROUTE_REDIRECTS) ? routeCatalog.V2_ROUTE_REDIRECTS : [];
    const planRedirect = redirects.find((entry) => String(entry?.from || "") === "plan");
    assert.ok(planRedirect, "Redirect fuer /v2/plan fehlt.");
    assert.equal(
      String(planRedirect.to || ""),
      "orders/po?view=timeline",
      "Plan-Redirect muss auf PO-Timeline zeigen.",
    );
    const skuRedirect = redirects.find((entry) => String(entry?.from || "") === "sku");
    assert.ok(skuRedirect, "Redirect fuer /v2/sku fehlt.");
    assert.equal(
      String(skuRedirect.to || ""),
      "orders/sku",
      "SKU-Redirect muss auf SKU Sicht zeigen.",
    );
    const legacyVatRedirect = redirects.find((entry) => String(entry?.from || "") === "abschluss/ust");
    assert.ok(legacyVatRedirect, "Redirect fuer /v2/abschluss/ust fehlt.");
    assert.equal(
      String(legacyVatRedirect.to || ""),
      "abschluss/steuern?tab=ust-de",
      "Legacy-USt-Route muss in den neuen Steuern-Shell zeigen.",
    );

    const ordersTabItems = Array.isArray(ordersTabs.ORDERS_TAB_ITEMS) ? ordersTabs.ORDERS_TAB_ITEMS : [];
    assert.equal(
      ordersTabItems.some((entry) => String(entry?.key || "") === "lieferantenausblick" && String(entry?.path || "") === "/v2/orders/lieferantenausblick"),
      true,
      "Bestellungen-Tab Lieferantenausblick fehlt.",
    );
    assert.equal(
      String(ordersTabs.resolveOrdersTab("/v2/orders/lieferantenausblick")),
      "lieferantenausblick",
      "Lieferantenausblick-Pfad wird im Orders-Shell nicht korrekt aufgeloest.",
    );
    const taxesTabItems = Array.isArray(taxesTabs.TAXES_TAB_ITEMS) ? taxesTabs.TAXES_TAB_ITEMS : [];
    assert.deepEqual(
      taxesTabItems.map((entry) => ({ key: String(entry?.key || ""), label: String(entry?.label || "") })),
      [
        { key: "ust-de", label: "USt DE" },
        { key: "oss", label: "OSS" },
        { key: "ertragsteuern", label: "Ertragsteuern" },
      ],
      "Steuern-Shell muss genau die drei Increment-1-Subtabs zeigen.",
    );
    assert.equal(
      String(taxesTabs.buildTaxesTabRoute("ust-de", { month: "2026-04", source: "dashboard" })),
      "/v2/abschluss/steuern?tab=ust-de&month=2026-04&source=dashboard",
      "Dashboard-Deep-Link fuer USt DE muss in den Steuern-Shell mit Tab und Monatskontext zeigen.",
    );
    assert.equal(
      String(taxesTabs.buildTaxesTabRoute("oss", { month: "2026-04", source: "dashboard" })),
      "/v2/abschluss/steuern?tab=oss&month=2026-04&source=dashboard",
      "Dashboard-Deep-Link fuer OSS muss in den Steuern-Shell mit Tab und Monatskontext zeigen.",
    );
    assert.equal(
      typeof vatModule.resolveVatMonthLabelFormatter,
      "function",
      "USt DE muss einen robusten Formatter-Resolver exportieren.",
    );
    assert.equal(
      typeof vatModule.formatVatPaymentMonthLabel,
      "function",
      "USt DE muss das Zahlungsmonat-Label ueber einen testbaren Helper rendern.",
    );
    const safeVatMonthLabel = vatModule.resolveVatMonthLabelFormatter(undefined);
    assert.equal(
      typeof safeVatMonthLabel,
      "function",
      "USt DE muss auch ohne durchgereichten Formatter eine Funktions-Fallback haben.",
    );
    assert.match(
      String(safeVatMonthLabel("2026-04")),
      /2026/,
      "Fallback-Monatslabel fuer USt DE muss ein renderbares Monatslabel liefern.",
    );
    const customVatMonthLabel = vatModule.resolveVatMonthLabelFormatter((month) => `Monat ${month}`);
    assert.equal(
      customVatMonthLabel("2026-04"),
      "Monat 2026-04",
      "USt DE darf einen gueltigen Formatter nicht ueberschreiben.",
    );
    assert.equal(
      vatModule.formatVatPaymentMonthLabel(undefined, undefined),
      "—",
      "USt DE muss ohne Zahlungsmonat ein stabiles Placeholder-Label rendern.",
    );
    assert.match(
      String(vatModule.formatVatPaymentMonthLabel("2026-04", undefined)),
      /2026/,
      "USt DE muss fuer das Zahlungsmonat auch ohne Formatter ein renderbares Monatslabel liefern.",
    );
    assert.equal(
      vatModule.formatVatPaymentMonthLabel("2026-04", (month) => `Monat ${month}`),
      "Monat 2026-04",
      "USt DE muss einen gueltigen Zahlungsmonat-Formatter direkt im Renderpfad respektieren.",
    );

    const failures = [];
    for (const route of routes) {
      const routeKey = String(route?.key || "unknown");
      const component = route?.Component;
      const payload = component?._payload;
      const loader = payload?._result;
      if (typeof loader !== "function") {
        failures.push(`${routeKey}: lazy loader fehlt.`);
        continue;
      }
      try {
        const loaded = await loader();
        const hasDefaultComponent = Boolean(loaded && typeof loaded.default === "function");
        if (!hasDefaultComponent) {
          failures.push(`${routeKey}: Modul ohne default React-Komponente.`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${routeKey}: ${message}`);
      }
    }

    assert.equal(
      failures.length,
      0,
      `Route-Smoke fehlgeschlagen:\n${failures.join("\n")}`,
    );
  } finally {
    await server.close();
  }
});
