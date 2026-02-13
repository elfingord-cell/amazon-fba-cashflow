export type CollaborationDisplayNameMap = Record<string, string>;

export interface CollaborationUserIdentity {
  userId?: string | null;
  userEmail?: string | null;
  userDisplayName?: string | null;
}

export function normalizeEmailKey(email: unknown): string {
  return String(email || "").trim().toLowerCase();
}

export function readCollaborationDisplayNames(settings: Record<string, unknown> | null | undefined): CollaborationDisplayNameMap {
  const source = settings?.collaborationDisplayNames;
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  const next: CollaborationDisplayNameMap = {};
  Object.entries(source as Record<string, unknown>).forEach(([email, value]) => {
    const key = normalizeEmailKey(email);
    const label = String(value || "").trim();
    if (!key || !label) return;
    next[key] = label;
  });
  return next;
}

export function resolveCollaborationUserLabel(
  identity: CollaborationUserIdentity,
  displayNames?: CollaborationDisplayNameMap,
): string {
  const preferred = String(identity.userDisplayName || "").trim();
  if (preferred) return preferred;
  const email = String(identity.userEmail || "").trim();
  const key = normalizeEmailKey(email);
  if (key && displayNames && displayNames[key]) return displayNames[key];
  if (email) return email;
  const userId = String(identity.userId || "").trim();
  if (userId) return userId;
  return "Kollege";
}
