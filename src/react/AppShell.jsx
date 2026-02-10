import { useEffect, useMemo, useRef, useState } from "react";
import { Button, ConfigProvider, Layout, Menu, Typography } from "antd";
import { MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import { confirmNavigation } from "../hooks/useDirtyGuard.js";
import { initDataHealthUI } from "../ui/dataHealthUi.js";
import { initRemoteSync } from "../sync/remoteSync.js";
import { LegacyRouteView } from "./LegacyRouteView.jsx";
import { MENU_SECTIONS, WIDE_ROUTES, normalizeHash, resolveRoute } from "./routes.js";
import { antdTheme } from "./theme.js";

const { Header, Content, Sider } = Layout;
const { Text } = Typography;

const STATE_KEY = "amazon_fba_cashflow_v1";

function toMenuItems() {
  return MENU_SECTIONS.map((section) => ({
    type: "group",
    key: section.key,
    label: section.label,
    children: section.children.map((item) => ({
      key: item.key,
      label: item.label,
    })),
  }));
}
const MENU_ITEMS = toMenuItems();

function routeTitle(base) {
  for (const section of MENU_SECTIONS) {
    const item = section.children.find((entry) => entry.key === base);
    if (item) return item.label;
  }
  return "Dashboard";
}

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [normalizedHash, setNormalizedHash] = useState(() => normalizeHash(window.location.hash));

  const pendingNavRef = useRef(null);
  const currentHashRef = useRef(normalizedHash);

  const resolved = useMemo(() => resolveRoute(normalizedHash), [normalizedHash]);
  const routeBase = resolved.base;
  const routeQuery = resolved.query;
  const routeIsWide = WIDE_ROUTES.has(routeBase);

  useEffect(() => {
    currentHashRef.current = normalizedHash;
  }, [normalizedHash]);

  useEffect(() => {
    if (!window.location.hash) {
      window.location.hash = "#dashboard";
      setNormalizedHash("#dashboard");
    }
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      const nextHash = normalizeHash(window.location.hash);
      if (nextHash === currentHashRef.current) return;

      if (pendingNavRef.current && pendingNavRef.current === nextHash) {
        pendingNavRef.current = null;
        setNormalizedHash(nextHash);
        return;
      }

      if (!confirmNavigation()) {
        window.location.hash = currentHashRef.current;
        return;
      }

      setNormalizedHash(nextHash);
    };

    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    const onStorage = (event) => {
      if (!event || event.key === STATE_KEY) {
        setRefreshNonce((value) => value + 1);
      }
    };
    const onStateChanged = (event) => {
      const source = event?.detail?.source;
      const hash = normalizeHash(window.location.hash);
      const base = hash.split("?")[0];
      if (source !== "payment-update" || (base !== "#po" && base !== "#fo")) {
        setRefreshNonce((value) => value + 1);
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("state:changed", onStateChanged);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("state:changed", onStateChanged);
    };
  }, []);

  useEffect(() => {
    initDataHealthUI();
    initRemoteSync();
  }, []);

  const handleNavigate = (nextBase) => {
    const targetHash = normalizeHash(nextBase);
    const currentBase = currentHashRef.current.split("?")[0];

    if (targetHash === currentBase) {
      if (!confirmNavigation()) return;
      setRefreshNonce((value) => value + 1);
      return;
    }

    if (!confirmNavigation()) return;

    pendingNavRef.current = targetHash;
    window.location.hash = targetHash;
  };

  return (
    <ConfigProvider theme={antdTheme}>
      <Layout className="app-shell">
        <Sider
          className="app-sider"
          trigger={null}
          collapsible
          breakpoint="lg"
          collapsed={collapsed}
          onCollapse={setCollapsed}
          width={280}
        >
          <div className="sidebar-header app-sidebar-header">
            <div className="app-sidebar-top">
              <Button
                type="text"
                className="sidebar-toggle"
                aria-label="Navigation umschalten"
                onClick={() => setCollapsed((value) => !value)}
                icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              />
              {!collapsed ? <span className="sidebar-title">FBA Cashflow</span> : null}
            </div>
            <button
              className={`data-health-badge ${collapsed ? "is-collapsed-hidden" : ""}`.trim()}
              id="data-health-badge"
              type="button"
            >
              Data Health: OK
            </button>
            <div className={`sidebar-status ${collapsed ? "is-collapsed-hidden" : ""}`.trim()}>
              <span className="sync-status" id="sync-status" data-status="local-only">Local only</span>
              <label className="sync-toggle">
                <input type="checkbox" id="sync-auto-toggle" />
                <span>Auto-sync</span>
              </label>
            </div>
          </div>

          <Menu
            mode="inline"
            className="app-menu"
            selectedKeys={[routeBase]}
            items={MENU_ITEMS}
            onClick={({ key }) => handleNavigate(String(key))}
          />
        </Sider>

        <Layout>
          <Header className="app-header">
            <Text strong>{routeTitle(routeBase)}</Text>
          </Header>
          <Content className={`app app-content ${routeIsWide ? "app-wide" : ""}`.trim()}>
            <LegacyRouteView
              routeBase={routeBase}
              routeQuery={routeQuery}
              refreshNonce={refreshNonce}
            />
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}
