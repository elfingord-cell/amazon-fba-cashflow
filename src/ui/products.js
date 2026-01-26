import {
  loadState,
  getProductsSnapshot,
  getProductBySku,
  upsertProduct,
  deleteProductBySku,
  setProductStatus,
  setPreferredProductSupplier,
  setProductsTableColumns,
} from "../data/storageLocal.js";
import { buildSupplierLabelMap } from "./utils/supplierLabels.js";
import { formatDeNumber, parseDeNumber, validateProducts } from "../lib/dataHealth.js";
import { openDataHealthPanel } from "./dataHealthUi.js";

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
  const modal = createEl("div", { class: "po-modal" });
  const header = createEl("div", { class: "po-modal-header" }, [
    createEl("h3", {}, [title]),
    createEl("button", {
      type: "button",
      class: "btn tertiary",
      onclick: () => {
        document.body.removeChild(overlay);
        document.removeEventListener("keydown", escHandler);
        onClose?.();
      },
      "aria-label": "Schließen",
    }, ["✕"]),
  ]);
  const body = createEl("div", { class: "po-modal-body" }, [content]);
  const footer = createEl("div", { class: "po-modal-actions" });
  actions.forEach(action => footer.append(action));
  modal.append(header, body, footer);
  overlay.append(modal);
  overlay.addEventListener("click", ev => {
    if (ev.target === overlay) {
      document.body.removeChild(overlay);
      document.removeEventListener("keydown", escHandler);
      onClose?.();
    }
  });
  function escHandler(ev) {
    if (ev.key === "Escape") {
      document.body.removeChild(overlay);
      document.removeEventListener("keydown", escHandler);
      onClose?.();
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
  const state = loadState();
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
  let viewMode = localStorage.getItem("productsView");
  if (viewMode !== "table" && viewMode !== "list") {
    viewMode = "list";
  }
  const pendingEdits = new Map();
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

  function applyFilter(list, term) {
    if (!term) return list;
    const needle = term.trim().toLowerCase();
    return list.filter(item => {
      const categoryName = getCategoryLabel(item.categoryId);
      const supplierLabel = supplierLabelMap.get(item.supplierId);
      return [item.alias, item.sku, item.supplierId, supplierLabel, categoryName, ...(item.tags || [])]
        .filter(Boolean)
        .some(val => String(val).toLowerCase().includes(needle));
    });
  }

  function getCategoryLabel(categoryId) {
    if (!categoryId) return "Ohne Kategorie";
    const category = categoryById.get(String(categoryId));
    return category?.name || "Ohne Kategorie";
  }

  function loadCollapseState() {
    try {
      return JSON.parse(localStorage.getItem(collapseKey) || "{}");
    } catch (err) {
      return {};
    }
  }

  function saveCollapseState(next) {
    localStorage.setItem(collapseKey, JSON.stringify(next));
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
    const state = loadState();
    const product = existing ? { ...existing } : { sku: "", alias: "", supplierId: "", status: "active", tags: [], template: null };
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

    const template = product.template?.fields ? { ...product.template.fields } : (product.template || {});
    if (!template.transportMode && template.transport) {
      template.transportMode = template.transport;
    }
    const settings = state.settings || {};
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
      { key: "freightEur", label: "Fracht (€ / Stück)", valueType: "number", decimals: 2 },
      { key: "dutyPct", label: "Zoll %", valueType: "number", decimals: 2 },
      { key: "dutyIncludesFreight", label: "Freight einbeziehen", type: "checkbox" },
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
      createEl("hr"),
      templateHeader
    );

    const numericFields = [
      { input: avgSellingPriceInput, decimals: 2 },
      { input: sellerboardMarginInput, decimals: 2 },
      { input: productionLeadTimeInput, decimals: 0 },
    ];
    numericFields.forEach(({ input, decimals }) => {
      input.addEventListener("blur", () => {
        const parsed = parseDeNumber(input.value);
        input.value = parsed == null ? "" : formatInputNumber(parsed, decimals);
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
      saveBtn.disabled = !valid;
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
      return `Hinweis: Frachtkosten pro Stück aus letzter PO: ${formatDeNumber(computed, 2)} €`;
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
        });
        input.addEventListener("input", () => {
          validateField(field.key);
          updateSaveState();
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
      updateSaveState();
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

    const suppliersSection = (() => {
      const mappings = (state.productSuppliers || []).filter(entry => String(entry.sku || "").trim().toLowerCase() === String(product.sku || "").trim().toLowerCase());
      const supplierById = new Map((state.suppliers || []).map(s => [s.id, s]));
      if (!mappings.length) {
        return createEl("div", { class: "product-suppliers" }, [
          createEl("h4", {}, ["Suppliers"]),
          createEl("p", { class: "muted" }, ["Keine Supplier-Mappings vorhanden."]),
        ]);
      }
      const table = createEl("table", { class: "table" });
      table.append(
        createEl("thead", {}, [
          createEl("tr", {}, [
            createEl("th", {}, ["Supplier"]),
            createEl("th", { class: "num" }, ["Unit Price"]),
            createEl("th", {}, ["Currency"]),
            createEl("th", { class: "num" }, ["Prod LT"]),
            createEl("th", {}, ["Incoterm"]),
            createEl("th", {}, ["Preferred"]),
            createEl("th", {}, ["Actions"]),
          ]),
        ]),
        createEl("tbody", {}, mappings.map(mapping => {
          const supplier = supplierById.get(mapping.supplierId);
          const priceText = mapping.unitPrice != null
            ? Number(mapping.unitPrice).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : "—";
          return createEl("tr", {}, [
            createEl("td", {}, [supplier?.name || mapping.supplierId || "—"]),
            createEl("td", { class: "num" }, [priceText]),
            createEl("td", {}, [mapping.currency || "—"]),
            createEl("td", { class: "num" }, [mapping.productionLeadTimeDays ?? "—"]),
            createEl("td", {}, [mapping.incoterm || "—"]),
            createEl("td", {}, [mapping.isPreferred ? "✓" : "—"]),
            createEl("td", {}, [
              createEl("button", {
                class: "btn secondary",
                type: "button",
                onclick: () => {
                  setPreferredProductSupplier(mapping.id);
                  renderProducts(root);
                },
              }, ["Set preferred"]),
            ]),
          ]);
        })),
      );
      return createEl("div", { class: "product-suppliers" }, [
        createEl("h4", {}, ["Suppliers"]),
        createEl("div", { class: "table-wrap" }, [table]),
      ]);
    })();

    const saveBtn = createEl("button", { class: "btn", type: "submit" }, ["Speichern"]);
    const cancelBtn = createEl("button", { class: "btn secondary", type: "button" }, ["Abbrechen"]);

    let dialog;
    dialog = openModal({
      title: existing ? `Produkt bearbeiten – ${existing.alias || existing.sku}` : "Neues Produkt",
      content: createEl("div", {}, [form, historySection, suppliersSection]),
      actions: [cancelBtn, saveBtn],
      onClose: () => {},
    });
    cancelBtn.addEventListener("click", () => dialog.overlay.remove());
    saveBtn.addEventListener("click", ev => {
      ev.preventDefault();
      form.requestSubmit();
    });
    const applyBtn = $("#product-apply-latest", form);
    if (applyBtn) {
      applyBtn.addEventListener("click", applyLatestPoValues);
    }
    Object.keys(fieldRules).forEach(key => validateField(key));
    updateSaveState();

    form.addEventListener("submit", ev => {
      ev.preventDefault();
      if (!validateAll()) {
        updateSaveState();
        return;
      }
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
      const msValue = milestonesArea.value.trim();
      if (msValue) {
        try {
          const parsed = JSON.parse(msValue);
          if (Array.isArray(parsed)) {
            const sum = parsed.reduce((acc, row) => acc + Number(row.percent || 0), 0);
            if (Math.round(sum) !== 100) {
              alert("Meilensteine müssen in Summe 100 % ergeben.");
              return;
            }
            templateObj.milestones = parsed;
          }
        } catch (err) {
          alert("Ungültiges Meilenstein-JSON: " + (err.message || err));
          return;
        }
      }
      if (Object.keys(templateObj).length) {
        payload.template = {
          scope: existing?.template?.scope || "SKU",
          name: existing?.template?.name || "Standard (SKU)",
          fields: templateObj,
        };
      } else {
        payload.template = null;
      }
      try {
        upsertProduct(payload);
        dialog.overlay.remove();
        renderProducts(root);
        document.dispatchEvent(new Event("state:changed"));
      } catch (err) {
        alert(err.message || String(err));
      }
    });
  }

  function renderList(list) {
    if (!list.length) {
      return createEl("p", { class: "empty-state" }, ["Keine Produkte gefunden. Lege ein Produkt an oder erfasse eine PO."]);
    }
    const columns = [
      { key: "alias", label: "Alias" },
      { key: "sku", label: "SKU" },
      { key: "supplier", label: "Supplier" },
      { key: "category", label: "Kategorie" },
      { key: "status", label: "Status" },
      { key: "lastPo", label: "Letzte PO" },
      { key: "avg", label: "Ø Stückpreis", className: "num" },
      { key: "count", label: "POs", className: "num" },
      { key: "template", label: "Template" },
      { key: "tags", label: "Tags" },
      { key: "actions", label: "Aktionen" },
    ];
    const colCount = columns.length;
    const columnWidths = state?.settings?.productsTableColumns?.list || [];
    const table = createEl("table", { class: "table products-list-table" });
    const thead = createEl("thead", {}, [
      createEl("tr", {}, columns.map(col => createEl("th", { class: col.className || "", title: col.label }, [col.label])))
    ]);
    const tbody = createEl("tbody");
    const collapseState = loadCollapseState();
    const groups = buildCategoryGroups(list);

    const renderCell = (product, col) => {
      switch (col.key) {
        case "alias":
          return createEl("div", { class: "data-health-inline" }, [
            buildHealthDot(product.sku),
            product.alias || "—",
            product.status === "inactive" ? createEl("span", { class: "badge muted" }, ["inaktiv"]) : null,
          ]);
        case "sku":
          return product.sku || "—";
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
        case "lastPo":
          return product.stats?.lastOrderDate ? fmtDate(product.stats.lastOrderDate) : "—";
        case "avg":
          return product.stats?.avgUnitPriceUsd != null ? fmtUSD(product.stats.avgUnitPriceUsd) : "—";
        case "count":
          return product.stats?.poCount != null ? String(product.stats.poCount) : "0";
        case "template":
          return product.template ? createEl("span", { class: "badge" }, ["vorhanden"]) : createEl("span", { class: "badge muted" }, ["—"]);
        case "tags":
          return (product.tags || []).length ? (product.tags || []).join(", ") : "—";
        case "actions":
          return createEl("div", { class: "table-actions" }, [
            createEl("button", { class: "btn secondary", type: "button", onclick: () => showEditor(product) }, ["Bearbeiten"]),
            createEl("button", { class: "btn tertiary", type: "button", onclick: () => showHistory(product) }, ["Historie"]),
            createEl("button", {
              class: "btn tertiary",
              type: "button",
              onclick: () => {
                setProductStatus(product.sku, product.status === "inactive" ? "active" : "inactive");
                renderProducts(root);
                document.dispatchEvent(new Event("state:changed"));
              }
            }, [product.status === "inactive" ? "Aktivieren" : "Inaktiv setzen"]),
            createEl("button", {
              class: "btn danger",
              type: "button",
              onclick: () => {
                if (confirm("Produkt wirklich löschen?")) {
                  deleteProductBySku(product.sku);
                  renderProducts(root);
                  document.dispatchEvent(new Event("state:changed"));
                }
              }
            }, ["Löschen"]),
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
      { key: "avgSellingPriceGrossEUR", label: "Ø VK-Preis (Brutto)", type: "number", decimals: 2, width: "150px", className: "col-amount" },
      { key: "sellerboardMarginPct", label: "Sellerboard Marge (%)", type: "number", decimals: 2, width: "140px", className: "col-short" },
      { key: "productionLeadTimeDaysDefault", label: "Default Production Lead Time (Fallback)", type: "number", decimals: 0, width: "170px", className: "col-days col-group-end" },
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
      { key: "template.freightEur", label: "Fracht (€ / Stück)", type: "number", decimals: 2, width: "140px", className: "col-amount" },
      { key: "template.dutyPct", label: "Zoll %", type: "number", decimals: 2, width: "90px", className: "col-short" },
      { key: "template.dutyIncludesFreight", label: "Freight einbeziehen", type: "checkbox", width: "56px", className: "col-check" },
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
      if (field.type === "checkbox") {
        return Boolean(value);
      }
      return value ?? "";
    }

    function normalizeValue(raw, field) {
      if (field.type === "number") {
        return parseDeNumber(raw);
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
      if (!pendingEdits.has(sku)) {
        pendingEdits.set(sku, {});
      }
      return pendingEdits.get(sku);
    }

    function clearEdit(sku, fieldKey) {
      const bucket = pendingEdits.get(sku);
      if (!bucket) return;
      delete bucket[fieldKey];
      if (!Object.keys(bucket).length) {
        pendingEdits.delete(sku);
      }
    }

    function countEdits() {
      let total = 0;
      pendingEdits.forEach(bucket => {
        total += Object.keys(bucket).length;
      });
      return total;
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
        createEl("th", { colspan: "8", title: "Stammdaten" }, ["Stammdaten"]),
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
          const value = pendingEdits.get(product.sku)?.[field.key] ?? getFieldValue(product, field);
          if (field.type === "checkbox") {
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
          const original = normalizeValue(getFieldValue(product, field), field);
          const current = normalizeValue(value, field);
          const isDirty = field.type === "number"
            ? Number(current) !== Number(original)
            : current !== original;
          if (isDirty) {
            cell.classList.add("is-dirty");
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
      pendingEdits.clear();
      render();
    });

    saveBtn.addEventListener("click", async () => {
      const editsBySku = Array.from(pendingEdits.entries());
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
      pendingEdits.clear();
      render();
      document.dispatchEvent(new Event("state:changed"));
    });

    return wrapper;
  }

  function showHistory(product) {
    const state = loadState();
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
    const filtered = applyFilter(products, searchTerm);
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
    const viewToggle = createEl("div", { class: "view-toggle" }, [
      createEl("button", {
        type: "button",
        class: `btn tertiary${viewMode === "list" ? " is-active" : ""}`,
        "aria-pressed": viewMode === "list",
        onclick: () => {
          viewMode = "list";
          localStorage.setItem("productsView", viewMode);
          render();
        },
      }, ["Liste"]),
      createEl("button", {
        type: "button",
        class: `btn tertiary${viewMode === "table" ? " is-active" : ""}`,
        "aria-pressed": viewMode === "table",
        onclick: () => {
          viewMode = "table";
          localStorage.setItem("productsView", viewMode);
          render();
        },
      }, ["Tabelle"]),
    ]);
    actions.append(search, expandBtn, collapseBtn, viewToggle, createBtn);
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
  };
  renderProducts(root);
  return { cleanup: root.__productsCleanup };
}
