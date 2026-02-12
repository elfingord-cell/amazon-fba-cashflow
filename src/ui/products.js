import {
  getProductsSnapshot,
  getProductBySku,
  upsertProduct,
  deleteProductBySku,
  setProductStatus,
  setProductsTableColumns,
} from "../data/storageLocal.js";
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import {
  loadAppState,
  getViewValue,
  setViewValue,
  getViewState,
  setViewState,
} from "../storage/store.js";
import { buildSupplierLabelMap } from "./utils/supplierLabels.js";
import { formatDeNumber, parseDeNumber, validateProducts } from "../lib/dataHealth.js";
import { openDataHealthPanel } from "./dataHealthUi.js";
import { computeFreightPerUnitEur } from "../utils/costing.js";
import { evaluateProductCompleteness } from "../lib/productCompleteness.js";
import { useDraftForm } from "../hooks/useDraftForm.js";
import { useDirtyGuard } from "../hooks/useDirtyGuard.js";
import { openConfirmDialog } from "./utils/confirmDialog.js";
import { computeAbcClassification } from "../domain/abcClassification.js";
import { AppDataTable } from "../react/components/AppDataTable.jsx";
import { AppTooltip } from "../react/components/AppTooltip.jsx";

function $(sel, ctx = document) {
  return ctx.querySelector(sel);
}

function createEl(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === "class") node.className = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (key === "dataset" && value && typeof value === "object") {
      Object.entries(value).forEach(([dk, dv]) => node.dataset[dk] = dv);
    } else if (value != null) {
      node.setAttribute(key, value);
    }
  });
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function fmtDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "—";
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtMonthLong(isoMonth) {
  if (!isoMonth) return "—";
  const [y, m] = isoMonth.split("-").map(Number);
  if (!y || !m) return "—";
  const date = new Date(Date.UTC(y, m - 1, 1));
  return date.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
}

function fmtUSD(value) {
  const parsed = parseDeNumber(value);
  if (parsed == null) return "—";
  return parsed.toLocaleString("de-DE", { style: "currency", currency: "USD" });
}

