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
}) {
  const wrapper = createEl("div", { class: `data-table ${className}`.trim() });
  if (toolbar) {
    wrapper.append(createEl("div", { class: "data-table-toolbar" }, [toolbar]));
  }
  const scroll = createEl("div", { class: "data-table-scroll" });
  const table = createEl("table", { class: "data-table-table" });
  const thead = createEl("thead", {}, [
    createEl("tr", {}, columns.map(col => createEl("th", {
      class: col.className || "",
      style: col.width ? `width:${col.width}` : null,
    }, [col.label || ""])))
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
      tr.append(createEl("td", { class: col.className || "" }, [content]));
    });
    tbody.append(tr);
  });
  table.append(thead, tbody);
  scroll.append(table);
  wrapper.append(scroll);
  if (footer) {
    wrapper.append(createEl("div", { class: "data-table-footer" }, [footer]));
  }
  return wrapper;
}
