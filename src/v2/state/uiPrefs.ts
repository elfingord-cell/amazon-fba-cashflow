export interface UiModulePrefs {
  expandedCategoryKeys?: string[];
}

export interface UiPrefsV2 {
  byModule: Record<string, UiModulePrefs>;
}

const STORAGE_KEY = "v2.ui-prefs";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeExpandedKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry || "").trim()).filter(Boolean);
}

function readRawPrefs(): UiPrefsV2 {
  if (typeof window === "undefined") return { byModule: {} };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { byModule: {} };
    const parsed = JSON.parse(raw) as unknown;
    if (!isObject(parsed)) return { byModule: {} };
    const byModuleInput = isObject(parsed.byModule) ? parsed.byModule : {};
    const byModule = Object.entries(byModuleInput).reduce((acc, [moduleKey, value]) => {
      const entry = isObject(value) ? value : {};
      acc[moduleKey] = {
        expandedCategoryKeys: normalizeExpandedKeys(entry.expandedCategoryKeys),
      };
      return acc;
    }, {} as Record<string, UiModulePrefs>);
    return { byModule };
  } catch {
    return { byModule: {} };
  }
}

function writeRawPrefs(next: UiPrefsV2): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore localStorage write errors
  }
}

export function getModuleExpandedCategoryKeys(moduleKey: string): string[] {
  const prefs = readRawPrefs();
  return normalizeExpandedKeys(prefs.byModule?.[moduleKey]?.expandedCategoryKeys);
}

export function hasModuleExpandedCategoryKeys(moduleKey: string): boolean {
  const prefs = readRawPrefs();
  const entry = prefs.byModule?.[moduleKey];
  return Boolean(entry && Array.isArray(entry.expandedCategoryKeys));
}

export function setModuleExpandedCategoryKeys(moduleKey: string, keys: string[]): void {
  const prefs = readRawPrefs();
  const next: UiPrefsV2 = {
    byModule: {
      ...prefs.byModule,
      [moduleKey]: {
        ...(prefs.byModule?.[moduleKey] || {}),
        expandedCategoryKeys: normalizeExpandedKeys(keys),
      },
    },
  };
  writeRawPrefs(next);
}
