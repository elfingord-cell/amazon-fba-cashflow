import {
  getProductsSnapshot,
  getProductBySku,
  upsertProduct,
  deleteProductBySku,
  setProductStatus,
  setProductsTableColumns,
} from "../data/storageLocal.js";
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
  const table = createEl("table", { class: "table" });
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
  const products = getProductsSnapshot();
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
      return { status: "blocked", missingRequired: ["SKU"], missingWarnings: [], resolvedUsingDefaults: [] };
    }
    if (!completenessBySku.has(product.sku)) {
      completenessBySku.set(product.sku, evaluateProductCompleteness(product, completenessContext));
    }
    return completenessBySku.get(product.sku);
  }

  function applyFilter(list, term, statusFilter) {
    const filteredBySearch = !term ? list : list.filter(item => {
      const needle = term.trim().toLowerCase();
      const categoryName = getCategoryLabel(item.categoryId);
      const supplierLabel = supplierLabelMap.get(item.supplierId);
      return [item.alias, item.sku, item.supplierId, supplierLabel, categoryName, ...(item.tags || [])]
        .filter(Boolean)
        .some(val => String(val).toLowerCase().includes(needle));
    });
    if (!statusFilter || statusFilter === "all") return filteredBySearch;
    return filteredBySearch.filter(item => getCompleteness(item).status === statusFilter);
  }

  function formatCompletenessLabel(status) {
    if (status === "ready") return "✅ Ready";
    if (status === "warning") return "⚠️ Unvollständig";
    return "❌ Blockiert";
  }

  function buildCompletenessTooltip(completeness) {
    const lines = [];
    if (completeness.missingRequired?.length) {
      lines.push(`Pflichtfelder fehlen: ${completeness.missingRequired.join(", ")}`);
    }
    if (completeness.missingWarnings?.length) {
      lines.push(`Warnungen: ${completeness.missingWarnings.join(", ")}`);
    }
    if (completeness.resolvedUsingDefaults?.length) {
      lines.push(`Defaults genutzt: ${completeness.resolvedUsingDefaults.join(", ")}`);
    }
    if (!lines.length) {
      lines.push("Alle Pflichtfelder vorhanden.");
    }
    return lines.map(line => createEl("div", {}, [line]));
  }

  function renderCompletenessBadge(product) {
    const completeness = getCompleteness(product);
    const status = completeness.status || "blocked";
    const label = formatCompletenessLabel(status);
    return createEl("span", { class: "tooltip" }, [
      createEl("button", {
        class: `tooltip-trigger completeness-badge ${status}`,
        type: "button",
        "aria-label": label,
      }, [label]),
      createEl("span", { class: "tooltip-content" }, buildCompletenessTooltip(completeness)),
    ]);
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

  function buildCategoryGroups(list) {
    const categoryMap = new Map();
    list.forEach(product => {
      const key = product.categoryId ? String(product.categoryId) : "";
      if (!categoryMap.has(key)) categoryMap.set(key, []);
      categoryMap.get(key).push(product);
    });
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

  function showEditor(existing) {
    const state = loadAppState();
    let product = existing ? { ...existing } : { sku: "", alias: "", supplierId: "", status: "active", tags: [], template: null };
    const draftForm = useDraftForm(product, { key: product.sku ? `product:${product.sku}` : "product:new", enableDraftCache: true });
    product = draftForm.draft;
    const dirtyGuard = useDirtyGuard(() => draftForm.isDirty, "Ungespeicherte Änderungen verwerfen?");
    const form = createEl("form", { class: "form" });

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
    const categorySelect = (() => {
      const select = createEl("select");
      select.append(createEl("option", { value: "" }, ["Ohne Kategorie"]));
      categories.forEach(category => {
        select.append(createEl("option", { value: category.id }, [category.name]));
      });
      select.value = product.categoryId || "";
      return select;
    })();
    const tagsInput = createEl("input", { value: (product.tags || []).join(", ") });
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

    form.append(
      createEl("label", {}, ["SKU", skuInput]),
      createEl("label", {}, ["Alias", aliasInput]),
      createEl("label", {}, ["Supplier", supplierInput]),
      createEl("label", {}, ["Kategorie", categorySelect]),
      createEl("label", {}, ["Status", statusSelect]),
      createEl("label", {}, ["Tags (Komma-getrennt)", tagsInput]),
      createEl("label", {}, ["Ø VK-Preis (Brutto)", avgSellingPriceInput]),
      createEl("label", {}, ["Sellerboard Marge (%)", sellerboardMarginInput]),
      createEl("label", {}, ["Default Production Lead Time (Fallback)", productionLeadTimeInput]),
      createEl("label", {}, ["MOQ (Einheiten)", moqInput]),
      createEl("hr"),
      createEl("h4", {}, ["Inventory Planning Overrides"]),
      createEl("label", {}, [
        "Safety Stock DOH Override (optional)",
        safetyStockOverrideInput,
        createEl("small", { class: "muted", id: "safety-stock-effective" }, []),
      ]),
      createEl("label", {}, [
        "FO Coverage DOH Override (optional)",
        foCoverageOverrideInput,
        createEl("small", { class: "muted", id: "fo-coverage-effective" }, []),
      ]),
      createEl("label", {}, [
        "MOQ Override (optional)",
        moqOverrideInput,
        createEl("small", { class: "muted", id: "moq-effective" }, []),
      ]),
      createEl("label", {}, [
        "Einstandspreis (EUR)",
        landedUnitCostInput,
        createEl("small", { class: "muted", id: "shipping-derived" }, []),
      ]),
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
      saveBtn.disabled = !valid || !draftForm.isDirty;
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
      tagsInput.value = (draft.tags || []).join(", ");
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
      updateSaveState();
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
    Object.keys(fieldRules).forEach(key => validateField(key));
    updateSaveState();
    updateEffectiveValues();

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
        tags: tagsInput.value
          .split(",")
          .map(tag => tag.trim())
          .filter(Boolean),
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

    function syncDraftFromInputs() {
      const nextDraft = buildPayload();
      draftForm.setDraft(nextDraft);
      updateSaveState();
    }

    form.addEventListener("submit", async ev => {
      ev.preventDefault();
      if (!validateAll()) {
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
    const columns = [
      { key: "alias", label: "Alias", className: "cell-ellipsis col-alias" },
      { key: "sku", label: "SKU", className: "cell-ellipsis col-sku" },
      { key: "supplier", label: "Supplier", className: "cell-ellipsis col-supplier" },
      { key: "category", label: "Kategorie", className: "col-category" },
      { key: "status", label: "Status", className: "col-status" },
      { key: "completeness", label: "Vollständigkeit", className: "col-completeness" },
      { key: "moqUnits", label: "MOQ", className: "num col-moq" },
      { key: "lastPo", label: "Letzte PO", className: "col-last-po" },
      { key: "avg", label: "Ø Stückpreis", className: "num col-avg" },
      { key: "count", label: "POs", className: "num col-count" },
      { key: "template", label: "Template", className: "col-template" },
      { key: "tags", label: "Tags", className: "col-tags" },
      { key: "actions", label: "Aktionen", className: "sticky-actions col-actions" },
    ];
    const colCount = columns.length;
    const columnWidths = state?.settings?.productsTableColumns?.list || [];
    const table = createEl("table", { class: "table table-compact products-list-table" });
    const thead = createEl("thead", {}, [
      createEl("tr", {}, columns.map(col => createEl("th", { class: col.className || "", title: col.label }, [col.label])))
    ]);
    const tbody = createEl("tbody");
    const collapseState = loadCollapseState();
    const groups = buildCategoryGroups(list);

    const renderCell = (product, col) => {
      switch (col.key) {
        case "alias": {
          const aliasText = product.alias || "—";
          return createEl("div", { class: "data-health-inline" }, [
            buildHealthDot(product.sku),
            createEl("span", { class: "truncate-text", title: aliasText }, [aliasText]),
            product.status === "inactive" ? createEl("span", { class: "badge muted" }, ["inaktiv"]) : null,
          ]);
        }
        case "sku":
          return createEl("span", { title: product.sku || "—" }, [product.sku || "—"]);
        case "supplier":
          return createEl("span", { title: supplierLabelMap.get(product.supplierId) || product.supplierId || "—" }, [
            supplierLabelMap.get(product.supplierId) || product.supplierId || "—"
          ]);
        case "category":
          return createEl("span", { title: getCategoryLabel(product.categoryId) }, [getCategoryLabel(product.categoryId)]);
        case "status":
          return product.status === "inactive"
            ? createEl("span", { class: "badge muted" }, ["inaktiv"])
            : createEl("span", { class: "badge" }, ["aktiv"]);
        case "completeness":
          return renderCompletenessBadge(product);
        case "moqUnits":
          return Number.isFinite(Number(product.moqUnits)) ? String(product.moqUnits) : "—";
        case "lastPo":
          return product.stats?.lastOrderDate ? fmtDate(product.stats.lastOrderDate) : "—";
        case "avg":
          return product.stats?.avgUnitPriceUsd != null ? fmtUSD(product.stats.avgUnitPriceUsd) : "—";
        case "count":
          return product.stats?.poCount != null ? String(product.stats.poCount) : "0";
        case "template":
          return product.template ? createEl("span", { class: "badge" }, ["vorhanden"]) : createEl("span", { class: "badge muted" }, ["—"]);
        case "tags":
          if (!(product.tags || []).length) return "—";
          return createEl("span", { class: "product-tags", title: (product.tags || []).join(", ") }, [
            ...(product.tags || []).map(tag => createEl("span", { class: "product-tag-pill", title: tag }, [tag]))
          ]);
        case "actions":
          return createEl("div", { class: "table-actions" }, [
            createEl("button", { class: "btn primary sm", type: "button", onclick: () => showEditor(product) }, ["Bearbeiten"]),
            createEl("button", {
              class: "btn secondary sm",
              type: "button",
              "aria-haspopup": "menu",
              "aria-expanded": "false",
              onclick: (event) => {
                event.stopPropagation();
                openActionsMenu(event.currentTarget, product);
              },
            }, ["Mehr…"]),
          ]);
        default:
          return "—";
      }
    };

    groups.forEach(group => {
      const isCollapsed = Boolean(collapseState[group.id]);
      tbody.append(createEl("tr", { class: "product-group-row" }, [
        createEl("td", { colspan: String(colCount) }, [
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
        columns.forEach(col => {
          row.append(createEl("td", { class: col.className || "" }, [renderCell(product, col)]));
        });
        tbody.append(row);
      });
    });

    table.append(thead, tbody);
    initColumnResizing(table, { key: "list", widths: columnWidths });
    table.addEventListener("click", (event) => {
      const toggle = event.target.closest(".product-group-toggle");
      if (!toggle) return;
      const next = loadCollapseState();
      const id = toggle.dataset.categoryId;
      next[id] = !next[id];
      saveCollapseState(next);
      render();
    });

    return createEl("div", { class: "table-wrap products-list" }, [table]);
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
      { key: "tags", label: "Tags", type: "text", width: "280px", className: "col-tags" },
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
      if (field.key === "completeness") {
        return getCompleteness(product);
      }
      if (field.key === "tags") {
        return Array.isArray(product.tags) ? product.tags.join(", ") : "";
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
      if (field.key === "tags") {
        return String(raw || "")
          .split(",")
          .map(tag => tag.trim())
          .filter(Boolean)
          .join(", ");
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
    const counter = createEl("span", { class: "muted" }, ["0 Änderungen"]);
    const saveBtn = createEl("button", { class: "btn", type: "button", disabled: true }, ["Änderungen speichern"]);
    const discardBtn = createEl("button", { class: "btn secondary", type: "button", disabled: true }, ["Änderungen verwerfen"]);
    toolbar.append(counter, createEl("div", { class: "products-grid-actions" }, [discardBtn, saveBtn]));

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
    const table = createEl("table", { class: "products-grid-table" });
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
        createEl("th", { colspan: "9", title: "Stammdaten" }, ["Stammdaten"]),
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
    const groups = buildCategoryGroups(list);

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
          } else if (key === "tags") {
            payload.tags = String(value || "")
              .split(",")
              .map(tag => tag.trim())
              .filter(Boolean);
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
    root.innerHTML = "";
    const filtered = applyFilter(products, searchTerm, completenessFilter);
    const bannerCount = products.filter(prod => prod.alias.startsWith("Ohne Alias")).length;
    const header = createEl("div", { class: "products-header" });
    const title = createEl("h2", {}, ["Produkte"]);
    const actions = createEl("div", { class: "products-actions" });
    const createBtn = createEl("button", { class: "btn", type: "button", onclick: () => showEditor(null) }, ["+ Produkt anlegen"]);
    const expandBtn = createEl("button", { class: "btn secondary", type: "button", onclick: () => { setAllCategoriesCollapsed(false); render(); } }, ["Alles aufklappen"]);
    const collapseBtn = createEl("button", { class: "btn secondary", type: "button", onclick: () => { setAllCategoriesCollapsed(true); render(); } }, ["Alles zuklappen"]);
    const search = createEl("input", {
      type: "search",
      placeholder: "Suche nach Alias, SKU, Tag, Supplier",
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
      createEl("option", { value: "warning" }, ["Nur Unvollständige"]),
      createEl("option", { value: "ready" }, ["Nur Ready"]),
    ]);
    completenessSelect.value = completenessFilter;
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
    actions.append(search, completenessSelect, expandBtn, collapseBtn, viewToggle, createBtn);
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
