import { useEffect, useMemo, useRef, useState } from "react";
import { Button, ConfigProvider, Layout, Menu, Typography } from "antd";
import { MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import { confirmNavigation } from "../hooks/useDirtyGuard.js";
import { initDataHealthUI } from "../ui/dataHealthUi.js";
import { initRemoteSync } from "../sync/remoteSync.js";
import { isDbSyncEnabled } from "../storage/syncBackend.js";
import {
  fetchServerSession,
  getCurrentUser,
  isSupabaseConfigured,
  signInWithMagicLink,
  signInWithPassword,
  signOut,
  onAuthSessionChange,
} from "../storage/authSession.js";
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
  const dbSyncEnabled = isDbSyncEnabled();
  const dbConfigured = isSupabaseConfigured();
  const [collapsed, setCollapsed] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [normalizedHash, setNormalizedHash] = useState(() => normalizeHash(window.location.hash));
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authInfo, setAuthInfo] = useState("");
  const [authUser, setAuthUser] = useState(null);
  const [serverSession, setServerSession] = useState(null);

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
    const remoteSync = initRemoteSync();
    return () => {
      remoteSync?.teardown?.();
    };
  }, []);

  useEffect(() => {
    if (!dbSyncEnabled) return () => {};

    const refresh = async () => {
      try {
        const user = await getCurrentUser();
        setAuthUser(user || null);
        if (!user) {
          setServerSession(null);
          return;
        }
        const session = await fetchServerSession();
        setServerSession(session || null);
      } catch (error) {
        const message = error?.message || "Auth status unavailable";
        setAuthInfo(message);
      }
    };

    const onAuthChanged = () => {
      refresh();
    };

    refresh();
    const unsubscribe = onAuthSessionChange(() => {
      refresh();
    });
    window.addEventListener("remote-sync:auth-changed", onAuthChanged);

    return () => {
      unsubscribe();
      window.removeEventListener("remote-sync:auth-changed", onAuthChanged);
    };
  }, [dbSyncEnabled]);

  const handlePasswordLogin = async (event) => {
    event.preventDefault();
    if (!dbSyncEnabled) return;
    setAuthInfo("");
    setAuthBusy(true);
    try {
      await signInWithPassword(authEmail, authPassword);
      const user = await getCurrentUser();
      const session = await fetchServerSession();
      setAuthUser(user || null);
      setServerSession(session || null);
      setAuthPassword("");
      setAuthInfo("Angemeldet.");
    } catch (error) {
      setAuthInfo(error?.message || "Login fehlgeschlagen");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleMagicLink = async () => {
    if (!dbSyncEnabled) return;
    setAuthInfo("");
    setAuthBusy(true);
    try {
      await signInWithMagicLink(authEmail);
      setAuthInfo("Magic Link gesendet.");
    } catch (error) {
      setAuthInfo(error?.message || "Magic Link fehlgeschlagen");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = async () => {
    if (!dbSyncEnabled) return;
    setAuthInfo("");
    setAuthBusy(true);
    try {
      await signOut();
      setAuthUser(null);
      setServerSession(null);
      setAuthPassword("");
      setAuthInfo("Abgemeldet.");
    } catch (error) {
      setAuthInfo(error?.message || "Logout fehlgeschlagen");
    } finally {
      setAuthBusy(false);
    }
  };

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
            {dbSyncEnabled ? (
              <div className={`sync-auth ${collapsed ? "is-collapsed-hidden" : ""}`.trim()}>
                {authUser ? (
                  <div className="sync-auth-user">
                    <div className="sync-auth-user-id">{authUser.email || authUser.id}</div>
                    <div className="sync-auth-user-meta">
                      {serverSession?.role ? `${serverSession.role} · Workspace aktiv` : "Workspace unbekannt"}
                    </div>
                    <button
                      type="button"
                      className="btn ghost sync-auth-logout"
                      onClick={handleLogout}
                      disabled={authBusy}
                    >
                      Logout
                    </button>
                  </div>
                ) : (
                  <form className="sync-auth-form" onSubmit={handlePasswordLogin}>
                    <input
                      className="sync-auth-input"
                      type="email"
                      value={authEmail}
                      onChange={(event) => setAuthEmail(event.target.value)}
                      placeholder="E-Mail"
                      autoComplete="email"
                      disabled={authBusy || !dbConfigured}
                    />
                    <input
                      className="sync-auth-input"
                      type="password"
                      value={authPassword}
                      onChange={(event) => setAuthPassword(event.target.value)}
                      placeholder="Passwort"
                      autoComplete="current-password"
                      disabled={authBusy || !dbConfigured}
                    />
                    <div className="sync-auth-actions">
                      <button
                        type="submit"
                        className="btn sm"
                        disabled={authBusy || !dbConfigured || !authEmail || !authPassword}
                      >
                        Login
                      </button>
                      <button
                        type="button"
                        className="btn sm secondary"
                        onClick={handleMagicLink}
                        disabled={authBusy || !dbConfigured || !authEmail}
                      >
                        Magic Link
                      </button>
                    </div>
                  </form>
                )}
                {!dbConfigured ? (
                  <div className="sync-auth-hint">Supabase Client Env fehlt.</div>
                ) : null}
                {authInfo ? <div className="sync-auth-hint">{authInfo}</div> : null}
              </div>
            ) : null}
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
