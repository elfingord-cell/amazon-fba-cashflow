import { isObject } from "./utils";

const LEGACY_HINT_KEYS = [
  "settings",
  "products",
  "suppliers",
  "pos",
  "fos",
  "payments",
  "forecast",
  "inventory",
  "fixcosts",
  "monthlyActuals",
];

export function detectSourceVersion(payload: unknown): "legacy_v1" | "unknown" {
  if (!isObject(payload)) return "unknown";
  const keys = Object.keys(payload);
  const hits = LEGACY_HINT_KEYS.filter((key) => keys.includes(key)).length;
  return hits >= 3 ? "legacy_v1" : "unknown";
}
