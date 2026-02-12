import { ConfigProvider } from "antd";
import { HashRouter } from "react-router-dom";
import { antdTheme } from "../../react/theme.js";
import { V2Routes } from "./V2Shell";
import "./v2-shell.css";

export function StandaloneV2App(): JSX.Element {
  return (
    <ConfigProvider theme={antdTheme}>
      <HashRouter>
        <V2Routes />
      </HashRouter>
    </ConfigProvider>
  );
}
