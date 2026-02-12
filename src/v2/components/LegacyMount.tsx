import { useEffect, useRef, useState } from "react";
import { Alert, Spin } from "antd";
import { hydrateDataTables } from "../../ui/components/dataTable.js";
import { pickRenderer } from "../../react/routes.js";

type LegacyLoader = () => Promise<unknown>;

interface LegacyMountProps {
  loader: LegacyLoader;
  refreshKey?: string | number;
}

export function LegacyMount({ loader, refreshKey }: LegacyMountProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<null | (() => void)>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return undefined;

    if (cleanupRef.current) {
      try {
        cleanupRef.current();
      } catch {
        // no-op
      }
      cleanupRef.current = null;
    }

    host.innerHTML = "";
    setLoading(true);
    setError("");

    loader()
      .then((mod) => {
        if (cancelled) return;
        const renderer = pickRenderer(mod as Record<string, unknown>);
        if (typeof renderer !== "function") {
          throw new Error("Legacy module has no renderer export.");
        }
        const result = renderer(host);
        if (result && typeof result === "object" && typeof (result as { cleanup?: unknown }).cleanup === "function") {
          cleanupRef.current = (result as { cleanup: () => void }).cleanup;
        }
        hydrateDataTables(host as unknown as Document);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
      if (cleanupRef.current) {
        try {
          cleanupRef.current();
        } catch {
          // no-op
        }
        cleanupRef.current = null;
      }
    };
  }, [loader, refreshKey]);

  return (
    <div className="v2-legacy-host">
      {error ? (
        <Alert
          type="error"
          showIcon
          message="Legacy-Modul konnte nicht geladen werden"
          description={error}
        />
      ) : null}
      {loading ? (
        <div className="v2-legacy-loading">
          <Spin size="large" />
        </div>
      ) : null}
      <div ref={hostRef} />
    </div>
  );
}