function fmtEUR(value) {
  const parsed = parseDeNumber(value);
  if (parsed == null) return "—";
  return parsed.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

const ABC_CLASSES = ["A", "B", "C"];
const ABC_SORT_ORDER = { A: 0, B: 1, C: 2 };

function resolveAbcClass(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return ABC_CLASSES.includes(normalized) ? normalized : null;
}

function formatAbcDisplay(value) {
  return resolveAbcClass(value) || "—";
}

function abcSortOrder(value) {
  const resolved = resolveAbcClass(value);
  return resolved ? ABC_SORT_ORDER[resolved] : ABC_CLASSES.length;
}

function formatInputNumber(value, decimals = 2) {
  return formatDeNumber(value, decimals, { emptyValue: "", useGrouping: false });
}

function getIssueTooltip(issues) {
  if (!issues.length) return "";
  const fields = issues.map(issue => issue.field);
  const labels = fields.map((field) => {
    switch (field) {
      case "alias":
        return "Alias";
      case "currency":
        return "Currency";
      case "unitPrice":
        return "Unit Price";
      case "avgSellingPriceGrossEUR":
        return "Ø VK-Preis";
      case "sellerboardMarginPct":
        return "Sellerboard Marge";
      case "ddp":
        return "DDP";
      default:
        return field;
    }
  });
  return `Fehlt: ${[...new Set(labels)].join(", ")}`;
}

function showToast(message) {
  let toast = document.getElementById("products-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "products-toast";
    toast.className = "po-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.hidden = false;
  setTimeout(() => { toast.hidden = true; }, 2000);
}

function openModal({ title, content, actions = [], onClose }) {
  const overlay = createEl("div", { class: "po-modal-backdrop" });
  const modal = createEl("div", { class: "po-modal product-modal-frame" });
  const header = createEl("div", { class: "po-modal-header" }, [
    createEl("h3", {}, [title]),
    createEl("button", {
      type: "button",
      class: "btn tertiary",
      onclick: () => {
        if (typeof onClose === "function") {
          onClose();
          return;
        }
        document.body.removeChild(overlay);
        document.removeEventListener("keydown", escHandler);
      },
      "aria-label": "Schließen",
    }, ["✕"]),
  ]);
  const body = createEl("div", { class: "po-modal-body" }, [content]);
  const footer = createEl("div", { class: "po-modal-actions" });
  actions.forEach(action => footer.append(action));
  modal.append(header, body, footer);
  overlay.append(modal);
  let pointerDownOnOverlay = false;
  overlay.addEventListener("mousedown", ev => {
    pointerDownOnOverlay = ev.target === overlay;
  });
  overlay.addEventListener("mouseup", ev => {
    if (pointerDownOnOverlay && ev.target === overlay) {
      if (typeof onClose === "function") {
        onClose();
      } else {
        document.body.removeChild(overlay);
        document.removeEventListener("keydown", escHandler);
      }
    }
    pointerDownOnOverlay = false;
  });
  function escHandler(ev) {
    if (ev.key === "Escape") {
      if (typeof onClose === "function") {
        onClose();
        return;
      }
      document.body.removeChild(overlay);
      document.removeEventListener("keydown", escHandler);
    }
  }
  document.addEventListener("keydown", escHandler);
  document.body.append(overlay);
  return { overlay, modal, body, footer };
}

function buildHistoryTable(state, sku) {
  const rows = (state.pos || [])
    .filter(po => (po?.sku || "").trim().toLowerCase() === String(sku || "").trim().toLowerCase())
    .sort((a, b) => (b.orderDate || "").localeCompare(a.orderDate || ""))
    .slice(0, 10);
  if (!rows.length) {
    return createEl("p", { class: "empty-state" }, ["Keine Bestellhistorie verfügbar."]);
  }
  const table = createEl("table", { class: "table", "data-ui-table": "true" });
  const thead = createEl("thead", {}, [
    createEl("tr", {}, [
      createEl("th", {}, ["PO-Nr."]),
      createEl("th", {}, ["Bestelldatum"]),
      createEl("th", {}, ["Stückzahl"]),
      createEl("th", {}, ["Stückpreis (USD)"]),
      createEl("th", {}, ["Produktionstage"]),
      createEl("th", {}, ["Transit"]),
      createEl("th", {}, ["Transport"]),
      createEl("th", {}, ["Fracht (€)"]),
      createEl("th", {}, ["Zoll %"]),
      createEl("th", {}, ["EUSt %"]),
      createEl("th", {}, ["FX-Fee %"]),
    ])
  ]);
  const tbody = createEl("tbody");
  rows.forEach(po => {
    tbody.append(createEl("tr", {}, [
      createEl("td", {}, [po.poNumber || po.number || "—"]),
      createEl("td", {}, [fmtDate(po.orderDate)]),
      createEl("td", {}, [po.units != null ? formatDeNumber(parseDeNumber(po.units), 0) : "—"]),
      createEl("td", {}, [fmtUSD(po.unitCostUsd)]),
      createEl("td", {}, [Number.isFinite(Number(po.prodDays)) ? String(po.prodDays) : "—"]),
      createEl("td", {}, [Number.isFinite(Number(po.transitDays)) ? String(po.transitDays) : "—"]),
      createEl("td", {}, [po.transport || "—"]),
      createEl("td", {}, [fmtEUR(po.freightEur)]),
      createEl("td", {}, [po.dutyRatePct != null ? formatDeNumber(parseDeNumber(po.dutyRatePct), 2) : "—"]),
      createEl("td", {}, [po.eustRatePct != null ? formatDeNumber(parseDeNumber(po.eustRatePct), 2) : "—"]),
      createEl("td", {}, [po.fxFeePct != null ? formatDeNumber(parseDeNumber(po.fxFeePct), 2) : "—"]),
    ]));
  });
  table.append(thead, tbody);
  return table;
}

  function renderProducts(root) {
  const state = loadAppState();
  const abcSnapshot = computeAbcClassification(state);
  const products = getProductsSnapshot().map(product => {
    const skuKey = String(product?.sku || "").trim().toLowerCase();
    const abcInfo = skuKey ? abcSnapshot.bySku.get(skuKey) : null;
    return {
      ...product,
      abcClass: abcInfo?.abcClass ?? null,
      abcMeta: abcInfo || null,
    };
  });
  const productIssues = validateProducts(products, state.settings || {});
  const productIssuesBySku = new Map();
  productIssues.forEach(issue => {
    const key = String(issue.entityId || "").trim();
    if (!key) return;
    if (!productIssuesBySku.has(key)) productIssuesBySku.set(key, []);
    productIssuesBySku.get(key).push(issue);
  });
  const categories = Array.isArray(state.productCategories) ? state.productCategories : [];
  const categoryById = new Map(categories.map(category => [String(category.id), category]));
  const supplierLabelMap = buildSupplierLabelMap(state, products);
  let searchTerm = "";
  const completenessViewKey = "productsCompletenessView";
  const completenessView = getViewState(completenessViewKey, { filter: "all" });
  let completenessFilter = completenessView.filter || "all";
  const abcFilterViewKey = "productsAbcFilter";
  const abcFilterView = getViewState(abcFilterViewKey, { filter: "all" });
  let abcFilter = abcFilterView.filter || "all";
  const tableSortViewKey = "productsTableSort";
  const tableSortView = getViewState(tableSortViewKey, { mode: "category" });
  let tableSortMode = tableSortView.mode || "category";
  if (completenessFilter === "ready") {
    completenessFilter = "ok";
  }
  let viewMode = getViewValue("productsView");
  if (viewMode !== "table" && viewMode !== "list") {
    viewMode = "list";
  }
  const bulkDraft = root.__productsBulkDraft || useDraftForm({}, { key: "products:bulk", enableDraftCache: true });
  root.__productsBulkDraft = bulkDraft;
  const pendingEdits = bulkDraft.draft;
  if (root.__productsBulkGuard) {
    root.__productsBulkGuard.unregister();
    root.__productsBulkGuard.detachBeforeUnload();
  }
  const bulkGuard = useDirtyGuard(() => bulkDraft.isDirty, "Ungespeicherte Änderungen verwerfen?");
  root.__productsBulkGuard = bulkGuard;
  bulkGuard.register();
  bulkGuard.attachBeforeUnload();
  const collapseKey = "productsCategoryCollapse";
  const focusRaw = sessionStorage.getItem("healthFocus");
  if (focusRaw) {
    try {
      const focus = JSON.parse(focusRaw);
      if (focus?.tab === "produkte" && focus.sku) {
        searchTerm = String(focus.sku);
      }
    } catch (err) {
      // ignore
    }
    sessionStorage.removeItem("healthFocus");
  }

  const cachedBulk = bulkDraft.loadDraftIfAvailable();
  if (!root.__bulkDraftPrompted && cachedBulk?.exists && Object.keys(pendingEdits).length === 0) {
    root.__bulkDraftPrompted = true;
    openConfirmDialog({
      title: "Entwurf gefunden",
      message: "Es gibt ungespeicherte Tabellenänderungen. Wiederherstellen?",
      confirmLabel: "Wiederherstellen",
      cancelLabel: "Verwerfen",
      onConfirm: () => {
        bulkDraft.restoreDraft();
        render();
      },
      onCancel: () => {
        bulkDraft.discardDraft();
      },
    });
  }

  function buildHealthDot(sku) {
    const issues = productIssuesBySku.get(sku) || [];
    if (!issues.length) return null;
    const tooltip = getIssueTooltip(issues);
    return createEl("button", {
      class: "data-health-dot",
      type: "button",
      title: tooltip,
      "aria-label": tooltip,
      onclick: (event) => {
        event.stopPropagation();
        openDataHealthPanel({ scope: "product", entityId: sku });
      },
    });
  }

  const completenessBySku = new Map();
  const completenessContext = { state };
  function getCompleteness(product) {
    if (!product?.sku) {
      return evaluateProductCompleteness(product, { state });
    }
    if (!completenessBySku.has(product.sku)) {
      completenessBySku.set(product.sku, evaluateProductCompleteness(product, completenessContext));
    }
    return completenessBySku.get(product.sku);
  }

  function getEffectiveMoqUnits(product) {
    const settingsMoq = parseDeNumber(state?.settings?.moqDefaultUnits);
    const override = parseDeNumber(product?.moqOverrideUnits);
    if (override != null && override > 0) return Math.round(override);
    const productMoq = parseDeNumber(product?.moqUnits);
    if (productMoq != null && productMoq > 0) return Math.round(productMoq);
    if (settingsMoq != null && settingsMoq > 0) return Math.round(settingsMoq);
    return null;
  }

  function applyFilter(list, term, statusFilter, abcClassFilter) {
    const filteredBySearch = !term ? list : list.filter(item => {
      const needle = term.trim().toLowerCase();
      const categoryName = getCategoryLabel(item.categoryId);
      const supplierLabel = supplierLabelMap.get(item.supplierId);
      return [item.alias, item.sku, item.supplierId, supplierLabel, categoryName]
        .filter(Boolean)
        .some(val => String(val).toLowerCase().includes(needle));
    });
    const filteredByAbc = !abcClassFilter || abcClassFilter === "all"
      ? filteredBySearch
      : filteredBySearch.filter(item => resolveAbcClass(item.abcClass) === abcClassFilter);
    if (!statusFilter || statusFilter === "all") return filteredByAbc;
    const normalized = statusFilter === "ready"
      ? "ok"
      : (statusFilter === "warning" ? "warn" : statusFilter);
    return filteredByAbc.filter(item => getCompleteness(item).status === normalized);
  }

  function formatCompletenessLabel(status) {
    if (status === "ok") return "OK";
    if (status === "warn") return "WARN";
    return "BLOCKED";
  }

  function formatMissingSummary(items, maxItems = 3) {
    const labels = (items || []).map(item => item.label).filter(Boolean);
    if (!labels.length) return "";
    const shown = labels.slice(0, maxItems);
    const remaining = labels.length - shown.length;
    return `${shown.join(", ")}${remaining > 0 ? ` +${remaining} weitere` : ""}`;
  }

  function buildCompletenessTooltip(completeness) {
    const lines = [];
    const blockingSummary = formatMissingSummary(completeness.blockingMissing);
    const defaultSummary = formatMissingSummary(completeness.defaulted);
    const suggestedSummary = formatMissingSummary(completeness.suggestedMissing);
    if (blockingSummary) lines.push(`Fehlt: ${blockingSummary}`);
    const secondary = [];
    if (defaultSummary) secondary.push(`Standardwert: ${defaultSummary}`);
    if (suggestedSummary) secondary.push(`Empfohlen: ${suggestedSummary}`);
    if (secondary.length) lines.push(secondary.join(" · "));
    if (!lines.length) lines.push("Alle Pflichtfelder vorhanden.");
    return lines.slice(0, 2).map(line => createEl("div", {}, [line]));
  }

  function ensurePortalTooltipLayer() {
    let layer = document.getElementById("products-completeness-tooltip");
    if (!layer) {
      layer = createEl("div", {
        id: "products-completeness-tooltip",
        class: "portal-tooltip",
        role: "tooltip",
        hidden: true,
      });
      document.body.appendChild(layer);
    }
    return layer;
  }

  function attachPortalTooltip(trigger, contentBuilder, { delay = 150 } = {}) {
    let showTimer = null;
    let isVisible = false;
    let cleanupPosition = null;

    function positionTooltip() {
      const layer = ensurePortalTooltipLayer();
      const rect = trigger.getBoundingClientRect();
      const tooltipRect = layer.getBoundingClientRect();
      const padding = 8;
      let left = rect.left;
      let top = rect.bottom + 8;
      const maxLeft = window.innerWidth - tooltipRect.width - padding;
      if (left > maxLeft) left = maxLeft;
      if (left < padding) left = padding;
      if (top + tooltipRect.height > window.innerHeight - padding) {
        top = rect.top - tooltipRect.height - 8;
      }
      if (top < padding) top = padding;
      layer.style.left = `${left}px`;
      layer.style.top = `${top}px`;
    }

    function showTooltip() {
      if (isVisible) return;
      isVisible = true;
      const layer = ensurePortalTooltipLayer();
      layer.innerHTML = "";
      layer.append(...contentBuilder());
      layer.hidden = false;
      layer.classList.add("is-visible");
      trigger.setAttribute("aria-describedby", layer.id);
      requestAnimationFrame(positionTooltip);
      const onScroll = () => positionTooltip();
      const onResize = () => positionTooltip();
      window.addEventListener("scroll", onScroll, true);
      window.addEventListener("resize", onResize);
      cleanupPosition = () => {
        window.removeEventListener("scroll", onScroll, true);
        window.removeEventListener("resize", onResize);
      };
    }

    function hideTooltip() {
      clearTimeout(showTimer);
      if (!isVisible) return;
      isVisible = false;
      const layer = ensurePortalTooltipLayer();
      layer.hidden = true;
      layer.classList.remove("is-visible");
      layer.innerHTML = "";
      if (cleanupPosition) cleanupPosition();
      cleanupPosition = null;
    }

    function handleEnter() {
      clearTimeout(showTimer);
      showTimer = setTimeout(showTooltip, delay);
    }

    function handleLeave() {
      hideTooltip();
    }

    trigger.addEventListener("mouseenter", handleEnter);
    trigger.addEventListener("focus", handleEnter);
    trigger.addEventListener("mouseleave", handleLeave);
    trigger.addEventListener("blur", handleLeave);
  }

  function renderCompletenessBadge(product) {
    const completeness = getCompleteness(product);
    const status = completeness.status || "blocked";
    const label = formatCompletenessLabel(status);
    const trigger = createEl("button", {
      class: `tooltip-trigger completeness-badge ${status}`,
      type: "button",
      "aria-label": label,
      onclick: (event) => {
        event.stopPropagation();
        if (status === "blocked" && completeness.blockingMissing?.length) {
          showEditor(product, { focusFieldKey: completeness.blockingMissing[0].fieldKey });
        }
      },
    }, [label]);
    attachPortalTooltip(trigger, () => buildCompletenessTooltip(completeness));
    return trigger;
  }

  function renderCompletenessBadgeReact(product) {
    const completeness = getCompleteness(product);
    const status = completeness.status || "blocked";
    const label = formatCompletenessLabel(status);
    const tooltip = [
      formatMissingSummary(completeness.blockingMissing),
      formatMissingSummary(completeness.defaulted),
      formatMissingSummary(completeness.suggestedMissing),
    ].filter(Boolean).join(" · ") || "Alle Pflichtfelder vorhanden.";
    const btn = h("button", {
      className: `tooltip-trigger completeness-badge ${status}`,
      type: "button",
      onClick: (event) => {
        event.stopPropagation();
        if (status === "blocked" && completeness.blockingMissing?.length) {
          showEditor(product, { focusFieldKey: completeness.blockingMissing[0].fieldKey });
        }
      },
    }, label);
    return h(AppTooltip, { title: tooltip }, btn);
  }

  function renderHealthDotReact(sku) {
    const issues = productIssuesBySku.get(sku) || [];
    if (!issues.length) return null;
    const tooltip = getIssueTooltip(issues);
    return h("button", {
      className: "data-health-dot",
      type: "button",
      "aria-label": tooltip,
      onClick: (event) => {
        event.stopPropagation();
        openDataHealthPanel({ scope: "product", entityId: sku });
      },
    });
  }

  if (root.__productsActionsCleanup) {
    root.__productsActionsCleanup();
  }

  let actionsMenu = null;
  let actionsMenuAnchor = null;

  function closeActionsMenu() {
    if (actionsMenuAnchor) {
      actionsMenuAnchor.setAttribute("aria-expanded", "false");
    }
    if (actionsMenu) {
      actionsMenu.remove();
    }
    actionsMenu = null;
    actionsMenuAnchor = null;
  }

  function positionActionsMenu() {
    if (!actionsMenu || !actionsMenuAnchor) return;
    const rect = actionsMenuAnchor.getBoundingClientRect();
    const menuRect = actionsMenu.getBoundingClientRect();
    const padding = 8;
    const maxX = window.innerWidth - menuRect.width - padding;
    const maxY = window.innerHeight - menuRect.height - padding;
    let left = rect.right - menuRect.width;
    let top = rect.bottom + 6;
    left = Math.min(maxX, left);
    left = Math.max(padding, left);
    if (top > maxY) {
      top = rect.top - menuRect.height - 6;
    }
    top = Math.max(padding, top);
    actionsMenu.style.left = `${left}px`;
    actionsMenu.style.top = `${top}px`;
  }

  function openActionsMenu(anchor, product) {
    if (!anchor || !product) return;
    if (actionsMenuAnchor === anchor) {
      closeActionsMenu();
      return;
    }
    closeActionsMenu();
    const menu = createEl("div", { class: "product-actions-menu", role: "menu" });
    const historyBtn = createEl("button", {
      class: "product-actions-menu-item",
      type: "button",
      onclick: (event) => {
        event.stopPropagation();
        showHistory(product);
        closeActionsMenu();
      },
    }, ["Historie"]);
    const statusBtn = createEl("button", {
      class: "product-actions-menu-item",
      type: "button",
      onclick: (event) => {
        event.stopPropagation();
        setProductStatus(product.sku, product.status === "inactive" ? "active" : "inactive");
        closeActionsMenu();
        renderProducts(root);
      },
    }, [product.status === "inactive" ? "Aktiv setzen" : "Inaktiv setzen"]);
    const deleteBtn = createEl("button", {
      class: "product-actions-menu-item danger",
      type: "button",
      onclick: (event) => {
        event.stopPropagation();
        if (confirm("Produkt wirklich löschen?")) {
          deleteProductBySku(product.sku);
          closeActionsMenu();
          renderProducts(root);
        }
      },
    }, ["Löschen"]);
    menu.append(historyBtn, statusBtn, deleteBtn);
    document.body.appendChild(menu);
    actionsMenu = menu;
    actionsMenuAnchor = anchor;
    actionsMenuAnchor.setAttribute("aria-expanded", "true");
    positionActionsMenu();
    requestAnimationFrame(positionActionsMenu);
  }

  function handleDocumentClick(event) {
    if (!actionsMenu) return;
    if (actionsMenu.contains(event.target)) return;
    if (actionsMenuAnchor && actionsMenuAnchor.contains(event.target)) return;
    closeActionsMenu();
  }

  function handleWindowResize() {
    positionActionsMenu();
  }

  function handleWindowScroll() {
    if (!actionsMenu) return;
    closeActionsMenu();
  }

  document.addEventListener("click", handleDocumentClick);
  window.addEventListener("resize", handleWindowResize);
  window.addEventListener("scroll", handleWindowScroll, true);
  root.__productsActionsCleanup = () => {
    closeActionsMenu();
    document.removeEventListener("click", handleDocumentClick);
    window.removeEventListener("resize", handleWindowResize);
    window.removeEventListener("scroll", handleWindowScroll, true);
  };

  function getCategoryLabel(categoryId) {
    if (!categoryId) return "Ohne Kategorie";
    const category = categoryById.get(String(categoryId));
    return category?.name || "Ohne Kategorie";
  }

  function loadCollapseState() {
    return getViewState(collapseKey, {});
  }

  function saveCollapseState(next) {
    setViewState(collapseKey, next);
  }

  function setAllCategoriesCollapsed(collapsed) {
    const next = {};
    const groups = buildCategoryGroups(products);
    groups.forEach(group => {
      next[group.id] = collapsed;
    });
    saveCollapseState(next);
  }

  function buildCategoryGroups(list, { sortMode } = {}) {
    const categoryMap = new Map();
    list.forEach(product => {
      const key = product.categoryId ? String(product.categoryId) : "";
      if (!categoryMap.has(key)) categoryMap.set(key, []);
      categoryMap.get(key).push(product);
    });
    if (sortMode === "abc") {
      categoryMap.forEach((items) => {
        items.sort((a, b) => {
          const diff = abcSortOrder(a.abcClass) - abcSortOrder(b.abcClass);
          if (diff) return diff;
          return String(a.alias || a.sku || "").localeCompare(String(b.alias || b.sku || ""));
        });
      });
    }
    const sortedCategories = categories
      .slice()
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.name || "").localeCompare(String(b.name || "")));
    const groups = sortedCategories.map(category => ({
      id: String(category.id),
      name: category.name || "Ohne Kategorie",
      items: categoryMap.get(String(category.id)) || [],
    }));
    const uncategorized = categoryMap.get("") || [];
    if (uncategorized.length) {
      groups.push({ id: "uncategorized", name: "Ohne Kategorie", items: uncategorized });
    }
    return groups;
  }

  function showEditor(existing, options = {}) {
    const state = loadAppState();
    let product = existing
      ? { ...existing }
      : { sku: "", alias: "", supplierId: "", status: "active", tags: [], template: null, abcClass: null };
    const draftForm = useDraftForm(product, { key: product.sku ? `product:${product.sku}` : "product:new", enableDraftCache: true });
    product = draftForm.draft;
    const dirtyGuard = useDirtyGuard(() => draftForm.isDirty, "Ungespeicherte Änderungen verwerfen?");
    const form = createEl("form", { class: "form" });
    const focusFieldKey = options.focusFieldKey;

    const skuInput = createEl("input", { value: product.sku || "", required: true });
    const aliasInput = createEl("input", { value: product.alias || "", required: true });
    const supplierInput = (() => {
      const select = createEl("select");
      select.append(createEl("option", { value: "" }, ["Ohne Supplier"]));
      (state.suppliers || []).forEach(supplier => {
        const label = supplierLabelMap.get(supplier.id) || supplier.name || supplier.id;
        select.append(createEl("option", { value: supplier.id }, [label]));
      });
      select.value = product.supplierId || "";
      return select;
    })();
    const statusSelect = createEl("select", {}, [
      createEl("option", { value: "active", selected: product.status !== "inactive" }, ["Aktiv"]),
      createEl("option", { value: "inactive", selected: product.status === "inactive" }, ["Inaktiv"]),
    ]);
    const abcDisplay = createEl("input", { value: formatAbcDisplay(product.abcClass), disabled: true });
    const categorySelect = (() => {
      const select = createEl("select");
      select.append(createEl("option", { value: "" }, ["Ohne Kategorie"]));
      categories.forEach(category => {
        select.append(createEl("option", { value: category.id }, [category.name]));
      });
      select.value = product.categoryId || "";
      return select;
    })();
    const avgSellingPriceInput = createEl("input", {
      value: product.avgSellingPriceGrossEUR != null ? formatInputNumber(parseDeNumber(product.avgSellingPriceGrossEUR), 2) : "",
      inputmode: "decimal",
    });
    const sellerboardMarginInput = createEl("input", {
      value: product.sellerboardMarginPct != null ? formatInputNumber(parseDeNumber(product.sellerboardMarginPct), 2) : "",
      inputmode: "decimal",
    });
    const productionLeadTimeInput = createEl("input", {
      value: product.productionLeadTimeDaysDefault != null
        ? formatInputNumber(parseDeNumber(product.productionLeadTimeDaysDefault), 0)
        : "",
      inputmode: "decimal",
    });
    const moqInput = createEl("input", {
      value: product.moqUnits != null
        ? formatInputNumber(parseDeNumber(product.moqUnits), 0)
        : "",
      inputmode: "decimal",
    });
    const safetyStockOverrideInput = createEl("input", {
      value: product.safetyStockDohOverride != null
        ? formatInputNumber(parseDeNumber(product.safetyStockDohOverride), 0)
        : "",
      inputmode: "decimal",
    });
    const foCoverageOverrideInput = createEl("input", {
      value: product.foCoverageDohOverride != null
        ? formatInputNumber(parseDeNumber(product.foCoverageDohOverride), 0)
        : "",
      inputmode: "decimal",
    });
    const moqOverrideInput = createEl("input", {
      value: product.moqOverrideUnits != null
        ? formatInputNumber(parseDeNumber(product.moqOverrideUnits), 0)
        : "",
      inputmode: "decimal",
    });
    const landedUnitCostInput = createEl("input", {
      value: product.landedUnitCostEur != null
        ? formatInputNumber(parseDeNumber(product.landedUnitCostEur), 2)
        : "",
      inputmode: "decimal",
    });

    const template = product.template?.fields ? { ...product.template.fields } : (product.template || {});
    if (!template.transportMode && template.transport) {
      template.transportMode = template.transport;
    }
    const settings = state.settings || {};
    const safetyStockDefault = Number(settings.safetyStockDohDefault ?? 60);
    const foCoverageDefault = Number(settings.foCoverageDohDefault ?? 90);
    const moqDefaultUnits = Number(settings.moqDefaultUnits ?? 500);
    const fxRateDefault = parseDeNumber(settings.fxRate) ?? parseDeNumber(settings.fxRate) ?? null;
    const templateDefaults = {
      unitPriceUsd: 0,
      extraPerUnitUsd: 0,
      extraFlatUsd: 0,
      transportMode: "SEA",
      productionDays: 0,
      transitDays: 0,
      freightEur: 0,
      dutyPct: 0,
      vatImportPct: 19,
      vatRefundLag: 0,
      fxRate: fxRateDefault,
      fxFeePct: 0,
      ddp: settings.defaultDdp === true,
      currency: settings.defaultCurrency || "EUR",
    };

    const templateFields = [
      { key: "unitPriceUsd", label: "Stückpreis (USD)", valueType: "number", decimals: 2 },
      { key: "extraPerUnitUsd", label: "Zusatz je Stück (USD)", valueType: "number", decimals: 2 },
      { key: "extraFlatUsd", label: "Zusatz pauschal (USD)", valueType: "number", decimals: 2 },
      { key: "transportMode", label: "Transport", type: "select", options: ["SEA", "RAIL", "AIR"] },
      { key: "productionDays", label: "Produktionstage", valueType: "number", decimals: 0 },
      { key: "transitDays", label: "Transit-Tage", valueType: "number", decimals: 0 },
      { key: "freightEur", label: "Logistik / Stk. (EUR)", valueType: "number", decimals: 2 },
      { key: "dutyPct", label: "Zoll %", valueType: "number", decimals: 2 },
      { key: "dutyIncludesFreight", label: "Fracht einbeziehen", type: "checkbox" },
      { key: "vatImportPct", label: "EUSt %", valueType: "number", decimals: 2 },
      { key: "vatRefundActive", label: "EUSt-Erstattung aktiv", type: "checkbox" },
      { key: "vatRefundLag", label: "EUSt-Lag (Monate)", valueType: "number", decimals: 0 },
      { key: "fxRate", label: "FX-Kurs", valueType: "number", decimals: 4 },
      { key: "fxFeePct", label: "FX-Gebühr %", valueType: "number", decimals: 2 },
      { key: "currency", label: "Currency", type: "select", options: ["USD", "EUR", "CNY"] },
      { key: "ddp", label: "DDP", type: "checkbox" },
    ];

    const templateHeader = createEl("div", { class: "table-card-header" }, [
      createEl("h4", {}, ["Template-Werte"]),
      createEl("button", { class: "btn secondary", type: "button", id: "product-apply-latest" }, ["Letzte PO Werte übernehmen"]),
    ]);

    const completenessSummary = createEl("div", { class: "product-completeness-summary", hidden: true });
    const completenessSummaryTitle = createEl("div", { class: "product-completeness-summary-title" });
    const completenessSummaryList = createEl("div", { class: "product-completeness-summary-list" });
    completenessSummary.append(completenessSummaryTitle, completenessSummaryList);

    const skuLabel = createEl("label", {}, ["SKU", skuInput]);
    const aliasLabel = createEl("label", {}, ["Alias", aliasInput]);
    const supplierLabel = createEl("label", {}, ["Supplier", supplierInput]);
    const categoryLabel = createEl("label", {}, ["Kategorie", categorySelect]);
    const statusLabel = createEl("label", {}, ["Status", statusSelect]);
    const abcLabel = createEl("label", {}, ["ABC Klassifizierung", abcDisplay]);
    const avgSellingPriceLabel = createEl("label", {}, ["Ø VK-Preis (Brutto)", avgSellingPriceInput]);
    const sellerboardMarginLabel = createEl("label", {}, ["Sellerboard Marge (%)", sellerboardMarginInput]);
    const productionLeadTimeLabel = createEl("label", {}, ["Default Production Lead Time (Fallback)", productionLeadTimeInput]);
    const moqLabel = createEl("label", {}, ["MOQ (Einheiten)", moqInput]);
    const safetyStockLabel = createEl("label", {}, [
      "Safety Stock DOH Override (optional)",
      safetyStockOverrideInput,
      createEl("small", { class: "muted", id: "safety-stock-effective" }, []),
    ]);
    const foCoverageLabel = createEl("label", {}, [
      "FO Coverage DOH Override (optional)",
      foCoverageOverrideInput,
      createEl("small", { class: "muted", id: "fo-coverage-effective" }, []),
    ]);
    const moqOverrideLabel = createEl("label", {}, [
      "MOQ Override (optional)",
      moqOverrideInput,
      createEl("small", { class: "muted", id: "moq-effective" }, []),
    ]);
    const landedUnitCostLabel = createEl("label", {}, [
      "Einstandspreis (EUR)",
      landedUnitCostInput,
      createEl("small", { class: "muted", id: "shipping-derived" }, []),
    ]);

    form.append(
      completenessSummary,
      skuLabel,
      aliasLabel,
      supplierLabel,
      categoryLabel,
      statusLabel,
      abcLabel,
      avgSellingPriceLabel,
      sellerboardMarginLabel,
      productionLeadTimeLabel,
      moqLabel,
      createEl("hr"),
      createEl("h4", {}, ["Inventory Planning Overrides"]),
      safetyStockLabel,
      foCoverageLabel,
      moqOverrideLabel,
      landedUnitCostLabel,
      createEl("hr"),
      templateHeader
    );

    const numericFields = [
      { input: avgSellingPriceInput, decimals: 2 },
      { input: sellerboardMarginInput, decimals: 2 },
      { input: productionLeadTimeInput, decimals: 0 },
      { input: moqInput, decimals: 0 },
      { input: safetyStockOverrideInput, decimals: 0 },
      { input: foCoverageOverrideInput, decimals: 0 },
      { input: moqOverrideInput, decimals: 0 },
      { input: landedUnitCostInput, decimals: 2 },
    ];
    numericFields.forEach(({ input, decimals }) => {
      input.addEventListener("blur", () => {
        const parsed = parseDeNumber(input.value);
        input.value = parsed == null ? "" : formatInputNumber(parsed, decimals);
        updateEffectiveValues();
      });
      input.addEventListener("input", () => {
        updateEffectiveValues();
      });
    });

    const templateContainer = createEl("div", { class: "grid two" });
    const templateInputs = {};
    const templateErrors = {};
    const templateFieldMeta = {};
    const requiredFieldTargets = new Map();
    const suggestedFieldTargets = new Map();
    const requiredHelperText = "Pflichtfeld – benötigt für PO/FO & Kalkulation";
    const suggestedHelperText = {
      avgSellingPriceGrossEUR: "Empfohlen für Pricing Analytics.",
      sellerboardMarginPct: "Empfohlen für Pricing Analytics.",
      landedUnitCostEur: "Wird verfügbar nach erster PO / kann später gepflegt werden.",
    };
    const fieldRules = {
      unitPriceUsd: { min: 0 },
      extraPerUnitUsd: { min: 0 },
      extraFlatUsd: { min: 0 },
      productionDays: { min: 0, integer: true },
      transitDays: { min: 0, integer: true },
      freightEur: { min: 0 },
      dutyPct: { min: 0, max: 100 },
      vatImportPct: { min: 0, max: 100 },
      vatRefundLag: { min: 0, integer: true },
      fxRate: { min: 0.0001 },
      fxFeePct: { min: 0, max: 100 },
    };

    function validateField(key) {
      const rule = fieldRules[key];
      if (!rule) return true;
      const input = templateInputs[key];
      const error = templateErrors[key];
      if (!input || !error) return true;
      const raw = String(input.value || "").trim();
      if (!raw) {
        const defaultValue = templateDefaults[key];
        if (key === "fxRate" && (defaultValue == null || defaultValue <= 0)) {
          error.textContent = "FX-Kurs ist erforderlich.";
          return false;
        }
        error.textContent = "";
        return true;
      }
      const parsed = parseDeNumber(raw);
      if (parsed == null) {
        error.textContent = "Ungültiger Wert.";
        return false;
      }
      if (rule.integer && !Number.isInteger(parsed)) {
        error.textContent = "Bitte eine ganze Zahl eingeben.";
        return false;
      }
      if (rule.min != null && parsed < rule.min) {
        error.textContent = `Wert muss ≥ ${rule.min} sein.`;
        return false;
      }
      if (rule.max != null && parsed > rule.max) {
        error.textContent = `Wert muss ≤ ${rule.max} sein.`;
        return false;
      }
      error.textContent = "";
      return true;
    }

    function validateAll() {
      return Object.keys(fieldRules).every(key => validateField(key));
    }

    function updateSaveState() {
      const valid = validateAll();
      const completeness = latestCompleteness || computeCompletenessFromInputs();
      const isBlocked = completeness.status === "blocked";
      saveBtn.disabled = !valid || !draftForm.isDirty || isBlocked;
    }
    const freightHint = (() => {
      const history = (state.pos || [])
        .filter(po => String(po?.sku || "").trim().toLowerCase() === String(product.sku || "").trim().toLowerCase())
        .sort((a, b) => (b.orderDate || "").localeCompare(a.orderDate || ""));
      const latest = history[0];
      if (!latest) {
        return "Hinweis: —";
      }
      const freightPerUnit = parseDeNumber(latest.freightPerUnitEur);
      const units = parseDeNumber(latest.units);
      const freightTotal = parseDeNumber(latest.freightEur);
      const computed = freightPerUnit ?? (freightTotal != null && units ? freightTotal / units : null);
      if (computed == null || !Number.isFinite(computed)) {
        return "Hinweis: —";
      }
      return `Hinweis: Logistik / Stk. (EUR) aus letzter PO: ${formatDeNumber(computed, 2)} €`;
    })();

    function registerRequiredTarget(fieldKey, labelEl, input) {
      if (!labelEl || !input) return;
      const helper = createEl("small", { class: "field-required-helper", hidden: true }, [requiredHelperText]);
      labelEl.append(helper);
      requiredFieldTargets.set(fieldKey, { input, helper });
    }

    function registerSuggestedTarget(fieldKey, labelEl, input) {
      if (!labelEl || !input) return;
      const helper = createEl("small", { class: "field-suggested-helper", hidden: true }, [
        suggestedHelperText[fieldKey] || "Empfohlen.",
      ]);
      labelEl.append(helper);
      suggestedFieldTargets.set(fieldKey, { input, helper });
    }

    function focusRequiredField(fieldKey) {
      const target = requiredFieldTargets.get(fieldKey);
      if (!target) return;
      target.input.scrollIntoView({ behavior: "smooth", block: "center" });
      target.input.focus({ preventScroll: true });
    }
    templateFields.forEach(field => {
      templateFieldMeta[field.key] = field;
      if (field.type === "checkbox") {
        const checkbox = createEl("input", { type: "checkbox", name: field.key, checked: Boolean(template[field.key]) });
        templateInputs[field.key] = checkbox;
        templateContainer.append(createEl("label", { class: "inline-checkbox" }, [checkbox, " ", field.label]));
      } else if (field.type === "select") {
        const select = createEl("select", { name: field.key });
        (field.options || []).forEach(option => {
          select.append(createEl("option", { value: option }, [option]));
        });
        const baseValue = template[field.key] ?? templateDefaults[field.key];
        select.value = baseValue || (field.options ? field.options[0] : "");
        templateInputs[field.key] = select;
        templateContainer.append(
          createEl("label", {}, [
            field.label,
            select,
          ])
        );
      } else {
        const decimals = typeof field.decimals === "number" ? field.decimals : 2;
        const rawValue = template[field.key] ?? templateDefaults[field.key];
        const parsedValue = parseDeNumber(rawValue);
        const displayValue = parsedValue != null ? formatInputNumber(parsedValue, decimals) : "";
        const input = createEl("input", { name: field.key, value: displayValue, inputmode: "decimal" });
        input.addEventListener("blur", () => {
          const parsed = parseDeNumber(input.value);
          const defaultValue = templateDefaults[field.key];
          const nextValue = parsed == null ? defaultValue : parsed;
          input.value = nextValue == null ? "" : formatInputNumber(nextValue, decimals);
          validateField(field.key);
          updateSaveState();
          if (field.key === "unitPriceUsd") updateEffectiveValues();
        });
        input.addEventListener("input", () => {
          validateField(field.key);
          updateSaveState();
          if (field.key === "unitPriceUsd") updateEffectiveValues();
        });
        templateInputs[field.key] = input;
        const error = createEl("small", { class: "form-error" }, []);
        templateErrors[field.key] = error;
        const label = createEl("label", {}, [
          field.label,
          input,
          error,
        ]);
        if (field.key === "freightEur") {
          label.append(createEl("small", { class: "muted" }, [freightHint]));
        }
        if (field.key === "unitPriceUsd") {
          registerRequiredTarget("unitPriceUsd", label, input);
        }
        if (field.key === "transitDays") {
          registerRequiredTarget("transitDays", label, input);
        }
        if (field.key === "dutyPct") {
          registerRequiredTarget("dutyPct", label, input);
        }
        if (field.key === "vatImportPct") {
          registerRequiredTarget("vatImportPct", label, input);
        }
        templateContainer.append(label);
      }
    });
    form.append(templateContainer);

    const safetyStockEffective = $("#safety-stock-effective", form);
    const foCoverageEffective = $("#fo-coverage-effective", form);
    const moqEffective = $("#moq-effective", form);
    const shippingDerived = $("#shipping-derived", form);

    function updateEffectiveValues() {
      const safetyOverride = parseDeNumber(safetyStockOverrideInput.value);
      const coverageOverride = parseDeNumber(foCoverageOverrideInput.value);
      const moqOverride = parseDeNumber(moqOverrideInput.value);
      const effectiveSafety = safetyOverride != null ? safetyOverride : safetyStockDefault;
      const effectiveCoverage = coverageOverride != null ? coverageOverride : foCoverageDefault;
      const effectiveMoq = moqOverride != null ? moqOverride : moqDefaultUnits;
      if (safetyStockEffective) {
        safetyStockEffective.textContent = `Effektiv: ${formatDeNumber(effectiveSafety, 0)} Tage (Default: ${formatDeNumber(safetyStockDefault, 0)})`;
      }
      if (foCoverageEffective) {
        foCoverageEffective.textContent = `Effektiv: ${formatDeNumber(effectiveCoverage, 0)} Tage (Default: ${formatDeNumber(foCoverageDefault, 0)})`;
      }
      if (moqEffective) {
        moqEffective.textContent = `Effektiv: ${formatDeNumber(effectiveMoq, 0)} Einheiten (Default: ${formatDeNumber(moqDefaultUnits, 0)})`;
      }
      if (shippingDerived) {
        const unitCostUsd = parseDeNumber(templateInputs.unitPriceUsd?.value);
        const landedUnitCostEur = parseDeNumber(landedUnitCostInput.value);
        const fxUsdPerEur = parseDeNumber(templateInputs.fxRate?.value) ?? fxRateDefault;
        const derived = computeFreightPerUnitEur({
          unitPriceUsd: unitCostUsd,
          landedCostEur: landedUnitCostEur,
          fxUsdPerEur,
        });
        shippingDerived.innerHTML = "";
        const label = derived.value == null
          ? "Logistik / Stk. (EUR, berechnet): —"
          : `Logistik / Stk. (EUR, berechnet): ${formatDeNumber(derived.value, 2)} €`;
        shippingDerived.append(document.createTextNode(label));
        const missingLabels = derived.missingFields.map((field) => {
          if (field === "landedCostEur") return "Einstandspreis (EUR)";
          if (field === "unitPriceUsd") return "Stückpreis USD";
          if (field === "fxUsdPerEur") return "FX (USD je EUR)";
          return field;
        });
        shippingDerived.append(createEl("span", { class: "tooltip" }, [
          createEl("button", { class: "tooltip-trigger", type: "button", "aria-label": "Formel" }, ["ℹ️"]),
          createEl("span", { class: "tooltip-content" }, [
            "Formel: Einstandspreis (EUR) – (Stückpreis USD ÷ FX). Negative Werte werden auf 0 gesetzt.",
            missingLabels.length ? ` Fehlend: ${missingLabels.join(", ")}.` : "",
          ]),
        ]));
        if (derived.warning) {
          shippingDerived.append(createEl("span", { class: "badge fo-recommendation-badge" }, ["Check landed cost / FX"]));
        }
      }
    }

    function setFieldValue(key, value) {
      const input = templateInputs[key];
      if (!input) return;
      const meta = templateFieldMeta[key] || {};
      if (input.type === "checkbox") {
        input.checked = Boolean(value);
        return;
      }
      if (input.tagName === "SELECT") {
        input.value = value != null ? String(value) : input.value;
        return;
      }
      const decimals = typeof meta.decimals === "number" ? meta.decimals : 2;
      const parsed = parseDeNumber(value);
      input.value = parsed == null ? "" : formatInputNumber(parsed, decimals);
      validateField(key);
    }

    function applyDraftToInputs() {
      const draft = draftForm.draft || {};
      skuInput.value = draft.sku || "";
      aliasInput.value = draft.alias || "";
      supplierInput.value = draft.supplierId || "";
      statusSelect.value = draft.status || "active";
      categorySelect.value = draft.categoryId || "";
      abcDisplay.value = formatAbcDisplay(product.abcClass);
      avgSellingPriceInput.value = draft.avgSellingPriceGrossEUR != null
        ? formatInputNumber(parseDeNumber(draft.avgSellingPriceGrossEUR), 2)
        : "";
      sellerboardMarginInput.value = draft.sellerboardMarginPct != null
        ? formatInputNumber(parseDeNumber(draft.sellerboardMarginPct), 2)
        : "";
      productionLeadTimeInput.value = draft.productionLeadTimeDaysDefault != null
        ? formatInputNumber(parseDeNumber(draft.productionLeadTimeDaysDefault), 0)
        : "";
      moqInput.value = draft.moqUnits != null
        ? formatInputNumber(parseDeNumber(draft.moqUnits), 0)
        : "";
      safetyStockOverrideInput.value = draft.safetyStockDohOverride != null
        ? formatInputNumber(parseDeNumber(draft.safetyStockDohOverride), 0)
        : "";
      foCoverageOverrideInput.value = draft.foCoverageDohOverride != null
        ? formatInputNumber(parseDeNumber(draft.foCoverageDohOverride), 0)
        : "";
      moqOverrideInput.value = draft.moqOverrideUnits != null
        ? formatInputNumber(parseDeNumber(draft.moqOverrideUnits), 0)
        : "";
      landedUnitCostInput.value = draft.landedUnitCostEur != null
        ? formatInputNumber(parseDeNumber(draft.landedUnitCostEur), 2)
        : "";
      const draftTemplate = draft.template?.fields ? draft.template.fields : (draft.template || {});
      Object.keys(templateInputs).forEach(key => {
        setFieldValue(key, draftTemplate[key]);
      });
      milestonesArea.value = draftTemplate.milestones ? JSON.stringify(draftTemplate.milestones, null, 2) : "";
      updateEffectiveValues();
      updateCompletenessUI();
    }

    function applyLatestPoValues() {
      const sku = skuInput.value.trim();
      if (!sku) {
        showToast("Bitte zuerst eine SKU angeben.");
        return;
      }
      const latestPo = (state.pos || [])
        .filter(po => String(po?.sku || "").trim().toLowerCase() === sku.toLowerCase())
        .sort((a, b) => (b.orderDate || "").localeCompare(a.orderDate || ""))[0];
      if (!latestPo) {
        showToast("Keine PO vorhanden.");
        return;
      }
      const freightPerUnit = parseDeNumber(latestPo.freightPerUnitEur);
      const units = parseDeNumber(latestPo.units);
      const freightTotal = parseDeNumber(latestPo.freightEur);
      const computedFreight = freightPerUnit ?? (freightTotal != null && units ? freightTotal / units : null);
      setFieldValue("unitPriceUsd", latestPo.unitCostUsd);
      setFieldValue("freightEur", computedFreight);
      setFieldValue("productionDays", latestPo.prodDays);
      setFieldValue("transitDays", latestPo.transitDays);
      setFieldValue("transportMode", String(latestPo.transport || "SEA").toUpperCase());
      setFieldValue("dutyPct", latestPo.dutyRatePct);
      setFieldValue("vatImportPct", latestPo.eustRatePct);
      setFieldValue("fxRate", latestPo.fxOverride ?? settings.fxRate);
      setFieldValue("fxFeePct", latestPo.fxFeePct);
      setFieldValue("ddp", latestPo.ddp === true);
      setFieldValue("currency", "USD");
      updateEffectiveValues();
      syncDraftFromInputs();
      showToast("Letzte PO Werte übernommen.");
    }

    const milestonesArea = createEl("textarea", {
      placeholder: "Milestones im JSON-Format (optional)",
      value: template.milestones ? JSON.stringify(template.milestones, null, 2) : "",
      rows: 6,
      style: "width:100%; margin-top:12px;"
    });
    form.append(createEl("label", {}, ["Meilensteine (JSON)", milestonesArea]));

    const historySection = createEl("div", { class: "product-history" }, [
      createEl("h4", {}, ["Historie"]),
      buildHistoryTable(state, product.sku),
    ]);

    const suppliersSection = createEl("div", { class: "product-suppliers" }, [
      createEl("h4", {}, ["Suppliers"]),
      createEl("p", { class: "muted" }, ["SKU-Mappings wurden entfernt. Lieferanten und Preise werden direkt im Produktstamm gepflegt."]),
    ]);

    const saveBtn = createEl("button", { class: "btn", type: "submit" }, ["Speichern"]);
    const cancelBtn = createEl("button", { class: "btn secondary", type: "button" }, ["Abbrechen"]);

    let dialog;
    let latestCompleteness = evaluateProductCompleteness(product, { state });
    dirtyGuard.register();
    dirtyGuard.attachBeforeUnload();

    function finalizeClose() {
      dirtyGuard.unregister();
      dirtyGuard.detachBeforeUnload();
      if (root.__productsBulkGuard) {
        root.__productsBulkGuard.register();
      }
      dialog.overlay.remove();
    }

    function attemptClose() {
      if (!draftForm.isDirty) {
        finalizeClose();
        return;
      }
      dirtyGuard({
        confirmWithModal: ({ onConfirm }) => openConfirmDialog({
          title: "Ungespeicherte Änderungen",
          message: "Ungespeicherte Änderungen verwerfen?",
          confirmLabel: "Verwerfen",
          cancelLabel: "Abbrechen",
          onConfirm: () => {
            draftForm.discardDraft();
            onConfirm?.();
            finalizeClose();
          },
        }),
      });
    }

    dialog = openModal({
      title: existing ? `Produkt bearbeiten – ${existing.alias || existing.sku}` : "Neues Produkt",
      content: createEl("div", {}, [form, historySection, suppliersSection]),
      actions: [cancelBtn, saveBtn],
      onClose: attemptClose,
    });
    cancelBtn.addEventListener("click", attemptClose);
    saveBtn.addEventListener("click", ev => {
      ev.preventDefault();
      form.requestSubmit();
    });

    const cached = draftForm.loadDraftIfAvailable();
    if (cached?.exists) {
      openConfirmDialog({
        title: "Entwurf gefunden",
        message: "Es gibt einen ungespeicherten Entwurf. Wiederherstellen?",
        confirmLabel: "Wiederherstellen",
        cancelLabel: "Verwerfen",
        onConfirm: () => {
          draftForm.restoreDraft();
          applyDraftToInputs();
          syncDraftFromInputs();
        },
        onCancel: () => {
          draftForm.discardDraft();
          updateSaveState();
        },
      });
    }
    const applyBtn = $("#product-apply-latest", form);
    if (applyBtn) {
      applyBtn.addEventListener("click", applyLatestPoValues);
    }
    registerRequiredTarget("sku", skuLabel, skuInput);
    registerRequiredTarget("alias", aliasLabel, aliasInput);
    registerRequiredTarget("categoryId", categoryLabel, categorySelect);
    registerRequiredTarget("moqUnits", moqLabel, moqInput);
    registerRequiredTarget("productionLeadTimeDaysDefault", productionLeadTimeLabel, productionLeadTimeInput);
    registerRequiredTarget("avgSellingPriceGrossEUR", avgSellingPriceLabel, avgSellingPriceInput);
    registerSuggestedTarget("sellerboardMarginPct", sellerboardMarginLabel, sellerboardMarginInput);
    registerSuggestedTarget("landedUnitCostEur", landedUnitCostLabel, landedUnitCostInput);
    Object.keys(fieldRules).forEach(key => validateField(key));
    updateCompletenessUI();
    updateEffectiveValues();
    if (focusFieldKey) {
      requestAnimationFrame(() => focusRequiredField(focusFieldKey));
    }

    function parseMilestones({ strict } = {}) {
      const msValue = milestonesArea.value.trim();
      if (!msValue) return null;
      try {
        const parsed = JSON.parse(msValue);
        if (!Array.isArray(parsed)) return null;
        const sum = parsed.reduce((acc, row) => acc + Number(row.percent || 0), 0);
        if (strict && Math.round(sum) !== 100) {
          throw new Error("Meilensteine müssen in Summe 100 % ergeben.");
        }
        return parsed;
      } catch (err) {
        if (strict) throw err;
        return null;
      }
    }

    function buildPayload({ strictMilestones = false } = {}) {
      const payload = {
        sku: skuInput.value.trim(),
        alias: aliasInput.value.trim(),
        supplierId: supplierInput.value.trim(),
        categoryId: categorySelect.value.trim() || null,
        status: statusSelect.value,
        tags: Array.isArray(product.tags) ? [...product.tags] : [],
        avgSellingPriceGrossEUR: parseDeNumber(avgSellingPriceInput.value.trim()),
        sellerboardMarginPct: parseDeNumber(sellerboardMarginInput.value.trim()),
        productionLeadTimeDaysDefault: parseDeNumber(productionLeadTimeInput.value.trim()),
        moqUnits: parseDeNumber(moqInput.value.trim()),
        safetyStockDohOverride: parseDeNumber(safetyStockOverrideInput.value.trim()),
        foCoverageDohOverride: parseDeNumber(foCoverageOverrideInput.value.trim()),
        moqOverrideUnits: parseDeNumber(moqOverrideInput.value.trim()),
        landedUnitCostEur: parseDeNumber(landedUnitCostInput.value.trim()),
      };
      if (existing?.sku) {
        payload.originalSku = existing.sku;
      }
      const templateObj = {};
      Object.entries(templateInputs).forEach(([key, input]) => {
        if (!input) return;
        if (input.type === "checkbox") {
          templateObj[key] = input.checked;
          return;
        }
        if (input.tagName === "SELECT") {
          templateObj[key] = input.value;
          return;
        }
        const raw = input.value.trim();
        const meta = templateFieldMeta[key] || {};
        if (raw === "") {
          const fallback = templateDefaults[key];
          if (fallback != null) templateObj[key] = fallback;
          return;
        }
        if (meta.valueType === "text") {
          templateObj[key] = raw;
          return;
        }
        const parsed = parseDeNumber(raw);
        if (parsed != null) templateObj[key] = parsed;
      });
      const milestones = parseMilestones({ strict: strictMilestones });
      if (milestones) templateObj.milestones = milestones;
      if (Object.keys(templateObj).length) {
        payload.template = {
          scope: existing?.template?.scope || "SKU",
          name: existing?.template?.name || "Standard (SKU)",
          fields: templateObj,
        };
      } else {
        payload.template = null;
      }
      const fxUsdPerEur = templateObj.fxRate ?? fxRateDefault;
      const derivedFreight = computeFreightPerUnitEur({
        unitPriceUsd: templateObj.unitPriceUsd ?? null,
        landedCostEur: payload.landedUnitCostEur,
        fxUsdPerEur,
      });
      payload.fxUsdPerEur = fxUsdPerEur ?? null;
      payload.logisticsPerUnitEur = derivedFreight.value;
      payload.freightPerUnitEur = derivedFreight.value;
      return payload;
    }

    function computeCompletenessFromInputs() {
      const draft = buildPayload();
      return evaluateProductCompleteness(draft, { state });
    }

    function formatDefaultHelperText(entry) {
      if (!entry) return "";
      if (entry.fieldKey === "unitPriceUsd" && entry.value) {
        const amount = formatDeNumber(entry.value.amount, 2);
        const currency = entry.value.currency || "";
        return `Default aktiv: ${amount} ${currency}`.trim();
      }
      if (entry.fieldKey === "moqUnits") {
        return `Default aktiv: ${formatDeNumber(entry.value, 0)} Einheiten`;
      }
      if (entry.fieldKey === "productionLeadTimeDaysDefault" || entry.fieldKey === "transitDays") {
        return `Default aktiv: ${formatDeNumber(entry.value, 0)} Tage`;
      }
      if (entry.fieldKey === "dutyPct" || entry.fieldKey === "vatImportPct") {
        return `Default aktiv: ${formatDeNumber(entry.value, 2)} %`;
      }
      return "Default aktiv";
    }

    function updateCompletenessSummary(completeness) {
      const missing = completeness.blockingMissing || [];
      const defaulted = completeness.defaulted || [];
      completenessSummaryList.innerHTML = "";
      if (missing.length) {
        completenessSummary.hidden = false;
        completenessSummary.classList.add("blocked");
        completenessSummary.classList.remove("warn");
        completenessSummaryTitle.textContent = `Blockiert: ${missing.length} Pflichtfelder fehlen`;
        missing.forEach(item => {
          const button = createEl("button", { class: "btn secondary sm", type: "button" }, [item.label]);
          button.addEventListener("click", () => focusRequiredField(item.fieldKey));
          completenessSummaryList.append(button);
        });
        return;
      }
      if (defaulted.length) {
        completenessSummary.hidden = false;
        completenessSummary.classList.add("warn");
        completenessSummary.classList.remove("blocked");
        completenessSummaryTitle.textContent = "Hinweis: Defaults aktiv";
        defaulted.forEach(item => {
          const chip = createEl("span", { class: "btn secondary sm" }, [item.label]);
          completenessSummaryList.append(chip);
        });
        return;
      }
      completenessSummary.hidden = true;
      completenessSummary.classList.remove("blocked", "warn");
    }

    function updateCompletenessHighlights(completeness) {
      const missingKeys = new Set((completeness.blockingMissing || []).map(item => item.fieldKey));
      const defaultedMap = new Map((completeness.defaulted || []).map(item => [item.fieldKey, item]));
      requiredFieldTargets.forEach((target, key) => {
        const isMissing = missingKeys.has(key);
        const defaulted = defaultedMap.get(key);
        target.input.classList.toggle("field-missing-required", isMissing);
        target.input.setAttribute("aria-invalid", isMissing ? "true" : "false");
        if (isMissing) {
          target.helper.textContent = requiredHelperText;
          target.helper.classList.add("is-missing");
          target.helper.classList.remove("is-defaulted");
          target.helper.hidden = false;
          return;
        }
        if (defaulted) {
          target.helper.textContent = formatDefaultHelperText(defaulted);
          target.helper.classList.add("is-defaulted");
          target.helper.classList.remove("is-missing");
          target.helper.hidden = false;
          return;
        }
        target.helper.textContent = "";
        target.helper.classList.remove("is-missing", "is-defaulted");
        target.helper.hidden = true;
      });
      const suggestedKeys = new Set((completeness.suggestedMissing || []).map(item => item.fieldKey));
      suggestedFieldTargets.forEach((target, key) => {
        const isMissing = suggestedKeys.has(key);
        target.helper.hidden = !isMissing;
      });
    }

    function updateCompletenessUI() {
      latestCompleteness = computeCompletenessFromInputs();
      updateCompletenessHighlights(latestCompleteness);
      updateCompletenessSummary(latestCompleteness);
      updateSaveState();
    }

    function syncDraftFromInputs() {
      const nextDraft = buildPayload();
      draftForm.setDraft(nextDraft);
      updateCompletenessUI();
    }

    form.addEventListener("submit", async ev => {
      ev.preventDefault();
      if (!validateAll()) {
        updateSaveState();
        return;
      }
      const completeness = computeCompletenessFromInputs();
      if (completeness.status === "blocked") {
        updateCompletenessHighlights(completeness);
        updateCompletenessSummary(completeness);
        showToast("Bitte Pflichtfelder ergänzen.");
        updateSaveState();
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = "Speichern…";
      let payload;
      try {
        payload = buildPayload({ strictMilestones: true });
      } catch (err) {
        alert(err.message || String(err));
        saveBtn.textContent = "Speichern";
        updateSaveState();
        return;
      }
      try {
        await draftForm.commit(() => upsertProduct(payload));
        dialog.overlay.remove();
        renderProducts(root);
      } catch (err) {
        alert(err.message || String(err));
        saveBtn.textContent = "Speichern";
        updateSaveState();
      }
    });

    form.addEventListener("input", syncDraftFromInputs);
    form.addEventListener("change", syncDraftFromInputs);
  }

  function renderList(list) {
    if (!list.length) {
      return createEl("p", { class: "empty-state" }, ["Keine Produkte gefunden. Lege ein Produkt an oder erfasse eine PO."]);
    }
    const collapseState = loadCollapseState();
    const groups = buildCategoryGroups(list);
    const rows = [];
    groups.forEach((group) => {
      const isCollapsed = Boolean(collapseState[group.id]);
      rows.push({
        id: `group-${group.id}`,
        isGroup: true,
        categoryId: group.id,
        categoryName: group.name,
        count: group.items.length,
        collapsed: isCollapsed,
      });
      if (isCollapsed) return;
      group.items.forEach((product) => {
        rows.push({
          id: `product-${product.sku}`,
          isGroup: false,
          product,
        });
      });
    });

    const columns = [
      {
        key: "alias",
        title: "Alias",
        dataIndex: "alias",
        width: 230,
        fixed: "left",
        onCell: (record) => {
          if (!record.isGroup) return {};
          return { colSpan: 14 };
        },
        render: (_, record) => {
          if (record.isGroup) {
            return h("button", {
              className: "product-group-toggle",
              type: "button",
              "aria-expanded": String(!record.collapsed),
              onClick: () => {
                const next = loadCollapseState();
                next[record.categoryId] = !record.collapsed;
                saveCollapseState(next);
                render();
              },
            }, `${record.categoryName} (${record.count})`);
          }
          const product = record.product;
          const aliasText = product.alias || "—";
          return h("div", { className: "data-health-inline" }, [
            renderHealthDotReact(product.sku),
            h("span", { className: "truncate-text" }, aliasText),
            product.status === "inactive" ? h("span", { className: "badge muted" }, "inaktiv") : null,
          ]);
        },
      },
      {
        key: "sku",
        title: "SKU",
        dataIndex: "sku",
        width: 130,
        onCell: (record) => (record.isGroup ? { colSpan: 0 } : {}),
        render: (_, record) => (record.isGroup ? null : (record.product.sku || "—")),
      },
      {
        key: "supplier",
        title: "Supplier",
        dataIndex: "supplier",
        width: 180,
        onCell: (record) => (record.isGroup ? { colSpan: 0 } : {}),
        render: (_, record) => {
          if (record.isGroup) return null;
          const product = record.product;
          return supplierLabelMap.get(product.supplierId) || product.supplierId || "—";
        },
      },
      {
        key: "category",
        title: "Kategorie",
        dataIndex: "category",
        width: 150,
        onCell: (record) => (record.isGroup ? { colSpan: 0 } : {}),
        render: (_, record) => (record.isGroup ? null : getCategoryLabel(record.product.categoryId)),
      },
      {
        key: "status",
        title: "Status",
        dataIndex: "status",
        width: 100,
        onCell: (record) => (record.isGroup ? { colSpan: 0 } : {}),
        render: (_, record) => {
          if (record.isGroup) return null;
          return record.product.status === "inactive"
            ? h("span", { className: "badge muted" }, "inaktiv")
            : h("span", { className: "badge" }, "aktiv");
        },
      },
      {
        key: "abcClass",
        title: "ABC",
        dataIndex: "abcClass",
        width: 70,
        onCell: (record) => (record.isGroup ? { colSpan: 0 } : {}),
        render: (_, record) => {
          if (record.isGroup) return null;
          const abcLabel = formatAbcDisplay(record.product.abcClass);
          return h("span", { className: abcLabel === "—" ? "badge muted" : "badge" }, abcLabel);
        },
      },
      {
        key: "completeness",
        title: "Vollständigkeit",
        dataIndex: "completeness",
        width: 130,
        onCell: (record) => (record.isGroup ? { colSpan: 0 } : {}),
        render: (_, record) => (record.isGroup ? null : renderCompletenessBadgeReact(record.product)),
      },
      {
        key: "moqUnits",
        title: "MOQ",
        tooltip: "Minimum Order Quantity",
        dataIndex: "moqUnits",
        width: 90,
        numeric: true,
        onCell: (record) => (record.isGroup ? { colSpan: 0 } : {}),
        render: (_, record) => {
          if (record.isGroup) return null;
          const val = getEffectiveMoqUnits(record.product);
          return Number.isFinite(val) ? Number(val).toLocaleString("de-DE") : "—";
        },
      },
      {
        key: "lastPo",
        title: "Letzte PO",
        dataIndex: "lastPo",
        width: 110,
        onCell: (record) => (record.isGroup ? { colSpan: 0 } : {}),
        render: (_, record) => (record.isGroup ? null : (record.product.stats?.lastOrderDate ? fmtDate(record.product.stats.lastOrderDate) : "—")),
      },
      {
        key: "avg",
        title: "Ø Stückpreis",
        dataIndex: "avg",
        width: 120,
        numeric: true,
        onCell: (record) => (record.isGroup ? { colSpan: 0 } : {}),
        render: (_, record) => (record.isGroup ? null : (record.product.stats?.avgUnitPriceUsd != null ? fmtUSD(record.product.stats.avgUnitPriceUsd) : "—")),
      },
      {
        key: "count",
        title: "POs",
        dataIndex: "count",
        width: 80,
        numeric: true,
        onCell: (record) => (record.isGroup ? { colSpan: 0 } : {}),
        render: (_, record) => (record.isGroup ? null : String(record.product.stats?.poCount ?? 0)),
      },
      {
        key: "template",
        title: "Template",
        dataIndex: "template",
        width: 100,
        onCell: (record) => (record.isGroup ? { colSpan: 0 } : {}),
        render: (_, record) => {
          if (record.isGroup) return null;
          return record.product.template ? h("span", { className: "badge" }, "vorhanden") : h("span", { className: "badge muted" }, "—");
        },
      },
      {
        key: "actions",
        title: "Aktionen",
        dataIndex: "actions",
        width: 170,
        fixed: "right",
        ellipsis: false,
        onCell: (record) => (record.isGroup ? { colSpan: 0 } : {}),
        render: (_, record) => {
          if (record.isGroup) return null;
          const product = record.product;
          return h("div", { className: "table-actions" }, [
            h("button", { className: "btn secondary sm", type: "button", onClick: () => showEditor(product) }, "Bearbeiten"),
            h("button", {
              className: "btn ghost sm",
              type: "button",
              "aria-haspopup": "menu",
              "aria-expanded": "false",
              onClick: (event) => {
                event.stopPropagation();
                openActionsMenu(event.currentTarget, product);
              },
            }, "Mehr…"),
          ]);
        },
      },
    ];

    const wrapper = createEl("div", { class: "table-wrap products-list products-list-antd" });
    const topScrollControl = createEl("div", { class: "ui-scrollbar-custom ui-scrollbar-custom-top products-custom-scroll", "aria-hidden": "true" }, [
      createEl("div", { class: "ui-scrollbar-custom-rail" }, [
        createEl("button", { class: "ui-scrollbar-custom-thumb", type: "button", tabindex: "-1" }),
      ]),
    ]);
    const mountPoint = createEl("div", { class: "products-list-react-mount" });
    const bottomScrollControl = createEl("div", { class: "ui-scrollbar-custom ui-scrollbar-custom-bottom products-custom-scroll", "aria-hidden": "true" }, [
      createEl("div", { class: "ui-scrollbar-custom-rail" }, [
        createEl("button", { class: "ui-scrollbar-custom-thumb", type: "button", tabindex: "-1" }),
      ]),
    ]);
    wrapper.append(topScrollControl, mountPoint, bottomScrollControl);
    root.__productsListReactRoot = createRoot(mountPoint);
    root.__productsListReactRoot.render(
      h(AppDataTable, {
        className: "products-list-table-antd",
        columns,
        dataSource: rows,
        rowKey: "id",
        rowClassName: (record) => (record.isGroup ? "product-group-row" : "product-product-row"),
      })
    );
    requestAnimationFrame(() => {
      const cleanupExisting = root.__productsListScrollCleanup;
      if (typeof cleanupExisting === "function") cleanupExisting();
      const scrollCandidates = Array.from(
        mountPoint.querySelectorAll(".ant-table-content, .ant-table-body")
      );
      const scrollContent = scrollCandidates.find(
        (node) => node && (node.scrollWidth - node.clientWidth) > 0
      ) || scrollCandidates[0] || null;
      const table = mountPoint.querySelector(".ant-table-content table, .ant-table-body table");
      const topRail = topScrollControl.querySelector(".ui-scrollbar-custom-rail");
      const topThumb = topScrollControl.querySelector(".ui-scrollbar-custom-thumb");
      const bottomRail = bottomScrollControl.querySelector(".ui-scrollbar-custom-rail");
      const bottomThumb = bottomScrollControl.querySelector(".ui-scrollbar-custom-thumb");
      if (!scrollContent || !table || !topRail || !topThumb || !bottomRail || !bottomThumb) return;
      const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
      const MIN_THUMB_PX = 48;
      const state = {
        max: 0,
        top: { span: 1, thumb: 1, left: 0 },
        bottom: { span: 1, thumb: 1, left: 0 },
      };
      let syncing = false;
      const metricsFor = (rail) => {
        const max = Math.max(0, Math.ceil(scrollContent.scrollWidth - scrollContent.clientWidth));
        const track = Math.max(1, Math.floor(rail.clientWidth || 1));
        const ratio = scrollContent.clientWidth / Math.max(scrollContent.scrollWidth, 1);
        const thumb = max <= 0
          ? track
          : Math.min(track, Math.max(MIN_THUMB_PX, Math.round(track * ratio)));
        const span = Math.max(1, track - thumb);
        return { max, thumb, span };
      };
      const applyThumb = (thumb, left, width) => {
        thumb.style.width = `${Math.max(1, Math.round(width))}px`;
        thumb.style.transform = `translateX(${Math.round(left)}px)`;
        thumb.dataset.left = String(left);
      };
      const updateRanges = () => {
        const max = Math.max(0, Math.ceil(scrollContent.scrollWidth - scrollContent.clientWidth));
        state.max = max;
        const topMetrics = metricsFor(topRail);
        const bottomMetrics = metricsFor(bottomRail);
        state.top.span = topMetrics.span;
        state.top.thumb = topMetrics.thumb;
        state.bottom.span = bottomMetrics.span;
        state.bottom.thumb = bottomMetrics.thumb;
        const current = clamp(Math.round(scrollContent.scrollLeft), 0, max);
        const topLeft = max <= 0 ? 0 : (current / max) * topMetrics.span;
        const bottomLeft = max <= 0 ? 0 : (current / max) * bottomMetrics.span;
        state.top.left = topLeft;
        state.bottom.left = bottomLeft;
        applyThumb(topThumb, topLeft, topMetrics.thumb);
        applyThumb(bottomThumb, bottomLeft, bottomMetrics.thumb);
        topScrollControl.classList.toggle("is-overflow", max > 0);
        bottomScrollControl.classList.toggle("is-overflow", max > 0);
      };
      const scrollFromRail = (left, key) => {
        if (syncing) return;
        const meta = key === "top" ? state.top : state.bottom;
        if (state.max <= 0) return;
        const nextLeft = clamp(left, 0, meta.span);
        const ratio = meta.span <= 0 ? 0 : (nextLeft / meta.span);
        syncing = true;
        scrollContent.scrollLeft = ratio * state.max;
        syncing = false;
      };
      const bindRailDrag = (key, rail, thumb) => {
        let dragging = false;
        let startX = 0;
        let startLeft = 0;
        const onMove = (event) => {
          if (!dragging) return;
          event.preventDefault();
          const delta = event.clientX - startX;
          scrollFromRail(startLeft + delta, key);
        };
        const onEnd = () => {
          if (!dragging) return;
          dragging = false;
          thumb.classList.remove("is-dragging");
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onEnd);
          window.removeEventListener("pointercancel", onEnd);
        };
        const onThumbDown = (event) => {
          if (state.max <= 0) return;
          event.preventDefault();
          dragging = true;
          thumb.classList.add("is-dragging");
          startX = event.clientX;
          startLeft = Number(thumb.dataset.left || 0);
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onEnd);
          window.addEventListener("pointercancel", onEnd);
        };
        const onRailDown = (event) => {
          if (state.max <= 0) return;
          if (event.target === thumb) return;
          const rect = rail.getBoundingClientRect();
          const meta = key === "top" ? state.top : state.bottom;
          const clickLeft = event.clientX - rect.left - (meta.thumb / 2);
          scrollFromRail(clickLeft, key);
        };
        thumb.addEventListener("pointerdown", onThumbDown);
        rail.addEventListener("pointerdown", onRailDown);
        return () => {
          onEnd();
          thumb.removeEventListener("pointerdown", onThumbDown);
          rail.removeEventListener("pointerdown", onRailDown);
        };
      };
      const cleanupTopRail = bindRailDrag("top", topRail, topThumb);
      const cleanupBottomRail = bindRailDrag("bottom", bottomRail, bottomThumb);
      const syncFromTable = () => {
        if (syncing) return;
        updateRanges();
      };
      scrollContent.classList.add("ui-scrollbar-managed");
      updateRanges();
      scrollContent.addEventListener("scroll", syncFromTable, { passive: true });
      window.addEventListener("resize", updateRanges);
      const resizeObserver = typeof ResizeObserver === "function"
        ? new ResizeObserver(() => updateRanges())
        : null;
      if (resizeObserver) {
        resizeObserver.observe(scrollContent);
        resizeObserver.observe(table);
      }
      root.__productsListScrollCleanup = () => {
        cleanupTopRail();
        cleanupBottomRail();
        scrollContent.removeEventListener("scroll", syncFromTable);
        window.removeEventListener("resize", updateRanges);
        scrollContent.classList.remove("ui-scrollbar-managed");
        if (resizeObserver) resizeObserver.disconnect();
      };
    });
    return wrapper;
  }

  function initColumnResizing(table, { key, colgroup = null, widths = [] } = {}) {
    if (!table) return;
    const headerRow = table.querySelector("thead tr:last-child");
    if (!headerRow) return;
    const headers = Array.from(headerRow.querySelectorAll("th"));
    if (!headers.length) return;
    table.style.tableLayout = "fixed";

    headers.forEach((th, index) => {
      if (th.querySelector(".col-resizer")) return;
      const resizer = createEl("span", { class: "col-resizer", "aria-hidden": "true" });
      th.append(resizer);
      th.dataset.colIndex = String(index);
    });

    const cols = colgroup ? Array.from(colgroup.children) : null;
    headers.forEach((th, index) => {
      const stored = widths[index];
      if (Number.isFinite(stored)) {
        th.style.width = `${stored}px`;
        if (cols && cols[index]) cols[index].style.width = `${stored}px`;
        return;
      }
      const width = th.getBoundingClientRect().width;
      if (width) {
        th.style.width = `${width}px`;
        if (cols && cols[index]) cols[index].style.width = `${width}px`;
      }
    });

    let active = null;

    function onPointerMove(event) {
      if (!active) return;
      const delta = event.clientX - active.startX;
      const next = Math.max(active.minWidth, active.startWidth + delta);
      active.th.style.width = `${next}px`;
      if (active.col) active.col.style.width = `${next}px`;
    }

    function stopResize() {
      if (!active) return;
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", stopResize);
      const nextWidths = headers.map((th, index) => {
        if (cols && cols[index]) {
          return cols[index].getBoundingClientRect().width;
        }
        return th.getBoundingClientRect().width;
      });
      if (key) setProductsTableColumns(key, nextWidths);
      active = null;
      table.classList.remove("is-resizing");
    }

    table.addEventListener("pointerdown", event => {
      const handle = event.target.closest(".col-resizer");
      if (!handle) return;
      const th = handle.closest("th");
      if (!th) return;
      event.preventDefault();
      const index = Number(th.dataset.colIndex);
      const col = cols && Number.isFinite(index) ? cols[index] : null;
      const startWidth = th.getBoundingClientRect().width;
      active = {
        th,
        col,
        startX: event.clientX,
        startWidth,
        minWidth: 80,
      };
      table.classList.add("is-resizing");
      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", stopResize);
    });
  }

  function renderGrid(list) {
    if (!list.length) {
      return createEl("p", { class: "empty-state" }, ["Keine Produkte gefunden. Lege ein Produkt an oder erfasse eine PO."]);
    }
    const settings = state.settings || {};
    const fxRateDefault = parseDeNumber(settings.fxRate) ?? null;
    const templateDefaults = {
      unitPriceUsd: 0,
      extraPerUnitUsd: 0,
      extraFlatUsd: 0,
      transportMode: "SEA",
      productionDays: 0,
      transitDays: 0,
      freightEur: 0,
      dutyPct: 0,
      dutyIncludesFreight: false,
      vatImportPct: 19,
      vatRefundActive: false,
      vatRefundLag: 0,
      fxRate: fxRateDefault ?? 0,
      fxFeePct: 0,
      ddp: settings.defaultDdp === true,
      currency: settings.defaultCurrency || "EUR",
    };

    const suppliers = Array.isArray(state.suppliers) ? state.suppliers : [];
    const supplierOptions = suppliers.map(supplier => ({
      value: String(supplier.id || "").trim(),
      label: supplierLabelMap.get(supplier.id) || supplier.name || supplier.id || "—",
    })).filter(option => option.value);
    const categoryOptions = categories.map(category => ({
      value: String(category.id),
      label: category.name || "Ohne Kategorie",
    }));

    const fields = [
      { key: "alias", label: "Alias", type: "text", width: "240px", className: "col-alias" },
      { key: "sku", label: "SKU", type: "text", width: "160px", readOnly: true, className: "col-sku" },
      { key: "supplierId", label: "Supplier", type: "select", options: supplierOptions, width: "180px", className: "col-supplier" },
      { key: "categoryId", label: "Kategorie", type: "select", options: [{ value: "", label: "Ohne Kategorie" }, ...categoryOptions], width: "180px", className: "col-category" },
      { key: "status", label: "Status", type: "select", options: [
        { value: "active", label: "Aktiv" },
        { value: "inactive", label: "Inaktiv" },
      ], width: "110px", className: "col-status" },
      { key: "abcClass", label: "ABC", type: "display", width: "80px", className: "col-abc" },
      { key: "completeness", label: "Vollständigkeit", type: "display", width: "160px", className: "col-completeness" },
      { key: "avgSellingPriceGrossEUR", label: "Ø VK-Preis (Brutto)", type: "number", decimals: 2, width: "150px", className: "col-amount" },
      { key: "sellerboardMarginPct", label: "Sellerboard Marge (%)", type: "number", decimals: 2, width: "140px", className: "col-short" },
      { key: "productionLeadTimeDaysDefault", label: "Default Production Lead Time (Fallback)", type: "number", decimals: 0, width: "170px", className: "col-days" },
      { key: "moqUnits", label: "MOQ (Einheiten)", type: "number", decimals: 0, width: "120px", className: "col-short col-group-end" },
      { key: "template.unitPriceUsd", label: "Stückpreis (USD)", type: "number", decimals: 2, width: "140px", className: "col-amount" },
      { key: "template.extraPerUnitUsd", label: "Zusatz je Stück (USD)", type: "number", decimals: 2, width: "140px", className: "col-amount" },
      { key: "template.extraFlatUsd", label: "Zusatz pauschal (USD)", type: "number", decimals: 2, width: "140px", className: "col-amount col-group-end" },
      { key: "template.transportMode", label: "Transport", type: "select", options: [
        { value: "SEA", label: "SEA" },
        { value: "RAIL", label: "RAIL" },
        { value: "AIR", label: "AIR" },
      ], width: "130px", className: "col-transport" },
      { key: "template.productionDays", label: "Produktionstage", type: "number", decimals: 0, width: "120px", className: "col-days" },
      { key: "template.transitDays", label: "Transit-Tage", type: "number", decimals: 0, width: "120px", className: "col-days col-group-end" },
      { key: "template.freightEur", label: "Logistik / Stk. (EUR)", type: "number", decimals: 2, width: "140px", className: "col-amount" },
      { key: "template.dutyPct", label: "Zoll %", type: "number", decimals: 2, width: "90px", className: "col-short" },
      { key: "template.dutyIncludesFreight", label: "Fracht einbeziehen", type: "checkbox", width: "56px", className: "col-check" },
      { key: "template.vatImportPct", label: "EUSt %", type: "number", decimals: 2, width: "90px", className: "col-short" },
      { key: "template.vatRefundActive", label: "EUSt-Erstattung aktiv", type: "checkbox", width: "56px", className: "col-check" },
      { key: "template.vatRefundLag", label: "EUSt-Lag", type: "number", decimals: 0, width: "80px", className: "col-short col-group-end" },
      { key: "template.fxRate", label: "FX-Kurs", type: "number", decimals: 4, width: "140px", className: "col-amount" },
      { key: "template.fxFeePct", label: "FX-Gebühr %", type: "number", decimals: 2, width: "90px", className: "col-short col-group-end" },
      { key: "template.currency", label: "Currency", type: "select", options: [
        { value: "USD", label: "USD" },
        { value: "EUR", label: "EUR" },
        { value: "CNY", label: "CNY" },
      ], width: "110px", className: "col-currency" },
      { key: "template.ddp", label: "DDP", type: "checkbox", width: "56px", className: "col-check col-group-end" },
    ];

    function getTemplateFields(product) {
      const base = product.template?.fields || product.template || {};
      return { ...templateDefaults, ...base };
    }

    function getFieldValue(product, field) {
      if (field.key.startsWith("template.")) {
        const key = field.key.replace("template.", "");
        return getTemplateFields(product)[key];
      }
      if (field.key === "categoryId") {
        return product.categoryId || "";
      }
      if (field.key === "abcClass") {
        return formatAbcDisplay(product.abcClass);
      }
      if (field.key === "completeness") {
        return getCompleteness(product);
      }
      if (field.key === "moqUnits") {
        const effective = getEffectiveMoqUnits(product);
        return effective != null ? effective : "";
      }
      return product[field.key] ?? "";
    }

    function formatValue(value, field) {
      if (field.type === "number") {
        const parsed = parseDeNumber(value);
        return parsed == null ? "" : formatInputNumber(parsed, field.decimals ?? 2);
      }
      if (field.type === "display") {
        return value;
      }
      if (field.type === "checkbox") {
        return Boolean(value);
      }
      return value ?? "";
    }

    function normalizeValue(raw, field) {
      if (field.type === "number") {
        return parseDeNumber(raw);
      }
      if (field.type === "display") {
        return raw;
      }
      if (field.type === "checkbox") {
        return Boolean(raw);
      }
      return String(raw ?? "").trim();
    }

    function getEditBucket(sku) {
      if (!pendingEdits[sku]) {
        pendingEdits[sku] = {};
      }
      return pendingEdits[sku];
    }

    function clearEdit(sku, fieldKey) {
      const bucket = pendingEdits[sku];
      if (!bucket) return;
      delete bucket[fieldKey];
      if (!Object.keys(bucket).length) {
        delete pendingEdits[sku];
      }
    }

    function countEdits() {
      return Object.values(pendingEdits)
        .reduce((total, bucket) => total + Object.keys(bucket || {}).length, 0);
    }

    const toolbar = createEl("div", { class: "products-grid-toolbar" });
    const sortSelect = createEl("select", {
      onchange: event => {
        tableSortMode = event.target.value;
        setViewState(tableSortViewKey, { mode: tableSortMode });
        render();
      },
    }, [
      createEl("option", { value: "category" }, ["Sortierung: Kategorie"]),
      createEl("option", { value: "abc" }, ["Sortierung: ABC (A → C)"]),
    ]);
    sortSelect.value = tableSortMode;
    const counter = createEl("span", { class: "muted" }, ["0 Änderungen"]);
    const saveBtn = createEl("button", { class: "btn", type: "button", disabled: true }, ["Änderungen speichern"]);
    const discardBtn = createEl("button", { class: "btn secondary", type: "button", disabled: true }, ["Änderungen verwerfen"]);
    toolbar.append(sortSelect, counter, createEl("div", { class: "products-grid-actions" }, [discardBtn, saveBtn]));

    function updateToolbar() {
      const edits = countEdits();
      counter.textContent = `${edits} Änderungen`;
      saveBtn.disabled = edits === 0;
      discardBtn.disabled = edits === 0;
    }

    function updateRowDirty(row) {
      const hasDirty = Boolean(row.querySelector("td.is-dirty"));
      row.classList.toggle("is-dirty", hasDirty);
    }

    function applyChange(input, product, field) {
      const raw = field.type === "checkbox" ? input.checked : input.value;
      if (field.type === "select") {
        input.title = input.options[input.selectedIndex]?.textContent || String(raw ?? "");
      }
      const normalized = normalizeValue(raw, field);
      const original = normalizeValue(getFieldValue(product, field), field);
      const isDirty = field.type === "number"
        ? Number(normalized) !== Number(original)
        : normalized !== original;
      if (isDirty) {
        const bucket = getEditBucket(product.sku);
        bucket[field.key] = normalized;
      } else {
        clearEdit(product.sku, field.key);
      }
      const cell = input.closest("td");
      if (cell) {
        cell.classList.toggle("is-dirty", isDirty);
        const row = cell.closest("tr");
        if (row) updateRowDirty(row);
      }
      updateToolbar();
      bulkDraft.setDraft(bulkDraft.draft);
    }

    const wrapper = createEl("div", { class: "products-grid" });
    const scroll = createEl("div", { class: "products-grid-scroll" });
    const table = createEl("table", { class: "products-grid-table", "data-ui-table": "true", "data-sticky-cols": "1" });
    const colgroup = createEl("colgroup");
    const gridWidths = state?.settings?.productsTableColumns?.grid || [];
    fields.forEach((field, index) => {
      const width = Number.isFinite(gridWidths[index]) ? `${gridWidths[index]}px` : field.width;
      colgroup.append(createEl("col", { style: width ? `width:${width}` : null }));
    });
    const actionsWidth = Number.isFinite(gridWidths[fields.length]) ? `${gridWidths[fields.length]}px` : "180px";
    colgroup.append(createEl("col", { style: `width:${actionsWidth}` }));
    const thead = createEl("thead", {}, [
      createEl("tr", { class: "products-grid-group-header" }, [
        createEl("th", { colspan: "10", title: "Stammdaten" }, ["Stammdaten"]),
        createEl("th", { colspan: "3", title: "Kosten" }, ["Kosten"]),
        createEl("th", { colspan: "4", title: "Logistik" }, ["Logistik"]),
        createEl("th", { colspan: "5", title: "Steuern" }, ["Steuern"]),
        createEl("th", { colspan: "3", title: "FX & Währung" }, ["FX & Währung"]),
        createEl("th", { colspan: "1", title: "Sonstiges" }, ["Sonstiges"]),
        createEl("th", { colspan: "1", title: "Tags" }, ["Tags"]),
        createEl("th", { colspan: "1", class: "actions", title: "Aktionen" }, ["Aktionen"]),
      ]),
      createEl("tr", {}, [
        ...fields.map(field => createEl("th", { class: field.className || "", title: field.label }, [field.label])),
        createEl("th", { class: "actions", title: "Aktionen" }, ["Aktionen"]),
      ]),
    ]);
    const tbody = createEl("tbody");
    const collapseState = loadCollapseState();
    const groups = buildCategoryGroups(list, { sortMode: tableSortMode });

    groups.forEach(group => {
      const isCollapsed = Boolean(collapseState[group.id]);
      tbody.append(createEl("tr", { class: "product-group-row" }, [
        createEl("td", { colspan: String(fields.length + 1) }, [
          createEl("button", {
            class: "product-group-toggle",
            type: "button",
            dataset: { categoryId: group.id },
            "aria-expanded": String(!isCollapsed),
          }, [`${group.name} (${group.items.length})`]),
        ]),
      ]));
      if (isCollapsed) return;
      group.items.forEach(product => {
        const row = createEl("tr");
        fields.forEach(field => {
          const cell = createEl("td", { class: field.className || "" });
          const value = pendingEdits[product.sku]?.[field.key] ?? getFieldValue(product, field);
          if (field.type === "display") {
            cell.append(renderCompletenessBadge(product));
          } else if (field.type === "checkbox") {
            const input = createEl("input", {
              type: "checkbox",
              checked: Boolean(value),
              onchange: () => applyChange(input, product, field),
              title: field.label,
            });
            cell.append(input);
          } else if (field.type === "select") {
            const select = createEl("select", { onchange: () => applyChange(select, product, field) });
            const options = field.options || [];
            const currentValue = String(value ?? "");
            if (["supplierId", "status", "categoryId", "template.transportMode", "template.currency"].includes(field.key)) {
              select.title = currentValue;
            }
            if (!options.some(option => option.value === currentValue) && currentValue) {
              select.append(createEl("option", { value: currentValue }, [currentValue]));
            }
          options.forEach(option => {
            select.append(createEl("option", { value: option.value }, [option.label]));
          });
          select.value = currentValue;
          select.title = select.options[select.selectedIndex]?.textContent || currentValue;
          cell.append(select);
          } else {
            const input = createEl("input", {
              value: formatValue(value, field),
              inputmode: field.type === "number" ? "decimal" : "text",
              readonly: field.readOnly ? "readonly" : null,
              title: ["alias", "sku", "supplierId"].includes(field.key) ? String(value ?? "") : null,
              oninput: () => applyChange(input, product, field),
              onblur: () => {
                if (field.type === "number") {
                  const parsed = parseDeNumber(input.value);
                  input.value = parsed == null ? "" : formatInputNumber(parsed, field.decimals ?? 2);
                }
              },
            });
            if (field.key === "alias") {
              const dot = buildHealthDot(product.sku);
              if (dot) cell.append(dot);
            }
            cell.append(input);
          }
          if (field.type !== "display") {
            const original = normalizeValue(getFieldValue(product, field), field);
            const current = normalizeValue(value, field);
            const isDirty = field.type === "number"
              ? Number(current) !== Number(original)
              : current !== original;
            if (isDirty) {
              cell.classList.add("is-dirty");
            }
          }
          row.append(cell);
        });
        const actions = createEl("td", { class: "actions" }, [
          createEl("button", { class: "btn secondary", type: "button", onclick: () => showEditor(product) }, ["Bearbeiten"]),
          createEl("button", { class: "btn tertiary", type: "button", onclick: () => showHistory(product) }, ["Historie"]),
        ]);
        row.append(actions);
        updateRowDirty(row);
        tbody.append(row);
      });
    });

    table.append(colgroup, thead, tbody);
    initColumnResizing(table, { key: "grid", colgroup, widths: gridWidths });
    scroll.append(table);
    wrapper.append(toolbar, scroll);
    updateToolbar();

    table.addEventListener("click", (event) => {
      const toggle = event.target.closest(".product-group-toggle");
      if (!toggle) return;
      const next = loadCollapseState();
      const id = toggle.dataset.categoryId;
      next[id] = !next[id];
      saveCollapseState(next);
      render();
    });

    discardBtn.addEventListener("click", () => {
      bulkDraft.resetDraft();
      render();
    });

    saveBtn.addEventListener("click", async () => {
      const editsBySku = Object.entries(pendingEdits);
      if (!editsBySku.length) return;
      const errors = [];
      await Promise.allSettled(editsBySku.map(([sku, edits]) => {
        const original = getProductBySku(sku);
        if (!original) {
          errors.push(sku);
          return Promise.resolve();
        }
        const hasTemplateEdits = Object.keys(edits).some(key => key.startsWith("template."));
        const templateFields = hasTemplateEdits ? getTemplateFields(original) : null;
        const payload = {
          sku: original.sku,
          alias: original.alias,
          supplierId: original.supplierId,
          categoryId: original.categoryId ?? null,
          status: original.status,
          tags: Array.isArray(original.tags) ? [...original.tags] : [],
          template: original.template ? { ...original.template } : null,
          avgSellingPriceGrossEUR: original.avgSellingPriceGrossEUR ?? null,
          sellerboardMarginPct: original.sellerboardMarginPct ?? null,
          originalSku: original.sku,
        };
        Object.entries(edits).forEach(([key, value]) => {
          if (key.startsWith("template.")) {
            const fieldKey = key.replace("template.", "");
            if (!payload.template) {
              payload.template = { scope: "SKU", name: "Standard (SKU)", fields: {} };
            }
            if (!payload.template.fields) {
              payload.template.fields = { ...templateFields };
            }
            payload.template.fields[fieldKey] = value;
          } else if (key === "categoryId") {
            payload.categoryId = value ? String(value) : null;
          } else {
            payload[key] = value;
          }
        });
        if (hasTemplateEdits && payload.template?.fields && templateFields) {
          payload.template.fields = { ...templateFields, ...payload.template.fields };
        }
        try {
          upsertProduct(payload);
        } catch (err) {
          errors.push(sku);
        }
      }));
      if (errors.length) {
        showToast(`Fehler bei SKUs: ${errors.join(", ")}`);
      } else {
        showToast("Änderungen gespeichert");
      }
      bulkDraft.resetDraft();
      render();
    });

    return wrapper;
  }

  function showHistory(product) {
    const state = loadAppState();
    const historyTable = buildHistoryTable(state, product.sku);
    const closeBtn = createEl("button", { class: "btn", type: "button" }, ["Schließen"]);
    const dialog = openModal({
      title: `Historie – ${product.alias || product.sku}`,
      content: historyTable,
      actions: [closeBtn],
      onClose: () => {}
    });
    closeBtn.addEventListener("click", () => dialog.overlay.remove());
  }

  function render() {
    const prevSearch = root.querySelector('input[type="search"]');
    const shouldFocusSearch = document.activeElement === prevSearch;
    const cursorPos = shouldFocusSearch ? prevSearch.selectionStart : null;
    if (typeof root.__productsListScrollCleanup === "function") {
      root.__productsListScrollCleanup();
      root.__productsListScrollCleanup = null;
    }
    if (root.__productsListReactRoot) {
      root.__productsListReactRoot.unmount();
      root.__productsListReactRoot = null;
    }
    root.innerHTML = "";
    const filtered = applyFilter(products, searchTerm, completenessFilter, abcFilter);
    const bannerCount = products.filter(prod => prod.alias.startsWith("Ohne Alias")).length;
    const header = createEl("div", { class: "products-header" });
    const title = createEl("h2", {}, ["Produkte"]);
    const actions = createEl("div", { class: "products-actions" });
    const createBtn = createEl("button", { class: "btn", type: "button", onclick: () => showEditor(null) }, ["+ Produkt anlegen"]);
    const expandBtn = createEl("button", { class: "btn secondary", type: "button", onclick: () => { setAllCategoriesCollapsed(false); render(); } }, ["Alles aufklappen"]);
    const collapseBtn = createEl("button", { class: "btn secondary", type: "button", onclick: () => { setAllCategoriesCollapsed(true); render(); } }, ["Alles zuklappen"]);
    const search = createEl("input", {
      type: "search",
      placeholder: "Suche nach Alias, SKU, Supplier",
      value: searchTerm,
      oninput: ev => {
        searchTerm = ev.target.value;
        render();
      }
    });
    const completenessSelect = createEl("select", {
      class: "products-completeness-filter",
      onchange: event => {
        completenessFilter = event.target.value;
        setViewState(completenessViewKey, { filter: completenessFilter });
        render();
      },
    }, [
      createEl("option", { value: "all" }, ["Alle Vollständigkeiten"]),
      createEl("option", { value: "blocked" }, ["Nur Blockierte"]),
      createEl("option", { value: "warn" }, ["Nur Warnungen"]),
      createEl("option", { value: "ok" }, ["Nur Vollständige"]),
    ]);
    completenessSelect.value = completenessFilter === "warning" ? "warn" : completenessFilter;
    const abcSelect = createEl("select", {
      class: "products-abc-filter",
      onchange: event => {
        abcFilter = event.target.value;
        setViewState(abcFilterViewKey, { filter: abcFilter });
        render();
      },
    }, [
      createEl("option", { value: "all" }, ["ABC: Alle"]),
      ...ABC_CLASSES.map(option => createEl("option", { value: option }, [`ABC: ${option}`])),
    ]);
    abcSelect.value = abcFilter;
    const viewToggle = createEl("div", { class: "view-toggle" }, [
      createEl("button", {
        type: "button",
        class: `btn tertiary${viewMode === "list" ? " is-active" : ""}`,
        "aria-pressed": viewMode === "list",
        onclick: () => {
          viewMode = "list";
          setViewValue("productsView", viewMode);
          render();
        },
      }, ["Liste"]),
      createEl("button", {
        type: "button",
        class: `btn tertiary${viewMode === "table" ? " is-active" : ""}`,
        "aria-pressed": viewMode === "table",
        onclick: () => {
          viewMode = "table";
          setViewValue("productsView", viewMode);
          render();
        },
      }, ["Tabelle"]),
    ]);
    actions.append(search, completenessSelect, abcSelect, expandBtn, collapseBtn, viewToggle, createBtn);
    header.append(title, actions);
    root.append(header);
    if (bannerCount) {
      root.append(createEl("div", { class: "banner info" }, [
        `${bannerCount} Produkte ohne Alias – bitte ergänzen.`,
      ]));
    }
    root.append(viewMode === "table" ? renderGrid(filtered) : renderList(filtered));
    if (shouldFocusSearch) {
      search.focus();
      if (cursorPos != null) {
        search.setSelectionRange(cursorPos, cursorPos);
      }
    }
  }

  render();
}

export default function mountProducts(root) {
  const handler = () => renderProducts(root);
  if (root.__productsCleanup) {
    root.__productsCleanup();
  }
  document.addEventListener("state:changed", handler);
  root.__productsCleanup = () => {
    if (typeof root.__productsListScrollCleanup === "function") {
      root.__productsListScrollCleanup();
      root.__productsListScrollCleanup = null;
    }
    if (root.__productsListReactRoot) {
      root.__productsListReactRoot.unmount();
      root.__productsListReactRoot = null;
    }
    document.removeEventListener("state:changed", handler);
    if (root.__productsActionsCleanup) {
      root.__productsActionsCleanup();
      root.__productsActionsCleanup = null;
    }
    if (root.__productsBulkGuard) {
      root.__productsBulkGuard.unregister();
      root.__productsBulkGuard.detachBeforeUnload();
      root.__productsBulkGuard = null;
    }
  };
  renderProducts(root);
  return { cleanup: root.__productsCleanup };
}
