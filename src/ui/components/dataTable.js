const ABBREVIATION_TOOLTIPS = {
  MOQ: "Minimum Order Quantity",
  DOH: "Days on Hand (Bestandsreichweite in Tagen)",
  ETD: "Estimated Time of Departure",
  ETA: "Estimated Time of Arrival",
  ABC: "ABC-Klassifikation (A = hohe Relevanz, C = niedriger)",
  SKU: "Stock Keeping Unit",
  "3PL": "Third-Party Logistics",
};

const hydratedTables = new Set();
let tooltipBound = false;
let resizeBound = false;
let layoutRaf = 0;
let activeTooltipTarget = null;
let tooltipLayer = null;

function createEl(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === "class") node.className = value;
    else if (key === "dataset" && value) {
      Object.entries(value).forEach(([dk, dv]) => node.dataset[dk] = dv);
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value);
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

function ensureTooltipLayer() {
  if (tooltipLayer && tooltipLayer.isConnected) return tooltipLayer;
  tooltipLayer = document.getElementById("ui-table-tooltip");
  if (tooltipLayer) return tooltipLayer;
  tooltipLayer = document.createElement("div");
  tooltipLayer.id = "ui-table-tooltip";
  tooltipLayer.className = "portal-tooltip ui-table-tooltip";
  tooltipLayer.setAttribute("role", "tooltip");
  tooltipLayer.hidden = true;
  document.body.append(tooltipLayer);
  return tooltipLayer;
}

function positionTooltip() {
  if (!activeTooltipTarget || !activeTooltipTarget.isConnected || !tooltipLayer || tooltipLayer.hidden) return;
  const rect = activeTooltipTarget.getBoundingClientRect();
  const tipRect = tooltipLayer.getBoundingClientRect();
  const viewportPad = 8;
  let left = rect.left;
  let top = rect.bottom + 8;
  const maxLeft = window.innerWidth - tipRect.width - viewportPad;
  if (left > maxLeft) left = maxLeft;
  if (left < viewportPad) left = viewportPad;
  if (top + tipRect.height > window.innerHeight - viewportPad) {
    top = rect.top - tipRect.height - 8;
  }
  if (top < viewportPad) top = viewportPad;
  tooltipLayer.style.left = `${Math.round(left)}px`;
  tooltipLayer.style.top = `${Math.round(top)}px`;
}

function showTooltip(target) {
  const text = String(target?.dataset?.uiTooltip || "").trim();
  if (!text) return;
  const layer = ensureTooltipLayer();
  layer.textContent = text;
  layer.hidden = false;
  layer.classList.add("is-visible");
  activeTooltipTarget = target;
  target.setAttribute("aria-describedby", layer.id);
  requestAnimationFrame(positionTooltip);
}

function hideTooltip() {
  if (!tooltipLayer) return;
  if (activeTooltipTarget) {
    activeTooltipTarget.removeAttribute("aria-describedby");
  }
  activeTooltipTarget = null;
  tooltipLayer.hidden = true;
  tooltipLayer.classList.remove("is-visible");
  tooltipLayer.textContent = "";
}

function bindTooltipEvents() {
  if (tooltipBound) return;
  tooltipBound = true;
  document.addEventListener("mouseover", event => {
    const trigger = event.target.closest("[data-ui-tooltip]");
    if (!trigger) return;
    if (trigger === activeTooltipTarget) return;
    showTooltip(trigger);
  });
  document.addEventListener("mouseout", event => {
    const trigger = event.target.closest("[data-ui-tooltip]");
    if (!trigger || trigger !== activeTooltipTarget) return;
    const related = event.relatedTarget;
    if (related && trigger.contains(related)) return;
    hideTooltip();
  });
  document.addEventListener("focusin", event => {
    const trigger = event.target.closest("[data-ui-tooltip]");
    if (!trigger) return;
    showTooltip(trigger);
  });
  document.addEventListener("focusout", event => {
    const trigger = event.target.closest("[data-ui-tooltip]");
    if (!trigger || trigger !== activeTooltipTarget) return;
    hideTooltip();
  });
  window.addEventListener("scroll", () => {
    positionTooltip();
  }, true);
}

