import { loadState } from "../data/storageLocal.js";
import { validateAll } from "../lib/dataHealth.js";

const SCOPE_LABELS = {
  settings: "Settings",
  product: "Produkte",
  supplier: "Suppliers",
  po: "PO",
  fo: "FO",
};

const SCOPE_ORDER = ["settings", "product", "supplier", "po", "fo"];

function groupByScope(issues) {
  return issues.reduce((acc, issue) => {
    if (!acc[issue.scope]) acc[issue.scope] = [];
    acc[issue.scope].push(issue);
    return acc;
  }, {});
}

function computeHealth() {
  const state = loadState();
  return validateAll({
    settings: state.settings,
    products: state.products,
    suppliers: state.suppliers,
    pos: state.pos,
    fos: state.fos,
  });
}

function ensureBadge() {
  let badge = document.getElementById("data-health-badge");
  if (!badge) {
    const header = document.querySelector(".sidebar-header");
    if (!header) return null;
    badge = document.createElement("button");
    badge.id = "data-health-badge";
    badge.type = "button";
    badge.className = "data-health-badge";
    header.append(badge);
  }
  return badge;
}

function updateBadge() {
  const badge = ensureBadge();
  if (!badge) return;
  const { issues } = computeHealth();
  const count = issues.length;
  badge.textContent = count ? `Data Health: ${count} Issues` : "Data Health: OK";
  badge.classList.toggle("is-ok", count === 0);
  badge.classList.toggle("is-issues", count > 0);
}

export function goToIssue(issue) {
  if (!issue) return;
  if (issue.scope === "product") {
    sessionStorage.setItem("healthFocus", JSON.stringify({ tab: "produkte", sku: issue.entityId }));
    location.hash = "#produkte";
    return;
  }
  if (issue.scope === "supplier") {
    sessionStorage.setItem("healthFocus", JSON.stringify({ tab: "suppliers", supplierId: issue.entityId }));
    location.hash = "#suppliers";
    return;
  }
  if (issue.scope === "settings") {
    sessionStorage.setItem("healthFocus", JSON.stringify({ tab: "settings", field: issue.field }));
    location.hash = "#settings";
    return;
  }
  if (issue.scope === "po") {
    location.hash = "#po";
    return;
  }
  if (issue.scope === "fo") {
    location.hash = "#fo";
  }
}

function buildIssueRow(issue, onClose) {
  const row = document.createElement("div");
  row.className = "data-health-item";
  const text = document.createElement("div");
  text.className = "data-health-item-text";
  const title = document.createElement("strong");
  title.textContent = issue.message;
  text.append(title);
  if (issue.hint) {
    const hint = document.createElement("div");
    hint.className = "muted";
    hint.textContent = issue.hint;
    text.append(hint);
  }
  const meta = document.createElement("span");
  meta.className = `data-health-pill ${issue.severity}`;
  meta.textContent = issue.severity === "error" ? "Fehler" : "Hinweis";
  const btn = document.createElement("button");
  btn.className = "btn secondary";
  btn.type = "button";
  btn.textContent = "Go to";
  btn.addEventListener("click", () => {
    onClose?.();
    goToIssue(issue);
  });
  row.append(text, meta, btn);
  return row;
}

export function openDataHealthPanel(filter = {}) {
  const { issues } = computeHealth();
  const filtered = issues.filter(issue => {
    if (filter.scope && issue.scope !== filter.scope) return false;
    if (filter.entityId && issue.entityId !== filter.entityId) return false;
    return true;
  });

  const overlay = document.createElement("div");
  overlay.className = "po-modal-backdrop data-health-modal";
  const panel = document.createElement("div");
  panel.className = "po-modal";
  const header = document.createElement("div");
  header.className = "po-modal-header";
  const title = document.createElement("h3");
  title.textContent = "Data Health";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn tertiary";
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("click", () => overlay.remove());
  header.append(title, closeBtn);

  const body = document.createElement("div");
  body.className = "po-modal-body";
  if (!filtered.length) {
    body.append(Object.assign(document.createElement("p"), { className: "muted", textContent: "Keine Issues gefunden." }));
  } else {
    const grouped = groupByScope(filtered);
    SCOPE_ORDER.forEach(scope => {
      const list = grouped[scope];
      if (!list || !list.length) return;
      const group = document.createElement("div");
      group.className = "data-health-group";
      const label = document.createElement("h4");
      label.textContent = `${SCOPE_LABELS[scope] || scope} (${list.length})`;
      group.append(label);
      list.forEach(issue => group.append(buildIssueRow(issue, () => overlay.remove())));
      body.append(group);
    });
  }

  const footer = document.createElement("div");
  footer.className = "po-modal-actions";
  const closeFooter = document.createElement("button");
  closeFooter.className = "btn";
  closeFooter.type = "button";
  closeFooter.textContent = "Schließen";
  closeFooter.addEventListener("click", () => overlay.remove());
  footer.append(closeFooter);

  panel.append(header, body, footer);
  overlay.append(panel);
  document.body.append(overlay);
  return overlay;
}

export function openBlockingModal(issues) {
  if (!issues || !issues.length) return;
  const overlay = document.createElement("div");
  overlay.className = "po-modal-backdrop data-health-modal";
  const panel = document.createElement("div");
  panel.className = "po-modal";
  const header = document.createElement("div");
  header.className = "po-modal-header";
  const title = document.createElement("h3");
  title.textContent = "Fehlende Stammdaten";
  header.append(title);

  const body = document.createElement("div");
  body.className = "po-modal-body";
  const list = document.createElement("ul");
  list.className = "data-health-blocking-list";
  issues.forEach(issue => {
    const li = document.createElement("li");
    li.textContent = issue.message;
    list.append(li);
  });
  body.append(list);

  const footer = document.createElement("div");
  footer.className = "po-modal-actions";
  const goBtn = document.createElement("button");
  goBtn.className = "btn primary";
  goBtn.type = "button";
  goBtn.textContent = "Zu den Stammdaten";
  goBtn.addEventListener("click", () => {
    overlay.remove();
    goToIssue(issues[0]);
  });
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn";
  cancelBtn.type = "button";
  cancelBtn.textContent = "Abbrechen";
  cancelBtn.addEventListener("click", () => overlay.remove());
  footer.append(goBtn, cancelBtn);

  panel.append(header, body, footer);
  overlay.append(panel);
  document.body.append(overlay);
  return overlay;
}

export function initDataHealthUI() {
  updateBadge();
  const badge = ensureBadge();
  if (badge) {
    badge.addEventListener("click", () => openDataHealthPanel());
  }
  window.addEventListener("state:changed", updateBadge);
  window.addEventListener("storage", updateBadge);
  document.addEventListener("datahealth:open", (event) => {
    openDataHealthPanel(event?.detail || {});
  });
}
