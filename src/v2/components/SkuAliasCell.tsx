import { Typography } from "antd";

const { Text } = Typography;

interface SkuAliasCellProps {
  alias?: string | null;
  sku?: string | null;
  aliasFallbackToSku?: boolean;
}

function normalizeLabel(value: string | null | undefined): string {
  return String(value || "").trim();
}

export function SkuAliasCell({
  alias,
  sku,
  aliasFallbackToSku = true,
}: SkuAliasCellProps): JSX.Element {
  const aliasValue = normalizeLabel(alias);
  const skuValue = normalizeLabel(sku);
  const mainLabel = aliasValue || (aliasFallbackToSku ? skuValue : "") || "-";
  const secondaryLabel = skuValue || "-";
  return (
    <div className="v2-proj-alias">
      <div className="v2-proj-alias-main" title={mainLabel}>{mainLabel}</div>
      <Text className="v2-proj-sku-secondary" type="secondary" title={secondaryLabel}>
        {secondaryLabel}
      </Text>
    </div>
  );
}
