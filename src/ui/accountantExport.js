function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === "class") node.className = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (value != null) node.setAttribute(key, value);
  });
  (Array.isArray(children) ? children : [children]).forEach((child) => {
    if (child == null) return;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  });
  return node;
}

function navigateToV2() {
  window.location.hash = "#/v2/abschluss/buchhalter";
}

export function render(root) {
  root.innerHTML = "";
  root.append(
    el("section", { class: "card" }, [
      el("div", { class: "ui-page-head" }, [
        el("div", {}, [
          el("h2", {}, ["Buchhalter Export"]),
          el("p", { class: "muted" }, [
            "Dieser Legacy-Pfad zeigt keinen eigenen Export mehr. Der aktive sichtbare Flow liegt in V2.",
          ]),
        ]),
        el("button", { class: "btn primary", type: "button", onClick: navigateToV2 }, ["Zu V2 wechseln"]),
      ]),
    ]),
  );

  setTimeout(navigateToV2, 0);
}

export default { render };
