export type TaxesTabKey = "ust-de" | "oss" | "ertragsteuern";

export interface TaxesTabMeta {
  key: TaxesTabKey;
  label: string;
}

export const TAXES_TAB_ITEMS: TaxesTabMeta[] = [
  { key: "ust-de", label: "USt DE" },
  { key: "oss", label: "OSS" },
  { key: "ertragsteuern", label: "Ertragsteuern" },
];

export function resolveTaxesTab(value: string | null | undefined): TaxesTabKey {
  if (value === "ust-de" || value === "oss" || value === "ertragsteuern") return value;
  return "ertragsteuern";
}

export function buildTaxesLocation(
  pathname: string,
  search: string,
  tab: TaxesTabKey,
  extraParams?: Record<string, string | null | undefined>,
): string {
  const params = new URLSearchParams(search);
  params.set("tab", tab);
  Object.entries(extraParams || {}).forEach(([key, value]) => {
    if (value == null || String(value).trim() === "") params.delete(key);
    else params.set(key, String(value));
  });
  const nextSearch = params.toString();
  return nextSearch ? `${pathname}?${nextSearch}` : pathname;
}

export function buildTaxesTabRoute(
  tab: TaxesTabKey,
  extraParams?: Record<string, string | null | undefined>,
): string {
  return buildTaxesLocation("/v2/abschluss/steuern", "", tab, extraParams);
}