function bindLayoutEvents() {
  if (resizeBound) return;
  resizeBound = true;
  window.addEventListener("resize", () => {
    positionTooltip();
    scheduleLayoutRefresh();
  });
}

function scheduleLayoutRefresh() {
  if (layoutRaf) return;
  layoutRaf = requestAnimationFrame(() => {
    layoutRaf = 0;
    for (const table of Array.from(hydratedTables)) {
      if (!table.isConnected) {
        hydratedTables.delete(table);
        continue;
      }
      refreshSingleTable(table);
    }
  });
}

function ensureScrollContainer(table) {
  const existing = table.closest(".data-table-scroll, .ui-table-scroll, .table-scroll, .table-wrap, .dashboard-table-scroll, .inventory-table-scroll, .products-grid-scroll");
  if (existing && existing.contains(table)) {
    existing.classList.add("data-table-scroll", "ui-table-scroll");
    return existing;
  }
  const wrapper = createEl("div", { class: "data-table-scroll ui-table-scroll" });
  table.parentNode?.insertBefore(wrapper, table);
  wrapper.append(table);
  return wrapper;
}

function normalizeNativeTitles(table) {
  table.querySelectorAll("[title]").forEach(node => {
    if (node.closest(".tooltip")) return;
    const title = String(node.getAttribute("title") || "").trim();
    if (!title) return;
    if (!node.dataset.uiTooltip) {
      node.dataset.uiTooltip = title;
      node.dataset.uiTooltipManual = "true";
    }
    node.removeAttribute("title");
  });
}

function applyAbbreviationTooltips(table) {
  table.querySelectorAll("th").forEach(th => {
    if (th.dataset.uiTooltip) return;
    const short = String(th.textContent || "").trim().toUpperCase();
    if (!short) return;
    if (ABBREVIATION_TOOLTIPS[short]) {
      th.dataset.uiTooltip = ABBREVIATION_TOOLTIPS[short];
      th.dataset.uiTooltipManual = "true";
    }
  });
}

function applyNumericAlignment(table) {
  table.querySelectorAll("th.num, td.num").forEach(cell => {
    cell.classList.add("ui-num");
  });
}

function applyStickyColumns(table) {
  const stickyCols = Number(table.dataset.stickyCols || table.dataset.stickyColumns || 0);
  table.querySelectorAll(".ui-sticky-col").forEach(cell => {
    cell.classList.remove("ui-sticky-col");
    cell.style.removeProperty("--ui-sticky-left");
    cell.style.removeProperty("--ui-sticky-z");
  });
  if (!Number.isFinite(stickyCols) || stickyCols <= 0) return;
  const refRow = table.tHead?.rows?.[table.tHead.rows.length - 1] || table.rows?.[0];
  if (!refRow) return;
  const refCells = Array.from(refRow.cells).slice(0, stickyCols);
  if (!refCells.length) return;
  const leftOffsets = [];
  let offset = 0;
  refCells.forEach((cell) => {
    leftOffsets.push(offset);
    offset += Math.max(cell.getBoundingClientRect().width, 0);
  });
  Array.from(table.rows).forEach(row => {
    for (let idx = 0; idx < stickyCols; idx += 1) {
      const cell = row.cells[idx];
      if (!cell) continue;
      if (row.parentElement?.tagName === "THEAD" && Number(cell.colSpan || 1) > 1) continue;
      const section = row.parentElement?.tagName === "THEAD" ? 10 : 5;
      cell.classList.add("ui-sticky-col");
      cell.style.setProperty("--ui-sticky-left", `${Math.round(leftOffsets[idx])}px`);
      cell.style.setProperty("--ui-sticky-z", String(section + idx));
    }
  });
}

function extractTooltipText(node) {
  if (!node) return "";
  const custom = String(node.dataset.uiTooltipSource || "").trim();
  if (custom) return custom;
  const text = String(node.textContent || "").replace(/\s+/g, " ").trim();
  if (!text || text === "—") return "";
  return text;
}

