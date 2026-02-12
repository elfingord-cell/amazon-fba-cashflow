import { useMemo, useState } from "react";
import { Button, Card, Space, Typography } from "antd";
import { LegacyMount } from "../../components/LegacyMount";

const { Paragraph, Title } = Typography;

type LegacyLoader = () => Promise<unknown>;

interface LegacyModulePageProps {
  title: string;
  description: string;
  loader: LegacyLoader;
}

export function LegacyModulePage({ title, description, loader }: LegacyModulePageProps): JSX.Element {
  const [refreshNonce, setRefreshNonce] = useState(0);
  const stableLoader = useMemo(() => loader, [loader]);

  return (
    <div className="v2-page">
      <Card className="v2-intro-card">
        <Title level={3}>{title}</Title>
        <Paragraph>{description}</Paragraph>
        <Space>
          <Button onClick={() => setRefreshNonce((value) => value + 1)}>Neu laden</Button>
        </Space>
      </Card>
      <LegacyMount loader={stableLoader} refreshKey={refreshNonce} />
    </div>
  );
}
