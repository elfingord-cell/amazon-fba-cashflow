function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "dataset") {
      for (const [dk, dv] of Object.entries(value)) node.dataset[dk] = dv;
    } else if (typeof value === "boolean") {
      node[key] = value;
      if (value) node.setAttribute(key, "");
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value);
    } else {
      node.setAttribute(key, value);
    }
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function openConfirmDialog({
  title = "Ungespeicherte Änderungen",
  message = "Ungespeicherte Änderungen verwerfen?",
  confirmLabel = "Verwerfen",
  cancelLabel = "Abbrechen",
  onConfirm,
  onCancel,
}) {
  const overlay = el("div", { class: "po-modal-backdrop", role: "dialog", "aria-modal": "true" });
  const card = el("div", { class: "po-modal" }, [
    el("header", { class: "po-modal-header" }, [
      el("h4", {}, [title]),
      el("button", {
        class: "btn ghost",
        type: "button",
        onclick: () => {
          overlay.remove();
          if (typeof onCancel === "function") onCancel();
        },
        "aria-label": "Schließen",
      }, ["✕"]),
    ]),
    el("div", { class: "po-modal-body" }, [el("p", {}, [message])]),
    el("footer", { class: "po-modal-actions" }, [
      el("button", {
        class: "btn",
        type: "button",
        onclick: () => {
          overlay.remove();
          if (typeof onCancel === "function") onCancel();
        },
      }, [cancelLabel]),
      el("button", {
        class: "btn danger",
        type: "button",
        onclick: () => {
          overlay.remove();
          if (typeof onConfirm === "function") onConfirm();
        },
      }, [confirmLabel]),
    ]),
  ]);
  overlay.append(card);
  document.body.append(overlay);
  const focusable = overlay.querySelector("button");
  if (focusable) focusable.focus();
  return overlay;
}
