import { useMemo } from "react";
import { Layout, Menu, Space, Tag, Typography, Button } from "antd";
import { BankOutlined, RollbackOutlined } from "@ant-design/icons";
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { V2_ROUTES } from "./routeCatalog";
import { useSyncSession } from "../sync/session";

const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;

function sectionLabel(section: string): string {
  if (section === "overview") return "Ueberblick";
  if (section === "planning") return "Planung";
  return "Werkzeuge";
}

function V2Layout(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const syncSession = useSyncSession();

  const activeKey = useMemo(() => {
    const parts = location.pathname.split("/").filter(Boolean);
    return parts[1] || "dashboard";
  }, [location.pathname]);

  const menuItems = useMemo(() => {
    const grouped: Record<string, unknown[]> = {
      overview: [],
      planning: [],
      tools: [],
    };

    V2_ROUTES.forEach((route) => {
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
  }, []);

  return (
    <Layout className="v2-shell">
      <Sider
        width={290}
        className="v2-sider"
        breakpoint="lg"
        collapsedWidth={0}
      >
        <div className="v2-brand">
          <BankOutlined />
          <span>FBA Cashflow V2</span>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[activeKey]}
          items={menuItems as never}
          onClick={({ key }) => {
            navigate(`/v2/${String(key)}`);
          }}
        />
      </Sider>
      <Layout>
        <Header className="v2-header">
          <Space align="center" size={16}>
            <Title level={4} style={{ margin: 0 }}>Parallel V2</Title>
            <Tag color={syncSession.online ? "green" : "red"}>
              {syncSession.online ? "Online" : "Offline"}
            </Tag>
            <Tag color={syncSession.workspaceId ? "blue" : "default"}>
              {syncSession.workspaceId ? `Workspace: ${syncSession.workspaceId}` : "Local fallback"}
            </Tag>
            <Text type="secondary">
              {syncSession.userId ? `User: ${syncSession.userId}` : "Nicht angemeldet"}
            </Text>
          </Space>
          <Button
            icon={<RollbackOutlined />}
            onClick={() => {
              window.location.hash = "#dashboard";
            }}
          >
            Legacy App
          </Button>
        </Header>
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
        {V2_ROUTES.map((route) => (
          <Route
            key={route.key}
            path={route.key}
            element={<route.Component />}
          />
        ))}
      </Route>
      <Route path="*" element={<Navigate to="/v2/dashboard" replace />} />
    </Routes>
  );
}
