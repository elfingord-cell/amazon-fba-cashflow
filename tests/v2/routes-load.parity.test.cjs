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
    const routes = Array.isArray(routeCatalog.V2_ROUTES) ? routeCatalog.V2_ROUTES : [];
    assert.ok(routes.length > 0, "Keine V2-Routen gefunden.");
    assert.equal(
      routes.some((route) => String(route?.key || "") === "plan"),
      false,
      "Plan-Route darf nicht mehr als eigener V2-Tab erscheinen.",
    );
    const redirects = Array.isArray(routeCatalog.V2_ROUTE_REDIRECTS) ? routeCatalog.V2_ROUTE_REDIRECTS : [];
    const planRedirect = redirects.find((entry) => String(entry?.from || "") === "plan");
    assert.ok(planRedirect, "Redirect fuer /v2/plan fehlt.");
    assert.equal(
      String(planRedirect.to || ""),
      "orders/po?view=timeline",
      "Plan-Redirect muss auf PO-Timeline zeigen.",
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