function applyOverflowTooltips(table) {
  const candidates = table.querySelectorAll("th, td, .truncate-text, .cell-ellipsis");
  candidates.forEach(node => {
    if (!(node instanceof HTMLElement)) return;
    if (node.dataset.uiTooltipManual === "true") return;
    if (node.closest(".tooltip")) return;
    if (node.querySelector("button, input, select, textarea")) return;
    const text = extractTooltipText(node);
    if (!text) {
      if (node.dataset.uiTooltipAuto === "true") {
        delete node.dataset.uiTooltip;
        delete node.dataset.uiTooltipAuto;
      }
      return;
    }
    const isOverflowing = node.scrollWidth > node.clientWidth + 2;
    if (isOverflowing) {
      node.dataset.uiTooltip = text;
      node.dataset.uiTooltipAuto = "true";
    } else if (node.dataset.uiTooltipAuto === "true") {
      delete node.dataset.uiTooltip;
      delete node.dataset.uiTooltipAuto;
    }
  });
}

function refreshSingleTable(table) {
  applyNumericAlignment(table);
  applyStickyColumns(table);
  applyOverflowTooltips(table);
}

function hydrateSingleTable(table) {
  if (!table) return;
  table.classList.add("ui-data-table", "table-compact");
  if (!table.dataset.uiTable) table.dataset.uiTable = "true";
  ensureScrollContainer(table);
  normalizeNativeTitles(table);
  applyAbbreviationTooltips(table);
  hydratedTables.add(table);
}

export function hydrateDataTables(root = document) {
  bindTooltipEvents();
  bindLayoutEvents();
  const tables = root.querySelectorAll("table[data-ui-table], table.data-table-table");
  tables.forEach(hydrateSingleTable);
  scheduleLayoutRefresh();
}

export function refreshDataTableLayout() {
  scheduleLayoutRefresh();
}

export function createDataTable({
  columns,
  rows,
  rowKey,
  renderCell,
  onRowClick,
  toolbar,
  footer,
  className = "",
  rowAttrs,
  stickyColumns = 0,
}) {
  const wrapper = createEl("div", { class: `data-table ${className}`.trim() });
  if (toolbar) {
    wrapper.append(createEl("div", { class: "data-table-toolbar" }, [toolbar]));
  }
  const scroll = createEl("div", { class: "data-table-scroll ui-table-scroll" });
  const table = createEl("table", {
    class: "data-table-table ui-data-table table-compact",
    "data-ui-table": "true",
    "data-sticky-columns": Number.isFinite(Number(stickyColumns)) ? String(Number(stickyColumns)) : "0",
  });
  const thead = createEl("thead", {}, [
    createEl("tr", {}, columns.map(col => {
      const attrs = {
        class: col.className || "",
        style: col.width ? `width:${col.width}` : null,
      };
      if (col.tooltip) attrs["data-ui-tooltip"] = col.tooltip;
      return createEl("th", attrs, [col.label || ""]);
    }))
  ]);
  const tbody = createEl("tbody");
  rows.forEach((row) => {
    const key = typeof rowKey === "function" ? rowKey(row) : (rowKey ? row[rowKey] : null);
    const attrs = rowAttrs ? rowAttrs(row) : {};
    const tr = createEl("tr", { dataset: { key: key ?? "" }, ...attrs });
    if (onRowClick) {
      tr.addEventListener("click", () => onRowClick(row));
      tr.classList.add("clickable");
    }
    columns.forEach(col => {
      const content = renderCell ? renderCell(row, col) : row[col.key];
      const tdAttrs = { class: col.className || "" };
      if (col.tooltip) tdAttrs["data-ui-tooltip-source"] = String(col.tooltip);
      tr.append(createEl("td", tdAttrs, [content]));
    });
    tbody.append(tr);
  });
  table.append(thead, tbody);
  scroll.append(table);
  wrapper.append(scroll);
  if (footer) {
    wrapper.append(createEl("div", { class: "data-table-footer" }, [footer]));
  }
  hydrateDataTables(wrapper);
  return wrapper;
}
