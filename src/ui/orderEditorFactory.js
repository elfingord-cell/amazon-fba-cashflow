import { loadState, saveState } from "../data/storageLocal.js";

function $(sel, r = document) { return r.querySelector(sel); }
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "dataset") {
      for (const [dk, dv] of Object.entries(value)) node.dataset[dk] = dv;
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

function parseDE(value) {
  if (value == null) return 0;
  const cleaned = String(value)
    .trim()
    .replace(/\s/g, "")
    .replace(/[^0-9,.-]+/g, "");
  const parts = cleaned.split(",");
  let normalised = parts
    .map((segment, idx) => (idx === parts.length - 1 ? segment : segment.replace(/\./g, "")))
    .join(".");
  normalised = normalised.replace(/\.(?=\d{3}(?:\.|$))/g, "");
  const num = Number(normalised);
  return Number.isFinite(num) ? num : 0;
}

function fmtEUR(value) {
  return Number(value || 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

function fmtCurrencyInput(value) {
  return Number(parseDE(value) || 0).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtPercent(value) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : parseDE(value);
  return Number(numeric || 0).toLocaleString("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function clampPct(value) {
  const pct = parseDE(value);
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}

function highestNumberInfo(records, field) {
  let best = null;
  const regex = /(\d+)(?!.*\d)/;
  for (const record of records || []) {
    const raw = record?.[field];
    if (!raw) continue;
    const match = regex.exec(String(raw));
    if (!match) continue;
    const numeric = Number(match[1]);
    if (!Number.isFinite(numeric)) continue;
    if (!best || numeric > best.numeric) {
      best = {
        raw: String(raw),
        numeric,
        digits: match[1],
        index: match.index ?? (String(raw).lastIndexOf(match[1])),
      };
    }
  }

  if (!best) return { raw: null, next: null };

  const nextDigits = String(best.numeric + 1).padStart(best.digits.length, "0");
  const prefix = best.raw.slice(0, best.index);
  const suffix = best.raw.slice(best.index + best.digits.length);
  const next = `${prefix}${nextDigits}${suffix}`;
  return { raw: best.raw, next };
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

function isoDate(date) {
  if (!(date instanceof Date)) return null;
  const ms = date.getTime();
  if (Number.isNaN(ms)) return null;
  const normalised = new Date(ms - date.getTimezoneOffset() * 60000);
  return normalised.toISOString().slice(0, 10);
}

function defaultRecord(config) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: Math.random().toString(36).slice(2, 9),
    [config.numberField]: "",
    orderDate: today,
    goodsEur: "0,00",
    prodDays: 60,
    transport: "sea",
    transitDays: 60,
    milestones: [
      { id: Math.random().toString(36).slice(2, 9), label: "Deposit", percent: 30, anchor: "ORDER_DATE", lagDays: 0 },
      { id: Math.random().toString(36).slice(2, 9), label: "Balance", percent: 70, anchor: "PROD_DONE", lagDays: 0 },
    ],
  };
}

function anchorDate(record, anchor) {
  const order = new Date(record.orderDate);
  const prodDone = addDays(order, Number(record.prodDays || 0));
  const etd = prodDone;
  const eta = addDays(etd, Number(record.transitDays || 0));
  if (anchor === "ORDER_DATE") return order;
  if (anchor === "PROD_DONE") return prodDone;
  if (anchor === "ETD") return etd;
  return eta;
}

function msSum100(ms) {
  const sum = (ms || []).reduce((acc, row) => acc + clampPct(row.percent || 0), 0);
  return Math.round(sum * 10) / 10;
}

function orderEvents(record, config) {
  const goods = parseDE(record.goodsEur);
  const base = {
    orderDate: record.orderDate,
    prodDays: Number(record.prodDays || 0),
    transport: record.transport,
    transitDays: Number(record.transitDays || 0),
  };
  const prefix = record[config.numberField] ? `${config.entityLabel} ${record[config.numberField]} – ` : "";

  const events = (record.milestones || []).map(m => {
    const pct = clampPct(m.percent);
    const baseDate = anchorDate(base, m.anchor || "ORDER_DATE");
    if (!(baseDate instanceof Date) || Number.isNaN(baseDate.getTime())) return null;
    const due = addDays(baseDate, Number(m.lagDays || 0));
    const dueIso = isoDate(due);
    if (!dueIso) return null;
    const amount = -(goods * (pct / 100));
    if (!Number.isFinite(amount)) return null;
    return {
      id: m.id,
      label: `${prefix}${m.label || "Zahlung"}`.trim(),
      date: dueIso,
      amount,
    };
  });

  return events
    .filter(evt => evt && Number.isFinite(evt.amount))
    .sort((a, b) => (a.date === b.date ? (a.label || "").localeCompare(b.label || "") : a.date.localeCompare(b.date)));
}

function buildEventList(events) {
  const wrapper = el("div", { class: "po-event-table" });
  if (!events.length) {
    wrapper.append(el("div", { class: "muted" }, ["Keine Ereignisse definiert."]));
    return wrapper;
  }
  wrapper.append(
    el("div", { class: "po-event-head" }, [
      el("span", { class: "po-event-col" }, ["Name"]),
      el("span", { class: "po-event-col" }, ["Datum"]),
      el("span", { class: "po-event-col amount" }, ["Betrag"]),
    ]),
  );
  for (const evt of events) {
    wrapper.append(
      el("div", { class: "po-event-row" }, [
        el("span", { class: "po-event-col" }, [evt.label]),
        el("span", { class: "po-event-col" }, [evt.date]),
        el("span", { class: "po-event-col amount" }, [fmtEUR(evt.amount)]),
      ]),
    );
  }
  return wrapper;
}

function renderList(container, records, config, onEdit, onDelete) {
  container.innerHTML = "";
  const table = el("table", {}, [
    el("thead", {}, [
      el("tr", {}, [
        el("th", {}, [`${config.entityLabel}-Nr.`]),
        el("th", {}, ["Order"]),
        el("th", {}, ["Warenwert"]),
        el("th", {}, ["Zahlungen"]),
        el("th", {}, ["Transport"]),
        el("th", {}, ["Aktionen"]),
      ]),
    ]),
    el("tbody", {}, records.map(rec =>
      el("tr", {}, [
        el("td", {}, [rec[config.numberField] || "—"]),
        el("td", {}, [rec.orderDate || "—"]),
        el("td", {}, [fmtEUR(parseDE(rec.goodsEur))]),
        el("td", {}, [String((rec.milestones || []).length)]),
        el("td", {}, [`${rec.transport || "sea"} · ${rec.transitDays || 0}d`]),
        el("td", {}, [
          el("button", { class: "btn", onclick: () => onEdit(rec) }, ["Bearbeiten"]),
          " ",
          el("button", { class: "btn danger", onclick: () => onDelete(rec) }, ["Löschen"]),
        ]),
      ]),
    )),
  ]);
  container.append(table);
}

function renderMsTable(container, record, onChange, focusInfo) {
  container.innerHTML = "";
  container.append(el("div", { class: "muted", style: "margin-bottom:6px" }, ["Zahlungsmeilensteine (Summe muss 100 % sein)"]));

  const table = el("table", {}, [
    el("thead", {}, [
      el("tr", {}, [
        el("th", {}, ["Label"]),
        el("th", {}, ["%"]),
        el("th", {}, ["Anker"]),
        el("th", {}, ["Lag (Tage)"]),
        el("th", {}, ["Datum"]),
        el("th", {}, ["Betrag (€)"]),
        el("th", {}, [""]),
      ]),
    ]),
    el("tbody", {}, (record.milestones || []).map((ms, index) => {
      const goods = parseDE(record.goodsEur);
      const pct = clampPct(ms.percent);
      const base = anchorDate(record, ms.anchor || "ORDER_DATE");
      const due = addDays(base, Number(ms.lagDays || 0));
      const dueIso = isoDate(due);
      const amount = goods * (pct / 100);

      return el("tr", { dataset: { msId: ms.id } }, [
        el("td", {}, [
          el("input", {
            value: ms.label || "",
            dataset: { field: "label" },
            oninput: (e) => { ms.label = e.target.value; onChange(); },
            onblur: (e) => { ms.label = e.target.value.trim(); onChange(); },
          }),
        ]),
        el("td", {}, [
          el("input", {
            type: "text",
            inputmode: "decimal",
            value: fmtPercent(ms.percent ?? 0),
            dataset: { field: "percent" },
            oninput: (e) => { ms.percent = e.target.value; onChange(); },
            onblur: (e) => {
              const next = clampPct(e.target.value);
              ms.percent = next;
              e.target.value = fmtPercent(next);
              onChange();
            },
          }),
        ]),
        el("td", {}, [
          (() => {
            const select = el("select", { dataset: { field: "anchor" }, onchange: (e) => { ms.anchor = e.target.value; onChange(); } }, [
              el("option", { value: "ORDER_DATE" }, ["ORDER_DATE"]),
              el("option", { value: "PROD_DONE" }, ["PROD_DONE"]),
              el("option", { value: "ETD" }, ["ETD"]),
              el("option", { value: "ETA" }, ["ETA"]),
            ]);
            select.value = ms.anchor || "ORDER_DATE";
            return select;
          })(),
        ]),
        el("td", {}, [
          el("input", {
            type: "number",
            value: String(ms.lagDays || 0),
            dataset: { field: "lag" },
            oninput: (e) => { ms.lagDays = Number(e.target.value || 0); onChange(); },
            onblur: (e) => {
              const next = Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : 0;
              e.target.value = String(next);
              ms.lagDays = next;
              onChange();
            },
          }),
        ]),
        el("td", { dataset: { role: "ms-date" } }, [dueIso ?? "—"]),
        el("td", { dataset: { role: "ms-amount" } }, [fmtEUR(amount)]),
        el("td", {}, [
          el("button", { class: "btn danger", onclick: () => { record.milestones.splice(index, 1); onChange(); } }, ["Entfernen"]),
        ]),
      ]);
    })),
  ]);

  container.append(table);

  const addBtn = el("button", {
    class: "btn",
    style: "margin-top:8px",
    onclick: () => {
      const nextIndex = (record.milestones || []).length;
      const id = Math.random().toString(36).slice(2, 9);
      record.milestones.push({ id, label: `Milestone ${nextIndex + 1}`, percent: 0, anchor: "ETA", lagDays: 0 });
      onChange({ focusInfo: { id, field: "label" } });
    },
  }, ["+ Zahlung hinzufügen"]);
  container.append(addBtn);

  const sum = msSum100(record.milestones);
  const warn = sum !== 100;
  const note = el("div", {
    dataset: { role: "ms-sum" },
    style: `margin-top:8px;font-weight:600;${warn ? "color:#c23636" : "color:#0f9960"}`,
  }, [warn ? `Summe: ${sum}% — Bitte auf 100% anpassen.` : "Summe: 100% ✓"]);
  container.append(note);

  if (focusInfo && focusInfo.id && focusInfo.field) {
    const target = container.querySelector(`[data-ms-id="${focusInfo.id}"] [data-field="${focusInfo.field}"]`);
    if (target) {
      target.focus();
      if (focusInfo.selectionStart != null && focusInfo.selectionEnd != null && target.setSelectionRange) {
        target.setSelectionRange(focusInfo.selectionStart, focusInfo.selectionEnd);
      }
    }
  }
}

export function renderOrderModule(root, config) {
  const state = loadState();
  if (!Array.isArray(state[config.entityKey])) state[config.entityKey] = [];

  const ids = {
    list: `${config.slug}-list`,
    number: `${config.slug}-number`,
    orderDate: `${config.slug}-order-date`,
    goods: `${config.slug}-goods`,
    prod: `${config.slug}-prod`,
    transport: `${config.slug}-transport`,
    transit: `${config.slug}-transit`,
    msZone: `${config.slug}-ms-zone`,
    preview: `${config.slug}-preview`,
    save: `${config.slug}-save`,
    create: `${config.slug}-create`,
    remove: `${config.slug}-remove`,
  };
  if (config.convertTo) {
    ids.convert = `${config.slug}-convert`;
  }

  root.innerHTML = `
    <section class="card">
      <h2>${config.listTitle}</h2>
      <div id="${ids.list}"></div>
    </section>
    <section class="card">
      <h3>${config.formTitle}</h3>
      <div class="grid two">
        <div>
          <label>${config.numberLabel}</label>
          <input id="${ids.number}" placeholder="${config.numberPlaceholder}" />
        </div>
        <div>
          <label>Bestelldatum</label>
          <input id="${ids.orderDate}" type="date" />
        </div>
        <div>
          <label>Warenwert (€)</label>
          <input id="${ids.goods}" placeholder="z. B. 8.000,00" />
        </div>
        <div>
          <label>Produktionstage</label>
          <input id="${ids.prod}" type="number" value="60" />
        </div>
        <div>
          <label>Transport</label>
          <select id="${ids.transport}">
            <option value="sea">Sea</option>
            <option value="rail">Rail</option>
            <option value="air">Air</option>
          </select>
        </div>
        <div>
          <label>Transit-Tage</label>
          <input id="${ids.transit}" type="number" value="60" />
        </div>
      </div>
      <div id="${ids.msZone}" style="margin-top:10px"></div>
      <div style="display:flex; gap:8px; margin-top:10px">
        <button class="btn" id="${ids.save}">Speichern</button>
        <button class="btn" id="${ids.create}">${config.newButtonLabel}</button>
        ${config.convertTo ? `<button class="btn secondary" id="${ids.convert}">${config.convertTo.buttonLabel || "In PO umwandeln"}</button>` : ""}
        <button class="btn danger" id="${ids.remove}">Löschen</button>
      </div>
      <div id="${ids.preview}" class="po-event-preview"></div>
    </section>
  `;

  const listZone = $(`#${ids.list}`, root);
  const numberInput = $(`#${ids.number}`, root);
  const orderDateInput = $(`#${ids.orderDate}`, root);
  const goodsInput = $(`#${ids.goods}`, root);
  const prodInput = $(`#${ids.prod}`, root);
  const transportSelect = $(`#${ids.transport}`, root);
  const transitInput = $(`#${ids.transit}`, root);
  const msZone = $(`#${ids.msZone}`, root);
  const saveBtn = $(`#${ids.save}`, root);
  const createBtn = $(`#${ids.create}`, root);
  const deleteBtn = $(`#${ids.remove}`, root);
  const preview = $(`#${ids.preview}`, root);
  const convertBtn = ids.convert ? $(`#${ids.convert}`, root) : null;

  let editing = defaultRecord(config);

  function updatePreview() {
    const draft = {
      id: editing.id,
      [config.numberField]: numberInput.value,
      orderDate: orderDateInput.value,
      goodsEur: goodsInput.value,
      prodDays: Number(prodInput.value || 0),
      transport: transportSelect.value,
      transitDays: Number(transitInput.value || 0),
      milestones: editing.milestones,
    };
    const events = orderEvents(draft, config);
    preview.innerHTML = "";
    preview.append(el("h4", {}, ["Ereignisse"]));
    preview.append(buildEventList(events));
  }

  function updateSaveEnabled() {
    const sum = (editing.milestones || []).reduce((acc, row) => acc + clampPct(row.percent || 0), 0);
    const ok = (Math.round(sum * 10) / 10 === 100)
      && (numberInput.value.trim() !== "")
      && (parseDE(goodsInput.value) > 0)
      && !!orderDateInput.value;
    saveBtn.disabled = !ok;
    if (convertBtn) convertBtn.disabled = !ok;
  }

  function syncEditingFromForm() {
    editing[config.numberField] = numberInput.value.trim();
    editing.orderDate = orderDateInput.value;
    editing.goodsEur = fmtCurrencyInput(goodsInput.value);
    editing.prodDays = Number(prodInput.value || 0);
    editing.transport = transportSelect.value;
    editing.transitDays = Number(transitInput.value || 0);
  }

  function onAnyChange(opts = {}) {
    let focusInfo = opts.focusInfo || null;
    if (!focusInfo) {
      const active = document.activeElement;
      if (active && active.closest && active.closest("[data-ms-id]")) {
        const row = active.closest("[data-ms-id]");
        focusInfo = {
          id: row?.dataset?.msId,
          field: active.dataset?.field || null,
          selectionStart: active.selectionStart,
          selectionEnd: active.selectionEnd,
        };
      }
    }
    syncEditingFromForm();
    if (!transitInput.value) {
      transitInput.value = editing.transport === "air" ? "10" : (editing.transport === "rail" ? "30" : "60");
    }
    syncEditingFromForm();
    renderMsTable(msZone, editing, onAnyChange, focusInfo);
    updatePreview();
    updateSaveEnabled();
  }

  function loadForm(record) {
    editing = JSON.parse(JSON.stringify(record));
    numberInput.value = editing[config.numberField] || "";
    orderDateInput.value = editing.orderDate || new Date().toISOString().slice(0, 10);
    goodsInput.value = fmtCurrencyInput(editing.goodsEur ?? "0,00");
    prodInput.value = String(editing.prodDays ?? 60);
    transportSelect.value = editing.transport || "sea";
    transitInput.value = String(editing.transitDays ?? (editing.transport === "air" ? 10 : editing.transport === "rail" ? 30 : 60));
    renderMsTable(msZone, editing, onAnyChange);
    updatePreview();
    updateSaveEnabled();
  }

  function saveRecord() {
    syncEditingFromForm();
    const st = loadState();
    const arr = Array.isArray(st[config.entityKey]) ? st[config.entityKey] : [];
    const idx = arr.findIndex(item => (item.id && item.id === editing.id)
      || (item[config.numberField] && item[config.numberField] === editing[config.numberField]));
    if (idx >= 0) arr[idx] = editing;
    else arr.push(editing);
    st[config.entityKey] = arr;
    saveState(st);
    renderList(listZone, st[config.entityKey], config, onEdit, onDelete);
    window.dispatchEvent(new Event("state:changed"));
  }

  function convertRecord() {
    if (!config.convertTo) return;
    syncEditingFromForm();
    if (saveBtn.disabled) {
      window.alert("Bitte gültige Daten eingeben, bevor die FO umgewandelt wird.");
      return;
    }

    saveRecord();

    const st = loadState();
    if (!Array.isArray(st[config.convertTo.entityKey])) st[config.convertTo.entityKey] = [];

    const existing = st[config.convertTo.entityKey];
    const info = highestNumberInfo(existing, config.convertTo.numberField);
    const label = config.convertTo.targetLabel || config.convertTo.numberField || "PO";
    const intro = info.raw
      ? `Aktuell höchste ${label}-Nummer: ${info.raw}`
      : `Es existiert noch keine ${label}-Nummer.`;
    const suggestion = info.next || "";
    const input = window.prompt(`${intro}\nBitte neue ${label}-Nummer eingeben:`, suggestion);
    if (input == null) return;
    const trimmed = input.trim();
    if (!trimmed) {
      window.alert("Bitte eine gültige Nummer eingeben.");
      return;
    }

    const clash = existing.some(item => (item?.[config.convertTo.numberField] || "").toLowerCase() === trimmed.toLowerCase());
    if (clash) {
      window.alert(`${label}-Nummer ${trimmed} ist bereits vergeben.`);
      return;
    }

    const copy = JSON.parse(JSON.stringify(editing));
    const newRecord = {
      ...copy,
      id: Math.random().toString(36).slice(2, 9),
      [config.convertTo.numberField]: trimmed,
    };
    delete newRecord[config.numberField];

    existing.push(newRecord);
    saveState(st);
    window.dispatchEvent(new Event("state:changed"));
    window.alert(`${label} ${trimmed} wurde angelegt.`);
  }

  function onEdit(record) {
    loadForm(record);
  }

  function onDelete(record) {
    const st = loadState();
    const arr = Array.isArray(st[config.entityKey]) ? st[config.entityKey] : [];
    st[config.entityKey] = arr.filter(item => {
      if (item.id && record.id) return item.id !== record.id;
      return item[config.numberField] !== record[config.numberField];
    });
    saveState(st);
    renderList(listZone, st[config.entityKey], config, onEdit, onDelete);
    loadForm(defaultRecord(config));
    window.dispatchEvent(new Event("state:changed"));
  }

  goodsInput.addEventListener("input", onAnyChange);
  goodsInput.addEventListener("blur", () => {
    goodsInput.value = fmtCurrencyInput(goodsInput.value);
    onAnyChange();
  });
  prodInput.addEventListener("input", (e) => { editing.prodDays = Number(e.target.value || 0); onAnyChange(); });
  transportSelect.addEventListener("change", (e) => {
    editing.transport = e.target.value;
    if (editing.transport === "air") editing.transitDays = 10;
    if (editing.transport === "rail") editing.transitDays = 30;
    if (editing.transport === "sea") editing.transitDays = 60;
    transitInput.value = String(editing.transitDays);
    onAnyChange();
  });
  transitInput.addEventListener("input", (e) => { editing.transitDays = Number(e.target.value || 0); onAnyChange(); });
  numberInput.addEventListener("input", onAnyChange);
  orderDateInput.addEventListener("input", onAnyChange);

  saveBtn.addEventListener("click", saveRecord);
  createBtn.addEventListener("click", () => loadForm(defaultRecord(config)));
  deleteBtn.addEventListener("click", () => onDelete(editing));
  if (convertBtn) convertBtn.addEventListener("click", convertRecord);

  renderList(listZone, state[config.entityKey], config, onEdit, onDelete);
  loadForm(defaultRecord(config));
}

export const orderEditorUtils = {
  parseDE,
  fmtEUR,
  fmtCurrencyInput,
  fmtPercent,
  clampPct,
  defaultRecord,
};
