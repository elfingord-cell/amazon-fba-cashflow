import {
  loadState,
  getProductsSnapshot,
  upsertProduct,
  deleteProductBySku,
  setProductStatus,
  setPreferredProductSupplier,
} from "../data/storageLocal.js";
import { createDataTable } from "./components/dataTable.js";

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

function parseDeNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value == null) return null;
  const cleaned = String(value)
    .trim()
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function formatDeNumber(value, decimals = 2) {
  if (!Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("de-DE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
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
  let searchTerm = "";
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

  function applyFilter(list, term) {
    if (!term) return list;
    const needle = term.trim().toLowerCase();
    return list.filter(item => {
      return [item.alias, item.sku, item.supplierId, ...(item.tags || [])]
        .filter(Boolean)
        .some(val => String(val).toLowerCase().includes(needle));
    });
  }

  function showEditor(existing) {
    const state = loadState();
    const product = existing ? { ...existing } : { sku: "", alias: "", supplierId: "", status: "active", tags: [], template: null };
    const form = createEl("form", { class: "form" });

    const skuInput = createEl("input", { value: product.sku || "", required: true });
    const aliasInput = createEl("input", { value: product.alias || "", required: true });
    const supplierInput = createEl("input", { value: product.supplierId || "" });
    const statusSelect = createEl("select", {}, [
      createEl("option", { value: "active", selected: product.status !== "inactive" }, ["Aktiv"]),
      createEl("option", { value: "inactive", selected: product.status === "inactive" }, ["Inaktiv"]),
    ]);
    const tagsInput = createEl("input", { value: (product.tags || []).join(", ") });

    const template = product.template?.fields ? { ...product.template.fields } : (product.template || {});

    const templateFields = [
      { key: "unitPriceUsd", label: "Stückpreis (USD)", valueType: "number", decimals: 2 },
      { key: "extraPerUnitUsd", label: "Zusatz je Stück (USD)", valueType: "number", decimals: 2 },
      { key: "extraFlatUsd", label: "Zusatz pauschal (USD)", valueType: "number", decimals: 2 },
      { key: "transport", label: "Transport", valueType: "text" },
      { key: "productionDays", label: "Produktionstage", valueType: "number", decimals: 0 },
      { key: "transitDays", label: "Transit-Tage", valueType: "number", decimals: 0 },
      { key: "freightEur", label: "Fracht pro Stück (€)", valueType: "number", decimals: 2 },
      { key: "dutyPct", label: "Zoll %", valueType: "number", decimals: 2 },
      { key: "dutyIncludesFreight", label: "Freight einbeziehen", type: "checkbox" },
      { key: "vatImportPct", label: "EUSt %", valueType: "number", decimals: 2 },
      { key: "vatRefundActive", label: "EUSt-Erstattung aktiv", type: "checkbox" },
      { key: "vatRefundLag", label: "EUSt-Lag (Monate)", valueType: "number", decimals: 0 },
      { key: "fxRate", label: "FX-Kurs", valueType: "number", decimals: 4 },
      { key: "fxFeePct", label: "FX-Gebühr %", valueType: "number", decimals: 2 },
      { key: "ddp", label: "DDP", type: "checkbox" },
    ];

    form.append(
      createEl("label", {}, ["SKU", skuInput]),
      createEl("label", {}, ["Alias", aliasInput]),
      createEl("label", {}, ["Supplier", supplierInput]),
      createEl("label", {}, ["Status", statusSelect]),
      createEl("label", {}, ["Tags (Komma-getrennt)", tagsInput]),
      createEl("hr"),
      createEl("h4", {}, ["Template-Werte"])
    );

    const templateContainer = createEl("div", { class: "grid two" });
    const templateInputs = {};
    const templateFieldMeta = {};
    const freightHint = (() => {
      const history = (state.pos || [])
        .filter(po => String(po?.sku || "").trim().toLowerCase() === String(product.sku || "").trim().toLowerCase())
        .sort((a, b) => (b.orderDate || "").localeCompare(a.orderDate || ""));
      const latest = history[0];
      if (!latest) {
        return "Hinweis: Keine PO-Historie vorhanden.";
      }
      const freightPerUnit = parseDeNumber(latest.freightPerUnitEur);
      const units = parseDeNumber(latest.units);
      const freightTotal = parseDeNumber(latest.freightEur);
      const computed = freightPerUnit ?? (freightTotal != null && units ? freightTotal / units : null);
      if (computed == null || !Number.isFinite(computed)) {
        return "Hinweis: Keine PO-Historie vorhanden.";
      }
      return `Hinweis: Frachtkosten pro Stück aus letzter PO: ${formatDeNumber(computed, 2)} €`;
    })();
    templateFields.forEach(field => {
      templateFieldMeta[field.key] = field;
      if (field.type === "checkbox") {
        const checkbox = createEl("input", { type: "checkbox", name: field.key, checked: Boolean(template[field.key]) });
        templateInputs[field.key] = checkbox;
        templateContainer.append(createEl("label", { class: "inline-checkbox" }, [checkbox, " ", field.label]));
      } else {
        const decimals = typeof field.decimals === "number" ? field.decimals : 2;
        const rawValue = template[field.key];
        const parsedValue = parseDeNumber(rawValue);
        const displayValue = parsedValue != null ? formatDeNumber(parsedValue, decimals) : "";
        const input = createEl("input", { name: field.key, value: displayValue, inputmode: "decimal" });
        input.addEventListener("blur", () => {
          const parsed = parseDeNumber(input.value);
          input.value = parsed == null ? "" : formatDeNumber(parsed, decimals);
        });
        templateInputs[field.key] = input;
        const label = createEl("label", {}, [
          field.label,
          input,
        ]);
        if (field.key === "freightEur") {
          label.append(createEl("small", { class: "muted" }, [freightHint]));
        }
        templateContainer.append(label);
      }
    });
    form.append(templateContainer);

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

    form.addEventListener("submit", ev => {
      ev.preventDefault();
      const payload = {
        sku: skuInput.value.trim(),
        alias: aliasInput.value.trim(),
        supplierId: supplierInput.value.trim(),
        status: statusSelect.value,
        tags: tagsInput.value
          .split(",")
          .map(tag => tag.trim())
          .filter(Boolean),
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
        const raw = input.value.trim();
        if (raw === "") return;
        const meta = templateFieldMeta[key] || {};
        if (meta.valueType === "text") {
          templateObj[key] = raw;
        } else {
          const parsed = parseDeNumber(raw);
          if (parsed != null) templateObj[key] = parsed;
        }
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

  function renderTable(list) {
    if (!list.length) {
      return createEl("p", { class: "empty-state" }, ["Keine Produkte gefunden. Lege ein Produkt an oder erfasse eine PO."]);
    }
    const columns = [
      { key: "alias", label: "Alias" },
      { key: "sku", label: "SKU" },
      { key: "supplier", label: "Supplier" },
      { key: "lastPo", label: "Letzte PO" },
      { key: "avg", label: "Ø Stückpreis", className: "num" },
      { key: "count", label: "POs", className: "num" },
      { key: "template", label: "Template" },
      { key: "actions", label: "Aktionen" },
    ];
    return createDataTable({
      columns,
      rows: list,
      rowKey: row => row.id,
      renderCell: (product, col) => {
        switch (col.key) {
          case "alias":
            return createEl("div", {}, [
              product.alias || "—",
              product.status === "inactive" ? createEl("span", { class: "badge muted" }, ["inaktiv"]) : null,
            ]);
          case "sku":
            return product.sku || "—";
          case "supplier":
            return product.supplierId || "—";
          case "lastPo":
            return product.stats?.lastOrderDate ? fmtDate(product.stats.lastOrderDate) : "—";
          case "avg":
            return product.stats?.avgUnitPriceUsd != null ? fmtUSD(product.stats.avgUnitPriceUsd) : "—";
          case "count":
            return product.stats?.poCount != null ? String(product.stats.poCount) : "0";
          case "template":
            return product.template ? createEl("span", { class: "badge" }, ["vorhanden"]) : createEl("span", { class: "badge muted" }, ["—"]);
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
      },
    });
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
    const search = createEl("input", {
      type: "search",
      placeholder: "Suche nach Alias, SKU, Tag, Supplier",
      value: searchTerm,
      oninput: ev => {
        searchTerm = ev.target.value;
        render();
      }
    });
    actions.append(search, createBtn);
    header.append(title, actions);
    root.append(header);
    if (bannerCount) {
      root.append(createEl("div", { class: "banner info" }, [
        `${bannerCount} Produkte ohne Alias – bitte ergänzen.`,
      ]));
    }
    root.append(renderTable(filtered));
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
  root.__productsCleanup = () => document.removeEventListener("state:changed", handler);
  renderProducts(root);
  return { cleanup: root.__productsCleanup };
}
