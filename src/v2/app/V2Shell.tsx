import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Drawer,
  Form,
  Grid,
  Input,
  Layout,
  Menu,
  Modal,
  Space,
  Tag,
  Typography,
} from "antd";
import {
  BankOutlined,
  LoginOutlined,
  LogoutOutlined,
  MenuOutlined,
  RollbackOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  signInWithPassword,
  signOut,
  signUpWithPassword,
} from "../../storage/authSession.js";
import { V2_ROUTES, V2_ROUTE_REDIRECTS } from "./routeCatalog";
import { useSyncSession } from "../sync/session";
import {
  type WorkspaceConnectionState,
  type WorkspacePresenceEntry,
  subscribeWorkspaceChanges,
} from "../sync/realtimeWorkspace";
import { applyPresenceHints, attachPresenceFocusTracking } from "../sync/presence";

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

interface AuthFormValues {
  email: string;
  password: string;
}

function sectionLabel(section: string): string {
  if (section === "overview") return "Ueberblick";
  if (section === "operations") return "Operative Planung";
  if (section === "masterdata") return "Stammdaten";
  if (section === "closing") return "Monatsabschluss";
  return "Mehr / Tools";
}

function formatUserLabel(session: ReturnType<typeof useSyncSession>, compact: boolean): string {
  if (!session.isAuthenticated) return "Nicht angemeldet";
  const label = session.email || session.userId || "Unbekannter User";
  if (!compact || label.length <= 32) return label;
  return `${label.slice(0, 20)}...${label.slice(-8)}`;
}

function connectionTagColor(state: WorkspaceConnectionState): string {
  if (state === "subscribed") return "green";
  if (state === "subscribing") return "blue";
  if (state === "reconnecting") return "orange";
  if (state === "errored") return "red";
  if (state === "closed") return "gold";
  return "default";
}

function connectionTagLabel(state: WorkspaceConnectionState): string {
  if (state === "subscribed") return "Realtime aktiv";
  if (state === "subscribing") return "Realtime verbindet...";
  if (state === "reconnecting") return "Realtime reconnect";
  if (state === "errored") return "Realtime Fehler (Polling aktiv)";
  if (state === "closed") return "Realtime beendet";
  return "Realtime inaktiv";
}

function extractRemoteEditors(entries: WorkspacePresenceEntry[], currentUserId: string | null): WorkspacePresenceEntry[] {
  return entries.filter((entry) => entry.userId && entry.userId !== currentUserId && (entry.fieldKey || entry.route));
}

function AccessGate({
  session,
  onOpenAuth,
  onLogout,
  authBusy,
}: {
  session: ReturnType<typeof useSyncSession>;
  onOpenAuth: () => void;
  onLogout: () => void;
  authBusy: boolean;
}): JSX.Element {
  const notSignedIn = session.requiresAuth || !session.isAuthenticated;
  if (notSignedIn) {
    return (
      <div className="v2-access-gate">
        <Alert
          type="warning"
          showIcon
          message="Anmeldung erforderlich"
          description="Bitte melde dich mit deinem Supabase-Account an, um den Shared Workspace zu nutzen."
          action={(
            <Button type="primary" icon={<LoginOutlined />} onClick={onOpenAuth}>
              Anmelden
            </Button>
          )}
        />
      </div>
    );
  }
  return (
    <div className="v2-access-gate">
      <Alert
        type="error"
        showIcon
        message="Kein Workspace-Zugriff"
        description="Dieser Benutzer ist keinem Workspace zugeordnet. Bitte den Membership-Eintrag in Supabase setzen."
        action={(
          <Space>
            <Button onClick={onOpenAuth}>
              Benutzer wechseln
            </Button>
            <Button danger icon={<LogoutOutlined />} onClick={onLogout} loading={authBusy}>
              Logout
            </Button>
          </Space>
        )}
      />
    </div>
  );
}

