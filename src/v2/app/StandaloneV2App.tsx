import { ConfigProvider } from "antd";
import { useEffect, useState } from "react";
import { HashRouter } from "react-router-dom";
import { antdTheme, antdThemeCleanV2 } from "../../react/theme.js";
import { V2Routes } from "./V2Shell";
import { readInitialCleanUiV2Flag, resolveCleanUiV2FlagFromState } from "./cleanUiFlag";
import "./v2-shell.css";

export function StandaloneV2App(): JSX.Element {
  const [cleanUiEnabled, setCleanUiEnabled] = useState<boolean>(() => readInitialCleanUiV2Flag());

  useEffect(() => {
    const onSnapshot = (event: Event) => {
      const customEvent = event as CustomEvent<unknown>;
      setCleanUiEnabled(resolveCleanUiV2FlagFromState(customEvent.detail));
    };
    window.addEventListener("v2:workspace-state-snapshot", onSnapshot as EventListener);
    return () => {
      window.removeEventListener("v2:workspace-state-snapshot", onSnapshot as EventListener);
    };
  }, []);

  return (
    <ConfigProvider theme={cleanUiEnabled ? antdThemeCleanV2 : antdTheme}>
      <HashRouter>
        <V2Routes />
      </HashRouter>
    </ConfigProvider>
  );
}
