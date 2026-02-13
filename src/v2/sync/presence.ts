import type { WorkspacePresenceEntry } from "./realtimeWorkspace";
import { clearPresenceField, publishPresence } from "./realtimeWorkspace";

interface AttachPresenceTrackingOptions {
  userId: string;
  userEmail: string | null;
  workspaceId: string;
  routeResolver: () => string;
}

const LOCAL_EDIT_STATE = {
  activeFieldKey: null as string | null,
  lastFocusAt: 0,
  lastBlurAt: 0,
};

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return String(value).replace(/["\\#.;:[\],=]/g, "\\$&");
}

function normalizeRoute(route: string): string {
  const trimmed = String(route || "").trim();
  if (!trimmed) return "";
  return trimmed.replace(/\?.*$/, "").replace(/\/+$/, "");
}

function baseFieldKeyFromElement(target: EventTarget | null): string | null {
  if (!(target instanceof HTMLElement)) return null;
  const direct = target.getAttribute("data-field-key")
    || target.getAttribute("id")
    || target.getAttribute("name");
  if (direct) return String(direct).trim();

  const decorated = target.closest("[data-field-key]") as HTMLElement | null;
  if (decorated?.dataset?.fieldKey) return String(decorated.dataset.fieldKey).trim();

  const withId = target.closest("[id]") as HTMLElement | null;
  if (withId?.id) return String(withId.id).trim();
  return null;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.matches("input:not([type='hidden']):not([type='checkbox']):not([type='radio'])")) return true;
  if (target.matches("textarea")) return true;
  if (target.matches("[contenteditable='true']")) return true;
  if (target.closest(".ant-select-selector")) return true;
  if (target.closest(".ant-picker")) return true;
  if (target.closest(".ant-input-number")) return true;
  return false;
}

function buildFieldKey(route: string, baseKey: string): string {
  return `${normalizeRoute(route)}::${String(baseKey || "").trim()}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function getLocalActiveFieldKey(): string | null {
  return LOCAL_EDIT_STATE.activeFieldKey;
}

export function isLocalEditActive(graceMs = 1200): boolean {
  if (LOCAL_EDIT_STATE.activeFieldKey) return true;
  if (!LOCAL_EDIT_STATE.lastBlurAt) return false;
  return Date.now() - LOCAL_EDIT_STATE.lastBlurAt < Math.max(0, graceMs);
}

export function attachPresenceFocusTracking(options: AttachPresenceTrackingOptions): () => void {
  const routeResolver = options.routeResolver;
  let currentFieldKey: string | null = null;
  let startedAt = nowIso();

  const onFocusIn = (event: FocusEvent) => {
    if (!isEditableTarget(event.target)) return;
    const baseKey = baseFieldKeyFromElement(event.target);
    if (!baseKey) return;
    const route = normalizeRoute(routeResolver());
    if (!route) return;
    const fieldKey = buildFieldKey(route, baseKey);

    currentFieldKey = fieldKey;
    startedAt = nowIso();
    LOCAL_EDIT_STATE.activeFieldKey = fieldKey;
    LOCAL_EDIT_STATE.lastFocusAt = Date.now();
    publishPresence({
      userId: options.userId,
      userEmail: options.userEmail,
      fieldKey,
      route,
      startedAt,
      modalScope: (event.target instanceof HTMLElement && event.target.closest(".ant-modal-root, .ant-modal"))
        ? "modal"
        : null,
    });
  };

  const onFocusOut = () => {
    LOCAL_EDIT_STATE.activeFieldKey = null;
    LOCAL_EDIT_STATE.lastBlurAt = Date.now();
    currentFieldKey = null;
    clearPresenceField();
  };

  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("focusout", onFocusOut, true);

  return () => {
    document.removeEventListener("focusin", onFocusIn, true);
    document.removeEventListener("focusout", onFocusOut, true);
    if (currentFieldKey) {
      clearPresenceField();
    }
    LOCAL_EDIT_STATE.activeFieldKey = null;
    LOCAL_EDIT_STATE.lastBlurAt = Date.now();
  };
}

function clearExistingPresenceHints() {
  document.querySelectorAll("[data-v2-presence-remote='1']").forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    const previousTitle = node.getAttribute("data-v2-presence-prev-title");
    if (previousTitle != null) {
      node.setAttribute("title", previousTitle);
      node.removeAttribute("data-v2-presence-prev-title");
    } else {
      node.removeAttribute("title");
    }
    node.removeAttribute("data-v2-presence-remote");
    node.removeAttribute("data-v2-presence-label");
    node.classList.remove("v2-presence-remote-field");
  });
}

function resolveHighlightTarget(node: HTMLElement): HTMLElement {
  return (
    node.closest(
      ".ant-input-number, .ant-input-affix-wrapper, .ant-select, .ant-picker, .ant-input, .ant-form-item-control-input",
    ) as HTMLElement
  ) || node;
}

function findTargetsForBaseField(baseFieldKey: string): HTMLElement[] {
  const key = String(baseFieldKey || "").trim();
  if (!key) return [];
  const escaped = cssEscape(key);
  const selectors = [
    `[data-field-key="${escaped}"]`,
    `#${escaped}`,
    `[name="${escaped}"]`,
    `[id$="_${escaped}"]`,
    `[name$=".${escaped}"]`,
  ];
  const result = new Set<HTMLElement>();
  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((node) => {
      if (node instanceof HTMLElement) {
        result.add(resolveHighlightTarget(node));
      }
    });
  });
  return Array.from(result);
}

export function applyPresenceHints(entries: WorkspacePresenceEntry[], currentUserId: string | null): void {
  clearExistingPresenceHints();
  const route = normalizeRoute(window.location.hash || "");
  if (!route) return;

  entries
    .filter((entry) => entry.userId && entry.userId !== currentUserId && entry.fieldKey)
    .forEach((entry) => {
      const [entryRoute, baseFieldKey] = String(entry.fieldKey).split("::");
      if (!entryRoute || !baseFieldKey) return;
      if (normalizeRoute(entryRoute) !== route) return;

      const label = entry.userEmail || entry.userId || "Kollege";
      const hint = `${label} bearbeitet dieses Feld gerade`;
      findTargetsForBaseField(baseFieldKey).forEach((node) => {
        if (!node.hasAttribute("data-v2-presence-prev-title") && node.hasAttribute("title")) {
          node.setAttribute("data-v2-presence-prev-title", String(node.getAttribute("title") || ""));
        }
        node.setAttribute("title", hint);
        node.setAttribute("data-v2-presence-remote", "1");
        node.setAttribute("data-v2-presence-label", hint);
        node.classList.add("v2-presence-remote-field");
      });
    });
}