function V2Layout(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const syncSession = useSyncSession();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [authForm] = Form.useForm<AuthFormValues>();
  const [connectionState, setConnectionState] = useState<WorkspaceConnectionState>("idle");
  const [presenceEntries, setPresenceEntries] = useState<WorkspacePresenceEntry[]>([]);
  const screens = Grid.useBreakpoint();
  const isDesktop = Boolean(screens.lg);
  const isMobile = !isDesktop;

  const menuRoutes = useMemo(
    () => V2_ROUTES.filter((route) => route.sidebarVisible !== false),
    [],
  );
  const routeByKey = useMemo(
    () => new Map(menuRoutes.map((route) => [route.key, route])),
    [menuRoutes],
  );

  const remoteEditors = useMemo(
    () => extractRemoteEditors(presenceEntries, syncSession.userId),
    [presenceEntries, syncSession.userId],
  );
  const primaryRemoteEditor = remoteEditors[0] || null;

  function normalizeRoutePath(path: string): string {
    return String(path || "").replace(/\/\*$/, "").replace(/^\/+/, "").replace(/\/+$/, "");
  }

  const activeKey = useMemo(() => {
    const relativePath = location.pathname
      .replace(/^\/v2\/?/, "")
      .replace(/\/+$/, "");
    const fallback = "dashboard";
    if (!relativePath) return fallback;
    let selected = fallback;
    let bestLen = -1;
    menuRoutes.forEach((route) => {
      const normalized = normalizeRoutePath(route.path);
      if (!normalized) return;
      const exactMatch = relativePath === normalized;
      const nestedMatch = relativePath.startsWith(`${normalized}/`);
      if (!exactMatch && !nestedMatch) return;
      if (normalized.length > bestLen) {
        bestLen = normalized.length;
        selected = route.key;
      }
    });
    return selected;
  }, [location.pathname, menuRoutes]);

  const menuItems = useMemo(() => {
    const grouped: Record<string, unknown[]> = {
      overview: [],
      operations: [],
      masterdata: [],
      closing: [],
      tools: [],
    };

    menuRoutes.forEach((route) => {
      const Icon = route.icon;
      (grouped[route.section] as unknown[]).push({
        key: route.key,
        icon: <Icon />,
        label: route.label,
      });
    });

    return Object.entries(grouped).map(([section, children]) => ({
      key: section,
      type: "group",
      label: sectionLabel(section),
      children,
    }));
  }, [menuRoutes]);

  useEffect(() => {
    if (!syncSession.workspaceId || !syncSession.hasWorkspaceAccess || !syncSession.userId) {
      setConnectionState("idle");
      setPresenceEntries([]);
      applyPresenceHints([], syncSession.userId);
      return () => {};
    }

    const unsubscribe = subscribeWorkspaceChanges({
      workspaceId: syncSession.workspaceId,
      onConnectionState: (state) => setConnectionState(state),
      onPresenceChange: (entries) => {
        setPresenceEntries(entries);
        applyPresenceHints(entries, syncSession.userId);
      },
    });

    const detachTracking = attachPresenceFocusTracking({
      userId: syncSession.userId,
      userEmail: syncSession.email,
      workspaceId: syncSession.workspaceId,
      routeResolver: () => window.location.hash || "",
    });

    return () => {
      unsubscribe();
      detachTracking();
      applyPresenceHints([], syncSession.userId);
    };
  }, [
    syncSession.email,
    syncSession.hasWorkspaceAccess,
    syncSession.userId,
    syncSession.workspaceId,
  ]);

  async function handleAuthSubmit(mode: "login" | "register"): Promise<void> {
    try {
      const values = await authForm.validateFields();
      setAuthBusy(true);
      setAuthMessage("");
      if (mode === "register") {
        await signUpWithPassword(values.email, values.password);
        setAuthMessage("Registrierung erfolgreich. Falls no_access erscheint, Membership in Supabase setzen.");
      } else {
        await signInWithPassword(values.email, values.password);
        setAuthMessage("Anmeldung erfolgreich.");
        setAuthModalOpen(false);
      }
    } catch (error) {
      if (error && typeof error === "object" && "errorFields" in error) return;
      const text = error instanceof Error ? error.message : "Auth-Aktion fehlgeschlagen";
      setAuthMessage(text);
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleLogout(): Promise<void> {
    setAuthBusy(true);
    setAuthMessage("");
    try {
      await signOut();
      setAuthMessage("Abgemeldet.");
    } catch (error) {
      const text = error instanceof Error ? error.message : "Logout fehlgeschlagen";
      setAuthMessage(text);
    } finally {
      setAuthBusy(false);
    }
  }

  const showAccessGate = syncSession.requiresAuth || (syncSession.isAuthenticated && !syncSession.hasWorkspaceAccess);

  return (
    <Layout className="v2-shell">
      {isDesktop ? (
        <Sider width={290} className="v2-sider">
          <div className="v2-brand">
            <BankOutlined />
            <span>FBA Cashflow V2</span>
          </div>
          <Menu
            mode="inline"
            selectedKeys={[activeKey]}
            items={menuItems as never}
            onClick={({ key }) => {
              const route = routeByKey.get(String(key));
              const target = route?.menuPath || normalizeRoutePath(route?.path || "dashboard");
              navigate(`/v2/${target}`);
            }}
          />
        </Sider>
      ) : null}
      <Layout>
        <Header className="v2-header">
          <div className="v2-header-main">
            <Space align="center" size={12} wrap>
              {isMobile ? (
                <Button
                  icon={<MenuOutlined />}
                  onClick={() => setMobileMenuOpen(true)}
                  className="v2-menu-toggle"
                >
                  Navigation
                </Button>
              ) : null}
              <Button
                icon={<RollbackOutlined />}
                onClick={() => {
                  window.location.hash = "#dashboard";
                }}
              >
                Legacy App
              </Button>
              <Button
                icon={<UserOutlined />}
                type={syncSession.isAuthenticated ? "default" : "primary"}
                onClick={() => setAuthModalOpen(true)}
              >
                {syncSession.isAuthenticated ? "Konto" : "Anmelden"}
              </Button>
              {syncSession.isAuthenticated ? (
                <Button
                  icon={<LogoutOutlined />}
                  onClick={() => { void handleLogout(); }}
                  loading={authBusy}
                >
                  Logout
                </Button>
              ) : null}
            </Space>
          </div>
          <div className="v2-header-meta">
            <Tag color={syncSession.online ? "green" : "red"}>
              {syncSession.online ? "Online" : "Offline"}
            </Tag>
            <Tag color={syncSession.hasWorkspaceAccess ? "blue" : "default"}>
              {syncSession.hasWorkspaceAccess
                ? `Workspace: ${syncSession.workspaceId}`
                : (syncSession.isAuthenticated ? "no_access" : "nicht verbunden")}
            </Tag>
            <Tag color={connectionTagColor(connectionState)}>
              {connectionTagLabel(connectionState)}
            </Tag>
            {primaryRemoteEditor ? (
              <Tag color="orange">
                {primaryRemoteEditor.userEmail || primaryRemoteEditor.userId || "Kollege"} bearbeitet gerade
              </Tag>
            ) : null}
            <Text type="secondary">
              {formatUserLabel(syncSession, isMobile)}
            </Text>
          </div>
        </Header>
        {isMobile ? (
          <Drawer
            title="Navigation"
            placement="left"
            open={mobileMenuOpen}
            onClose={() => setMobileMenuOpen(false)}
            width={290}
            styles={{ body: { padding: 0 } }}
          >
            <div className="v2-drawer-brand">
              <BankOutlined />
              <span>FBA Cashflow V2</span>
            </div>
            <Menu
              mode="inline"
              selectedKeys={[activeKey]}
              items={menuItems as never}
              onClick={({ key }) => {
                const route = routeByKey.get(String(key));
                const target = route?.menuPath || normalizeRoutePath(route?.path || "dashboard");
                navigate(`/v2/${target}`);
                setMobileMenuOpen(false);
              }}
            />
          </Drawer>
        ) : null}
        <Content className="v2-content">
          {showAccessGate ? (
            <AccessGate
              session={syncSession}
              onOpenAuth={() => setAuthModalOpen(true)}
              onLogout={() => { void handleLogout(); }}
              authBusy={authBusy}
            />
          ) : (
            <Outlet />
          )}
        </Content>
      </Layout>

      <Modal
        title="Konto & Workspace"
        open={authModalOpen}
        onCancel={() => setAuthModalOpen(false)}
        footer={null}
      >
        <Form<AuthFormValues> form={authForm} layout="vertical">
          <Form.Item
            name="email"
            label="E-Mail"
            rules={[{ required: true, message: "E-Mail fehlt." }]}
          >
            <Input autoComplete="email" disabled={authBusy} />
          </Form.Item>
          <Form.Item
            name="password"
            label="Passwort"
            rules={[{ required: true, message: "Passwort fehlt." }]}
          >
            <Input.Password autoComplete="current-password" disabled={authBusy} />
          </Form.Item>
          <Space wrap>
            <Button
              type="primary"
              icon={<LoginOutlined />}
              loading={authBusy}
              onClick={() => { void handleAuthSubmit("login"); }}
            >
              Login
            </Button>
            <Button
              loading={authBusy}
              onClick={() => { void handleAuthSubmit("register"); }}
            >
              Registrieren
            </Button>
          </Space>
          {authMessage ? (
            <Alert
              type={authMessage.toLowerCase().includes("erfolg") ? "success" : "info"}
              showIcon
              style={{ marginTop: 12 }}
              message={authMessage}
            />
          ) : null}
        </Form>
      </Modal>
    </Layout>
  );
}

export function V2Routes(): JSX.Element {
  return (
    <Routes>
      <Route path="/v2" element={<V2Layout />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        {V2_ROUTE_REDIRECTS.map((redirect) => (
          <Route
            key={`redirect:${redirect.from}`}
            path={redirect.from}
            element={<Navigate to={`/v2/${redirect.to}`} replace />}
          />
        ))}
        {V2_ROUTES.map((route) => (
          <Route
            key={route.key}
            path={route.path}
            element={<route.Component />}
          />
        ))}
      </Route>
      <Route path="*" element={<Navigate to="/v2/dashboard" replace />} />
    </Routes>
  );
}
