export function createCardHeader(title, subtitle = "", toolbar = null) {
  const header = document.createElement("div");
  header.className = "card-header table-card-header";

  const textWrap = document.createElement("div");
  if (subtitle) {
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = subtitle;
    textWrap.append(eyebrow);
  }
  const heading = document.createElement("h2");
  heading.textContent = title;
  textWrap.append(heading);
  header.append(textWrap);

  if (toolbar) {
    const tools = document.createElement("div");
    tools.className = "table-toolbar";
    tools.append(toolbar);
    header.append(tools);
  }
  return header;
}

export function createTableShell(bodyId) {
  const scroll = document.createElement("div");
  scroll.className = "table-scroll table-scroll-sticky";
  if (bodyId) scroll.id = bodyId;
  return scroll;
}

export function primarySecondaryCell(primary, secondary) {
  const wrap = document.createElement("div");
  wrap.className = "cell-primary-secondary";
  const main = document.createElement("div");
  main.className = "cell-primary";
  main.textContent = primary || "—";
  wrap.append(main);
  if (secondary) {
    const sub = document.createElement("div");
    sub.className = "cell-secondary";
    sub.textContent = secondary;
    wrap.append(sub);
  }
  return wrap;
}

export function makeActionButtons(actions = []) {
  const wrap = document.createElement("div");
  wrap.className = "table-actions";
  actions.forEach(btn => wrap.append(btn));
  return wrap;
}
