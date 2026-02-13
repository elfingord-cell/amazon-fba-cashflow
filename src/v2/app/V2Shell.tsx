import { useMemo, useState } from "react";
import { Layout, Menu, Space, Tag, Typography, Button, Drawer, Grid } from "antd";
import { BankOutlined, MenuOutlined, RollbackOutlined } from "@ant-design/icons";
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { V2_ROUTES, V2_ROUTE_REDIRECTS } from "./routeCatalog";
import { useSyncSession } from "../sync/session";

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

function sectionLabel(section: string): string {
  if (section === "overview") return "Ueberblick";
  if (section === "operations") return "Operative Planung";
  if (section === "masterdata") return "Stammdaten";
  if (section === "closing") return "Monatsabschluss";
  return "Mehr / Tools";
}

function formatUserLabel(userId: string | null, compact: boolean): string {
  if (!userId) return "Nicht angemeldet";
  if (!compact) return `User: ${userId}`;
  if (userId.length <= 18) return `User: ${userId}`;
  return `User: ${userId.slice(0, 6)}...${userId.slice(-6)}`;
}

function V2Layout(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const syncSession = useSyncSession();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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
            </Space>
          </div>
          <div className="v2-header-meta">
            <Tag color={syncSession.online ? "green" : "red"}>
              {syncSession.online ? "Online" : "Offline"}
            </Tag>
            <Tag color={syncSession.workspaceId ? "blue" : "default"}>
              {syncSession.workspaceId ? `Workspace: ${syncSession.workspaceId}` : "Local fallback"}
            </Tag>
            <Text type="secondary">
              {formatUserLabel(syncSession.userId, isMobile)}
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
          <Outlet />
        </Content>
      </Layout>
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
