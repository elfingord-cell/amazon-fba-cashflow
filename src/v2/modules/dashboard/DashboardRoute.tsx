// Dünner Route-Wrapper für das Dashboard / CFP.
// Desktop: rendert EXAKT das bestehende DashboardModule (unverändert).
// Mobile (< lg): rendert die native CFP-Mobile-App (lazy — wird auf Desktop
// nie geladen, damit der Desktop-Pfad in keiner Weise berührt wird).
import { Suspense, lazy, type JSX } from "react";
import { Grid } from "antd";
import DashboardModule from "./index";

const MobileCfpApp = lazy(() => import("../../mobile/MobileCfpApp"));

export default function DashboardRoute(): JSX.Element {
  const screens = Grid.useBreakpoint();
  const isDesktop = Boolean(screens.lg);

  if (isDesktop) {
    return <DashboardModule />;
  }

  return (
    <Suspense fallback={<div style={{ position: "fixed", inset: 0, background: "#f5f7f8", zIndex: 1000 }} />}>
      <MobileCfpApp />
    </Suspense>
  );
}
