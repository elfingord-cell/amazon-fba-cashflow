"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hydrateDataTables = hydrateDataTables;
exports.refreshDataTableLayout = refreshDataTableLayout;
exports.createDataTable = createDataTable;
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
const tableScrollSync = new WeakMap();
let tooltipBound = false;
let resizeBound = false;
let layoutRaf = 0;
let activeTooltipTarget = null;
let tooltipLayer = null;
function createEl(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
        if (key === "class")
            node.className = value;
        else if (key === "dataset" && value) {
            Object.entries(value).forEach(([dk, dv]) => node.dataset[dk] = dv);
        }
        else if (key.startsWith("on") && typeof value === "function") {
            node.addEventListener(key.slice(2), value);
        }
        else if (value != null) {
            node.setAttribute(key, value);
        }
    });
    for (const child of Array.isArray(children) ? children : [children]) {
        if (child == null)
            continue;
        node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
}
function ensureTooltipLayer() {
    if (tooltipLayer && tooltipLayer.isConnected)
        return tooltipLayer;
    tooltipLayer = document.getElementById("ui-table-tooltip");
    if (tooltipLayer)
        return tooltipLayer;
    tooltipLayer = document.createElement("div");
    tooltipLayer.id = "ui-table-tooltip";
    tooltipLayer.className = "portal-tooltip ui-table-tooltip";
    tooltipLayer.setAttribute("role", "tooltip");
    tooltipLayer.hidden = true;
    document.body.append(tooltipLayer);
    return tooltipLayer;
}
function positionTooltip() {
    if (!activeTooltipTarget || !activeTooltipTarget.isConnected || !tooltipLayer || tooltipLayer.hidden)
        return;
    const rect = activeTooltipTarget.getBoundingClientRect();
    const tipRect = tooltipLayer.getBoundingClientRect();
    const viewportPad = 8;
    let left = rect.left;
    let top = rect.bottom + 8;
    const maxLeft = window.innerWidth - tipRect.width - viewportPad;
    if (left > maxLeft)
        left = maxLeft;
    if (left < viewportPad)
        left = viewportPad;
    if (top + tipRect.height > window.innerHeight - viewportPad) {
        top = rect.top - tipRect.height - 8;
    }
    if (top < viewportPad)
        top = viewportPad;
    tooltipLayer.style.left = `${Math.round(left)}px`;
    tooltipLayer.style.top = `${Math.round(top)}px`;
}
function showTooltip(target) {
    const text = String(target?.dataset?.uiTooltip || "").trim();
    if (!text)
        return;
    const layer = ensureTooltipLayer();
    layer.textContent = text;
    layer.hidden = false;
    layer.classList.add("is-visible");
    activeTooltipTarget = target;
    target.setAttribute("aria-describedby", layer.id);
    requestAnimationFrame(positionTooltip);
}
function hideTooltip() {
    if (!tooltipLayer)
        return;
    if (activeTooltipTarget) {
        activeTooltipTarget.removeAttribute("aria-describedby");
    }
    activeTooltipTarget = null;
    tooltipLayer.hidden = true;
    tooltipLayer.classList.remove("is-visible");
    tooltipLayer.textContent = "";
}
function bindTooltipEvents() {
    if (tooltipBound)
        return;
    tooltipBound = true;
    document.addEventListener("mouseover", event => {
        const trigger = event.target.closest("[data-ui-tooltip]");
        if (!trigger)
            return;
        if (trigger === activeTooltipTarget)
            return;
        showTooltip(trigger);
    });
    document.addEventListener("mouseout", event => {
        const trigger = event.target.closest("[data-ui-tooltip]");
        if (!trigger || trigger !== activeTooltipTarget)
            return;
        const related = event.relatedTarget;
        if (related && trigger.contains(related))
            return;
        hideTooltip();
    });
    document.addEventListener("focusin", event => {
        const trigger = event.target.closest("[data-ui-tooltip]");
        if (!trigger)
            return;
        showTooltip(trigger);
    });
    document.addEventListener("focusout", event => {
        const trigger = event.target.closest("[data-ui-tooltip]");
        if (!trigger || trigger !== activeTooltipTarget)
            return;
        hideTooltip();
    });
    window.addEventListener("scroll", () => {
        positionTooltip();
    }, true);
}
function bindLayoutEvents() {
    if (resizeBound)
        return;
    resizeBound = true;
    window.addEventListener("resize", () => {
        positionTooltip();
        scheduleLayoutRefresh();
    });
}
function scheduleLayoutRefresh() {
    if (layoutRaf)
        return;
    layoutRaf = requestAnimationFrame(() => {
        layoutRaf = 0;
        for (const table of Array.from(hydratedTables)) {
            if (!table.isConnected) {
                hydratedTables.delete(table);
                const syncState = tableScrollSync.get(table);
                if (syncState) {
                    try {
                        syncState.cleanup();
                    }
                    catch {
                        // no-op
                    }
                    tableScrollSync.delete(table);
                }
                continue;
            }
            refreshSingleTable(table);
        }
    });
}
function ensureScrollContainer(table) {
    const existing = table.closest(".data-table-scroll, .ui-table-scroll, .table-scroll, .table-wrap, .dashboard-table-scroll, .inventory-table-scroll, .products-grid-scroll, .po-table-wrap");
    if (existing && existing.contains(table)) {
        existing.classList.add("data-table-scroll", "ui-table-scroll");
        return existing;
    }
    const wrapper = createEl("div", { class: "data-table-scroll ui-table-scroll" });
    table.parentNode?.insertBefore(wrapper, table);
    wrapper.append(table);
    return wrapper;
}
function resolveHorizontalScrollElement(scrollContainer) {
    if (!(scrollContainer instanceof HTMLElement))
        return null;
    const candidates = [
        scrollContainer,
        ...Array.from(scrollContainer.querySelectorAll(".ant-table-content, .ant-table-body")),
    ];
    for (const candidate of candidates) {
        if (!(candidate instanceof HTMLElement))
            continue;
        if ((candidate.scrollWidth - candidate.clientWidth) > 1)
            return candidate;
    }
    return candidates.find((candidate) => candidate instanceof HTMLElement) || null;
}
function ensureHorizontalScrollControls(table, scrollContainer, mode = "native") {
    if (!(table instanceof HTMLTableElement))
        return;
    if (!(scrollContainer instanceof HTMLElement))
        return;
    const scrollEl = resolveHorizontalScrollElement(scrollContainer);
    if (!(scrollEl instanceof HTMLElement))
        return;
    const existing = tableScrollSync.get(table);
    if (existing
        && existing.scrollContainer === scrollContainer
        && existing.scrollEl === scrollEl
        && existing.mode === mode) {
        existing.update();
        return;
    }
    if (existing) {
        try {
            existing.cleanup();
        }
        catch {
            // no-op
        }
        tableScrollSync.delete(table);
    }
    const parent = scrollContainer.parentElement;
    if (!parent)
        return;
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const MIN_THUMB_PX = 48;
    const railState = {
        max: 0,
        top: { track: 1, thumb: 1, span: 1, left: 0 },
        bottom: { track: 1, thumb: 1, span: 1, left: 0 },
    };
    let topControl = null;
    let bottomControl = null;
    let topRail = null;
    let bottomRail = null;
    let topThumb = null;
    let bottomThumb = null;
    if (mode === "native-dual") {
        topControl = createEl("div", { class: "ui-scrollbar-custom ui-scrollbar-custom-top", "aria-hidden": "true" }, [
            createEl("div", { class: "ui-scrollbar-custom-rail" }, [
                createEl("button", { class: "ui-scrollbar-custom-thumb", type: "button", tabindex: "-1" }),
            ]),
        ]);
        bottomControl = createEl("div", { class: "ui-scrollbar-custom ui-scrollbar-custom-bottom", "aria-hidden": "true" }, [
            createEl("div", { class: "ui-scrollbar-custom-rail" }, [
                createEl("button", { class: "ui-scrollbar-custom-thumb", type: "button", tabindex: "-1" }),
            ]),
        ]);
        topRail = topControl.querySelector(".ui-scrollbar-custom-rail");
        bottomRail = bottomControl.querySelector(".ui-scrollbar-custom-rail");
        topThumb = topControl.querySelector(".ui-scrollbar-custom-thumb");
        bottomThumb = bottomControl.querySelector(".ui-scrollbar-custom-thumb");
        if (!(topRail instanceof HTMLElement)
            || !(bottomRail instanceof HTMLElement)
            || !(topThumb instanceof HTMLElement)
            || !(bottomThumb instanceof HTMLElement))
            return;
        parent.insertBefore(topControl, scrollContainer);
        parent.insertBefore(bottomControl, scrollContainer.nextSibling);
    }
    const getRailMetrics = (railElement) => {
        const max = Math.max(0, Math.ceil(scrollEl.scrollWidth - scrollEl.clientWidth));
        const track = Math.max(1, Math.floor(railElement?.clientWidth || 1));
        const ratio = scrollEl.clientWidth / Math.max(scrollEl.scrollWidth, 1);
        const thumb = max <= 0
            ? track
            : Math.min(track, Math.max(MIN_THUMB_PX, Math.round(track * ratio)));
        const span = Math.max(1, track - thumb);
        return { max, track, thumb, span };
    };
    const applyThumb = (thumbElement, nextLeft, nextWidth) => {
        if (!(thumbElement instanceof HTMLElement))
            return;
        thumbElement.style.width = `${Math.max(1, Math.round(nextWidth))}px`;
        thumbElement.style.transform = `translateX(${Math.round(nextLeft)}px)`;
        thumbElement.dataset.left = String(nextLeft);
    };
    let syncing = false;
    const update = () => {
        const max = Math.max(0, Math.ceil(scrollEl.scrollWidth - scrollEl.clientWidth));
        railState.max = max;
        if (mode === "native-dual") {
            scrollEl.classList.add("ui-scrollbar-managed");
        }
        else {
            scrollEl.classList.remove("ui-scrollbar-managed");
            return;
        }
        const topMetrics = getRailMetrics(topRail);
        const bottomMetrics = getRailMetrics(bottomRail);
        railState.top = { ...topMetrics, left: 0 };
        railState.bottom = { ...bottomMetrics, left: 0 };
        const current = clamp(Math.round(scrollEl.scrollLeft), 0, max);
        const topLeft = max <= 0 ? 0 : (current / max) * topMetrics.span;
        const bottomLeft = max <= 0 ? 0 : (current / max) * bottomMetrics.span;
        railState.top.left = topLeft;
        railState.bottom.left = bottomLeft;
        applyThumb(topThumb, topLeft, topMetrics.thumb);
        applyThumb(bottomThumb, bottomLeft, bottomMetrics.thumb);
        if (topControl)
            topControl.classList.toggle("is-overflow", max > 0);
        if (bottomControl)
            bottomControl.classList.toggle("is-overflow", max > 0);
    };
    const scrollFromRailPosition = (positionLeft, key) => {
        if (syncing)
            return;
        const meta = key === "top" ? railState.top : railState.bottom;
        if (!meta || railState.max <= 0)
            return;
        const nextLeft = clamp(positionLeft, 0, meta.span);
        const ratio = meta.span <= 0 ? 0 : (nextLeft / meta.span);
        syncing = true;
        scrollEl.scrollLeft = ratio * railState.max;
        syncing = false;
    };
    const bindRail = (key, railElement, thumbElement) => {
        if (!(railElement instanceof HTMLElement) || !(thumbElement instanceof HTMLElement)) {
            return () => { };
        }
        let dragging = false;
        let dragStartX = 0;
        let dragStartLeft = 0;
        const onPointerMove = (event) => {
            if (!dragging)
                return;
            event.preventDefault();
            const delta = event.clientX - dragStartX;
            scrollFromRailPosition(dragStartLeft + delta, key);
        };
        const onPointerEnd = () => {
            if (!dragging)
                return;
            dragging = false;
            thumbElement.classList.remove("is-dragging");
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", onPointerEnd);
            window.removeEventListener("pointercancel", onPointerEnd);
        };
        const onThumbPointerDown = (event) => {
            if (railState.max <= 0)
                return;
            event.preventDefault();
            dragging = true;
            thumbElement.classList.add("is-dragging");
            dragStartX = event.clientX;
            dragStartLeft = Number(thumbElement.dataset.left || 0);
            window.addEventListener("pointermove", onPointerMove);
            window.addEventListener("pointerup", onPointerEnd);
            window.addEventListener("pointercancel", onPointerEnd);
        };
        const onRailPointerDown = (event) => {
            if (railState.max <= 0)
                return;
            if (event.target === thumbElement)
                return;
            const rect = railElement.getBoundingClientRect();
            const meta = key === "top" ? railState.top : railState.bottom;
            const clickLeft = event.clientX - rect.left - (meta.thumb / 2);
            scrollFromRailPosition(clickLeft, key);
        };
        thumbElement.addEventListener("pointerdown", onThumbPointerDown);
        railElement.addEventListener("pointerdown", onRailPointerDown);
        return () => {
            onPointerEnd();
            thumbElement.removeEventListener("pointerdown", onThumbPointerDown);
            railElement.removeEventListener("pointerdown", onRailPointerDown);
        };
    };
    const cleanupTopRail = bindRail("top", topRail, topThumb);
    const cleanupBottomRail = bindRail("bottom", bottomRail, bottomThumb);
    const syncFromScroll = () => {
        if (syncing)
            return;
        update();
    };
    scrollEl.addEventListener("scroll", syncFromScroll, { passive: true });
    window.addEventListener("resize", update);
    const resizeObserver = typeof ResizeObserver === "function"
        ? new ResizeObserver(() => update())
        : null;
    if (resizeObserver) {
        resizeObserver.observe(scrollEl);
        resizeObserver.observe(table);
    }
    const cleanup = () => {
        cleanupTopRail();
        cleanupBottomRail();
        scrollEl.removeEventListener("scroll", syncFromScroll);
        window.removeEventListener("resize", update);
        if (resizeObserver)
            resizeObserver.disconnect();
        scrollEl.classList.remove("ui-scrollbar-managed");
        if (topControl)
            topControl.remove();
        if (bottomControl)
            bottomControl.remove();
    };
    tableScrollSync.set(table, {
        mode,
        scrollContainer,
        scrollEl,
        update,
        cleanup,
    });
    update();
}
function normalizeNativeTitles(table) {
    table.querySelectorAll("[title]").forEach(node => {
        if (node.closest(".tooltip"))
            return;
        const title = String(node.getAttribute("title") || "").trim();
        if (!title)
            return;
        if (!node.dataset.uiTooltip) {
            node.dataset.uiTooltip = title;
            node.dataset.uiTooltipManual = "true";
        }
        node.removeAttribute("title");
    });
}
function applyAbbreviationTooltips(table) {
    table.querySelectorAll("th").forEach(th => {
        if (th.dataset.uiTooltip)
            return;
        const short = String(th.textContent || "").trim().toUpperCase();
        if (!short)
            return;
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
    const stickyOwner = String(table.dataset.stickyOwner || "auto");
    const stickyCols = Number(table.dataset.stickyCols || table.dataset.stickyColumns || 0);
    table.querySelectorAll(".ui-sticky-col").forEach(cell => {
        cell.classList.remove("ui-sticky-col");
        cell.style.removeProperty("--ui-sticky-left");
        cell.style.removeProperty("--ui-sticky-z");
    });
    if (stickyOwner === "manual")
        return;
    if (!Number.isFinite(stickyCols) || stickyCols <= 0)
        return;
    const refRow = table.tHead?.rows?.[table.tHead.rows.length - 1] || table.rows?.[0];
    if (!refRow)
        return;
    const refCells = Array.from(refRow.cells).slice(0, stickyCols);
    if (!refCells.length)
        return;
    const leftOffsets = [];
    let offset = 0;
    refCells.forEach((cell) => {
        leftOffsets.push(offset);
        offset += Math.max(cell.getBoundingClientRect().width, 0);
    });
    Array.from(table.rows).forEach(row => {
        for (let idx = 0; idx < stickyCols; idx += 1) {
            const cell = row.cells[idx];
            if (!cell)
                continue;
            if (row.parentElement?.tagName === "THEAD" && Number(cell.colSpan || 1) > 1)
                continue;
            const section = row.parentElement?.tagName === "THEAD" ? 10 : 5;
            cell.classList.add("ui-sticky-col");
            cell.style.setProperty("--ui-sticky-left", `${Math.round(leftOffsets[idx])}px`);
            cell.style.setProperty("--ui-sticky-z", String(section + idx));
        }
    });
}
function extractTooltipText(node) {
    if (!node)
        return "";
    const custom = String(node.dataset.uiTooltipSource || "").trim();
    if (custom)
        return custom;
    const text = String(node.textContent || "").replace(/\s+/g, " ").trim();
    if (!text || text === "—")
        return "";
    return text;
}
function applyOverflowTooltips(table) {
    const candidates = table.querySelectorAll("th, td, .truncate-text, .cell-ellipsis");
    candidates.forEach(node => {
        if (!(node instanceof HTMLElement))
            return;
        if (node.dataset.uiTooltipManual === "true")
            return;
        if (node.closest(".tooltip"))
            return;
        if (node.querySelector("button, input, select, textarea"))
            return;
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
        }
        else if (node.dataset.uiTooltipAuto === "true") {
            delete node.dataset.uiTooltip;
            delete node.dataset.uiTooltipAuto;
        }
    });
}
function refreshSingleTable(table) {
    applyNumericAlignment(table);
    applyStickyColumns(table);
    applyOverflowTooltips(table);
    const syncState = tableScrollSync.get(table);
    const mode = String(table.dataset.scrollbarMode || "native");
    if (syncState && syncState.mode === mode) {
        syncState.update();
    }
    else {
        if (syncState) {
            try {
                syncState.cleanup();
            }
            catch {
                // no-op
            }
            tableScrollSync.delete(table);
        }
        const scrollContainer = ensureScrollContainer(table);
        ensureHorizontalScrollControls(table, scrollContainer, mode);
    }
}
function hydrateSingleTable(table) {
    if (!table)
        return;
    table.classList.add("ui-data-table", "table-compact");
    if (!table.dataset.uiTable)
        table.dataset.uiTable = "true";
    if (!table.dataset.scrollbarMode)
        table.dataset.scrollbarMode = "native";
    if (!table.dataset.stickyOwner)
        table.dataset.stickyOwner = "auto";
    const scrollContainer = ensureScrollContainer(table);
    ensureHorizontalScrollControls(table, scrollContainer, table.dataset.scrollbarMode);
    normalizeNativeTitles(table);
    applyAbbreviationTooltips(table);
    hydratedTables.add(table);
}
function hydrateDataTables(root = document) {
    bindTooltipEvents();
    bindLayoutEvents();
    const tables = Array.from(root.querySelectorAll("table")).filter((table) => {
        if (!(table instanceof HTMLTableElement))
            return false;
        if (table.dataset.uiTable === "false")
            return false;
        if (table.closest(".ant-table"))
            return false;
        return true;
    });
    tables.forEach((table) => hydrateSingleTable(table));
    scheduleLayoutRefresh();
}
function refreshDataTableLayout() {
    scheduleLayoutRefresh();
}
function createDataTable({ columns, rows, rowKey, renderCell, onRowClick, toolbar, footer, className = "", rowAttrs, stickyColumns = 0, scrollbarMode = "native", stickyOwner = "auto", }) {
    const wrapper = createEl("div", { class: `data-table ${className}`.trim() });
    if (toolbar) {
        wrapper.append(createEl("div", { class: "data-table-toolbar" }, [toolbar]));
    }
    const scroll = createEl("div", { class: "data-table-scroll ui-table-scroll" });
    const table = createEl("table", {
        class: "data-table-table ui-data-table table-compact",
        "data-ui-table": "true",
        "data-sticky-columns": Number.isFinite(Number(stickyColumns)) ? String(Number(stickyColumns)) : "0",
        "data-scrollbar-mode": scrollbarMode || "native",
        "data-sticky-owner": stickyOwner || "auto",
    });
    const thead = createEl("thead", {}, [
        createEl("tr", {}, columns.map(col => {
            const attrs = {
                class: col.className || "",
                style: col.width ? `width:${col.width}` : null,
            };
            if (col.tooltip)
                attrs["data-ui-tooltip"] = col.tooltip;
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
            if (col.tooltip)
                tdAttrs["data-ui-tooltip-source"] = String(col.tooltip);
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
