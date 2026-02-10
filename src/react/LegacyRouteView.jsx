import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Spin } from "antd";
import { hydrateDataTables } from "../ui/components/dataTable.js";
import { ROUTE_LOADERS, pickRenderer } from "./routes.js";

function runCleanup(cleanupRef) {
  if (typeof cleanupRef.current !== "function") return;
  try {
    cleanupRef.current();
  } catch {
    // no-op
  }
  cleanupRef.current = null;
}

export function LegacyRouteView({ routeBase, routeQuery, refreshNonce }) {
  const hostRef = useRef(null);
  const cleanupRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const queryHash = useMemo(() => JSON.stringify(routeQuery || {}), [routeQuery]);
  const parsedRouteQuery = useMemo(() => {
    try {
      return JSON.parse(queryHash);
    } catch {
      return {};
    }
  }, [queryHash]);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return undefined;

    runCleanup(cleanupRef);
    host.innerHTML = "";
    setLoading(true);
    setError("");

    window.__routeQuery = parsedRouteQuery;

    const loader = ROUTE_LOADERS[routeBase] || ROUTE_LOADERS["#dashboard"];
    loader()
      .then((mod) => {
        if (cancelled) return;
        const renderer = pickRenderer(mod);
        if (typeof renderer !== "function") {
          throw new Error(`Route ${routeBase} hat keinen gültigen Render-Export.`);
        }
        const result = renderer(host);
        if (result && typeof result === "object" && typeof result.cleanup === "function") {
          cleanupRef.current = result.cleanup;
        }
        hydrateDataTables(host);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(err);
        setError(err?.message || String(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
      runCleanup(cleanupRef);
    };
  }, [routeBase, refreshNonce, parsedRouteQuery]);

  return (
    <div className="legacy-route-host">
      {error ? (
        <Alert
          type="error"
          showIcon
          className="legacy-route-alert"
          message="Fehler beim Laden der Seite"
          description={error}
        />
      ) : null}
      {loading ? (
        <div className="legacy-route-loading">
          <Spin size="large" />
        </div>
      ) : null}
      <div ref={hostRef} />
    </div>
  );
}
