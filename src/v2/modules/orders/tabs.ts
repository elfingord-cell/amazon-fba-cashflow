export type OrdersTabKey = "po" | "fo" | "pfo" | "ghost-fo" | "sku" | "lieferantenausblick";

export interface OrdersTabMeta {
  key: OrdersTabKey;
  label: string;
  path: string;
}

export const ORDERS_TAB_ITEMS: OrdersTabMeta[] = [
  { key: "po", label: "Bestellungen (PO)", path: "/v2/orders/po" },
  { key: "fo", label: "Forecast Orders (FO)", path: "/v2/orders/fo" },
  { key: "pfo", label: "Bestellvorschläge", path: "/v2/orders/pfo" },
  { key: "ghost-fo", label: "Verwaiste FOs", path: "/v2/orders/ghost-fo" },
  { key: "sku", label: "SKU Sicht", path: "/v2/orders/sku" },
  { key: "lieferantenausblick", label: "Lieferantenausblick", path: "/v2/orders/lieferantenausblick" },
];

export function resolveOrdersTab(pathname: string): OrdersTabKey {
  if (pathname.includes("/orders/lieferantenausblick")) return "lieferantenausblick";
  if (pathname.includes("/orders/pfo")) return "pfo";
  if (pathname.includes("/orders/ghost-fo")) return "ghost-fo";
  if (pathname.includes("/orders/sku")) return "sku";
  if (pathname.includes("/orders/fo")) return "fo";
  return "po";
}
