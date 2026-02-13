export interface CategoryGroupLike<T> {
  key: string;
  label: string;
  rows: T[];
}

function normalizeCategoryLabel(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function isUncategorized(label: unknown): boolean {
  return normalizeCategoryLabel(label) === "ohne kategorie";
}

export function buildCategoryOrderMap(state: Record<string, unknown>): Map<string, number> {
  const categories = Array.isArray(state.productCategories) ? state.productCategories : [];
  const normalized = categories
    .map((entry, index) => {
      const row = entry as Record<string, unknown>;
      const name = String(row.name || "").trim();
      const sortOrderRaw = Number(row.sortOrder);
      const hasSortOrder = Number.isFinite(sortOrderRaw);
      return {
        name,
        index,
        sortOrder: hasSortOrder ? sortOrderRaw : null,
      };
    })
    .filter((entry) => entry.name);

  normalized.sort((left, right) => {
    if (left.sortOrder != null && right.sortOrder != null && left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }
    if (left.sortOrder != null && right.sortOrder == null) return -1;
    if (left.sortOrder == null && right.sortOrder != null) return 1;
    const nameCmp = left.name.localeCompare(right.name, "de-DE");
    if (nameCmp !== 0) return nameCmp;
    return left.index - right.index;
  });

  const map = new Map<string, number>();
  normalized.forEach((entry, index) => {
    map.set(normalizeCategoryLabel(entry.name), index);
  });
  return map;
}

export function compareCategoryLabels(
  leftLabel: unknown,
  rightLabel: unknown,
  categoryOrderMap: Map<string, number>,
): number {
  const left = String(leftLabel || "Ohne Kategorie");
  const right = String(rightLabel || "Ohne Kategorie");
  const leftKey = normalizeCategoryLabel(left);
  const rightKey = normalizeCategoryLabel(right);
  const leftRank = categoryOrderMap.get(leftKey);
  const rightRank = categoryOrderMap.get(rightKey);

  if (leftRank != null && rightRank != null && leftRank !== rightRank) return leftRank - rightRank;
  if (leftRank != null && rightRank == null) return -1;
  if (leftRank == null && rightRank != null) return 1;

  if (isUncategorized(left) && !isUncategorized(right)) return 1;
  if (!isUncategorized(left) && isUncategorized(right)) return -1;
  return left.localeCompare(right, "de-DE");
}

export function sortCategoryGroups<T>(
  groups: CategoryGroupLike<T>[],
  categoryOrderMap: Map<string, number>,
): CategoryGroupLike<T>[] {
  return [...groups].sort((left, right) => {
    const byLabel = compareCategoryLabels(left.label, right.label, categoryOrderMap);
    if (byLabel !== 0) return byLabel;
    return String(left.key).localeCompare(String(right.key), "de-DE");
  });
}
