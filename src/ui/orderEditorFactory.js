import { loadState, saveState, getStatusSnapshot, setEventManualPaid } from "../data/storageLocal.js";

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

function fmtUSD(value) {
  return Number(value || 0).toLocaleString("de-DE", {
    style: "currency",
    currency: "USD",
  });
}

function fmtPercent(value) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : parseDE(value);
  return Number(numeric || 0).toLocaleString("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function fmtFxRate(value) {
  const numeric = typeof value === "number" ? value : parseDE(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  return Number(numeric).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

function fmtDateDE(input) {
  if (!input) return "—";
  let date;
  if (typeof input === "string") {
    const parts = input.split("-");
    if (parts.length === 3) {
      const [y, m, d] = parts.map(Number);
      if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
        date = new Date(Date.UTC(y, m - 1, d));
      }
    }
  } else if (input instanceof Date) {
    date = input;
  }

  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function clampPct(value) {
  const pct = parseDE(value);
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}

function computeGoodsTotals(record, settings = getSettings()) {
  const unitsRaw = record?.units;
  const units = Number(
    typeof unitsRaw === "number"
      ? unitsRaw
      : parseDE(unitsRaw)
  );
  const unitCost = parseDE(record?.unitCostUsd);
  const unitExtra = parseDE(record?.unitExtraUsd);
  const extraFlat = parseDE(record?.extraFlatUsd);
  const unitCount = Number.isFinite(units) ? units : 0;
  const rawUsd = (unitCost + unitExtra) * unitCount + extraFlat;
  const totalUsd = Math.max(0, Math.round(rawUsd * 100) / 100);
  let fxRate = settings?.fxRate || 0;
  if (record && record.fxOverride != null && record.fxOverride !== "") {
    const override = typeof record.fxOverride === "number" ? record.fxOverride : parseDE(record.fxOverride);
    if (Number.isFinite(override) && override > 0) fxRate = override;
  }
  const fallbackEur = parseDE(record?.goodsEur);
  const totalEur = fxRate > 0 ? Math.round((totalUsd / fxRate) * 100) / 100 : (Number.isFinite(fallbackEur) ? Math.round(fallbackEur * 100) / 100 : 0);
  return {
    usd: totalUsd,
    eur: totalEur,
    fxRate,
    units: Number.isFinite(units) ? units : 0,
    unitCost,
    unitExtra,
    extraFlat,
  };
}

function normaliseGoodsFields(record, settings = getSettings()) {
  if (!record) return;
  if (record.unitCostUsd == null) record.unitCostUsd = "0,00";
  if (record.unitExtraUsd == null) record.unitExtraUsd = "0,00";
  if (record.units == null) record.units = "0";
  if (record.extraFlatUsd == null) record.extraFlatUsd = "0,00";
  if (record.fxOverride != null && record.fxOverride !== "") {
    const override = typeof record.fxOverride === "number" ? record.fxOverride : parseDE(record.fxOverride);
    record.fxOverride = Number.isFinite(override) && override > 0 ? override : null;
  }

  const totals = computeGoodsTotals(record, settings);
  const existingGoods = parseDE(record.goodsEur);
  if (totals.usd === 0 && existingGoods > 0) {
    const fxRate = totals.fxRate || settings?.fxRate || 0;
    const approxUsd = fxRate > 0 ? existingGoods * fxRate : existingGoods;
    record.unitCostUsd = fmtCurrencyInput(approxUsd);
    record.unitExtraUsd = "0,00";
    record.extraFlatUsd = "0,00";
    record.units = "1";
  }

  const recalculated = computeGoodsTotals(record, settings);
  record.goodsEur = fmtCurrencyInput(recalculated.eur);
  record.goodsUsd = fmtCurrencyInput(recalculated.usd);
  record.goodsValueUsd = recalculated.usd;
}

function getSettings() {
  const state = loadState();
  const raw = (state && state.settings) || {};
  return {
    fxRate: parseDE(raw.fxRate ?? 0) || 0,
    fxFeePct: parseDE(raw.fxFeePct ?? 0) || 0,
    dutyRatePct: parseDE(raw.dutyRatePct ?? 0) || 0,
    dutyIncludeFreight: raw.dutyIncludeFreight !== false,
    eustRatePct: parseDE(raw.eustRatePct ?? 0) || 0,
    vatRefundEnabled: raw.vatRefundEnabled !== false,
    vatRefundLagMonths: Number(raw.vatRefundLagMonths ?? 0) || 0,
    freightLagDays: Number(raw.freightLagDays ?? 0) || 0,
  };
}

function addMonths(date, months) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const target = new Date(Date.UTC(year, month + months, 1));
  return target;
}

function monthEnd(date) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  return new Date(Date.UTC(year, month + 1, 0));
}

function ensureAutoEvents(record, settings, manualMilestones = []) {
  if (!record.autoEvents) record.autoEvents = [];
  const map = new Map(record.autoEvents.map(evt => [evt.type, evt]));
  const ensure = (type, defaults) => {
    if (!map.has(type)) {
      const created = { id: `auto-${type}`, type, ...defaults };
      record.autoEvents.push(created);
      map.set(type, created);
    } else {
      const current = map.get(type);
      Object.assign(current, { type, ...defaults, ...current });
    }
    return map.get(type);
  };

  ensure("duty", {
    label: "Zoll",
    percent: settings.dutyRatePct || 0,
    anchor: "ETA",
    lagDays: settings.freightLagDays || 0,
    enabled: true,
  });

  ensure("eust", {
    label: "EUSt",
    percent: settings.eustRatePct || 0,
    anchor: "ETA",
    lagDays: settings.freightLagDays || 0,
    enabled: true,
  });

  ensure("vat_refund", {
    label: "EUSt-Erstattung",
    percent: 100,
    anchor: "ETA",
    lagMonths: settings.vatRefundLagMonths || 0,
    enabled: settings.vatRefundEnabled !== false,
  });

  const firstMs = manualMilestones[0];
  ensure("fx_fee", {
    label: "FX-Gebühr",
    percent: settings.fxFeePct || 0,
    anchor: firstMs?.anchor || "ORDER_DATE",
    lagDays: firstMs?.lagDays || 0,
    enabled: settings.fxFeePct > 0,
  });

  record.autoEvents = [
    "duty",
    "eust",
    "vat_refund",
    "fx_fee",
  ].map(type => map.get(type)).filter(Boolean);

  if (record.ddp) {
    for (const evt of record.autoEvents) {
      if (evt.type === "duty" || evt.type === "eust" || evt.type === "vat_refund") {
        if (evt.enabled !== false) evt._ddpEnabledBackup = evt.enabled !== false;
        evt.enabled = false;
      }
    }
  } else {
    for (const evt of record.autoEvents) {
      if ((evt.type === "duty" || evt.type === "eust" || evt.type === "vat_refund") && evt._ddpEnabledBackup != null) {
        evt.enabled = evt._ddpEnabledBackup;
        delete evt._ddpEnabledBackup;
      }
    }
  }

  return record.autoEvents;
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

function defaultRecord(config, settings = getSettings()) {
  const today = new Date().toISOString().slice(0, 10);
  const record = {
    id: Math.random().toString(36).slice(2, 9),
    [config.numberField]: "",
    orderDate: today,
    unitCostUsd: "0,00",
    unitExtraUsd: "0,00",
    units: "0",
    extraFlatUsd: "0,00",
    goodsEur: "0,00",
    fxOverride: settings.fxRate || null,
    freightEur: "0,00",
    prodDays: 60,
    transport: "sea",
    transitDays: 60,
    ddp: false,
    dutyRatePct: settings.dutyRatePct || 0,
    dutyIncludeFreight: settings.dutyIncludeFreight !== false,
    eustRatePct: settings.eustRatePct || 0,
    vatRefundLagMonths: settings.vatRefundLagMonths || 0,
    vatRefundEnabled: settings.vatRefundEnabled !== false,
    fxFeePct: settings.fxFeePct || 0,
    milestones: [
      { id: Math.random().toString(36).slice(2, 9), label: "Deposit", percent: 30, anchor: "ORDER_DATE", lagDays: 0 },
      { id: Math.random().toString(36).slice(2, 9), label: "Balance", percent: 70, anchor: "PROD_DONE", lagDays: 0 },
    ],
  };
  ensureAutoEvents(record, settings, record.milestones);
  normaliseGoodsFields(record, settings);
  return record;
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

function orderEvents(record, config, settings) {
  const totals = computeGoodsTotals(record, settings);
  let goods = totals.eur;
  if (!goods) {
    const fallback = parseDE(record.goodsEur);
    if (fallback) goods = fallback;
  }
  const freight = parseDE(record.freightEur);
  const prefix = record[config.numberField] ? `${config.entityLabel} ${record[config.numberField]} – ` : "";
  const manual = Array.isArray(record.milestones) ? record.milestones : [];
  const auto = ensureAutoEvents(record, settings, manual);

  const events = [];
  const base = {
    orderDate: record.orderDate,
    prodDays: Number(record.prodDays || 0),
    transport: record.transport,
    transitDays: Number(record.transitDays || 0),
  };

  const manualComputed = manual.map(m => {
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
      type: "manual",
      due,
      auto: false,
      direction: amount <= 0 ? "out" : "in",
    };
  }).filter(Boolean);

  events.push(...manualComputed.map(evt => ({
    id: evt.id,
    label: evt.label,
    date: evt.date,
    amount: evt.amount,
    type: evt.type,
    auto: false,
    due: evt.due,
    direction: evt.direction,
  })));

  const dutyIncludeFreight = record.dutyIncludeFreight !== false;
  const stateDutyRate = typeof record.dutyRatePct === "number" ? record.dutyRatePct : clampPct(record.dutyRatePct);
  const stateEustRate = typeof record.eustRatePct === "number" ? record.eustRatePct : clampPct(record.eustRatePct);
  const stateFxFee = typeof record.fxFeePct === "number" ? record.fxFeePct : clampPct(record.fxFeePct);
  const vatLagMonths = Number(record.vatRefundLagMonths ?? settings.vatRefundLagMonths ?? 0) || 0;

  const autoResults = {};
  for (const autoEvt of auto) {
    if (!autoEvt || autoEvt.enabled === false) continue;
    const anchor = autoEvt.anchor || "ETA";
    const baseDate = anchorDate(base, anchor);
    if (!(baseDate instanceof Date) || Number.isNaN(baseDate.getTime())) continue;

    if (autoEvt.type === "duty") {
      const percent = clampPct(autoEvt.percent ?? stateDutyRate ?? settings.dutyRatePct ?? 0);
      const baseValue = goods + (dutyIncludeFreight ? freight : 0);
      const due = addDays(baseDate, Number(autoEvt.lagDays || 0));
      const amount = -(baseValue * (percent / 100));
      const dueIso = isoDate(due);
      if (!dueIso) continue;
      autoResults.duty = { amount, due };
      events.push({
        id: autoEvt.id,
        label: `${prefix}${autoEvt.label || "Zoll"}`.trim(),
        date: dueIso,
        amount,
        type: "duty",
        auto: true,
        due,
        direction: amount <= 0 ? "out" : "in",
      });
      continue;
    }

    if (autoEvt.type === "eust") {
      const percent = clampPct(autoEvt.percent ?? stateEustRate ?? settings.eustRatePct ?? 0);
      const dutyAbs = Math.abs(autoResults.duty?.amount || 0);
      const baseValue = goods + freight + dutyAbs;
      const due = addDays(baseDate, Number(autoEvt.lagDays || 0));
      const amount = -(baseValue * (percent / 100));
      const dueIso = isoDate(due);
      if (!dueIso) continue;
      autoResults.eust = { amount, due };
      events.push({
        id: autoEvt.id,
        label: `${prefix}${autoEvt.label || "EUSt"}`.trim(),
        date: dueIso,
        amount,
        type: "eust",
        auto: true,
        due,
        direction: amount <= 0 ? "out" : "in",
      });
      continue;
    }

    if (autoEvt.type === "vat_refund") {
      const eust = autoResults.eust;
      if (!eust || eust.amount === 0 || record.vatRefundEnabled === false) continue;
      const percent = clampPct(autoEvt.percent ?? 100);
      const months = Number((autoEvt.lagMonths ?? vatLagMonths) || 0);
      const baseDay = addDays(eust.due || baseDate, Number(autoEvt.lagDays || 0));
      const shifted = addMonths(baseDay, months);
      const due = monthEnd(shifted);
      const dueIso = isoDate(due);
      if (!dueIso) continue;
      const amount = Math.abs(eust.amount) * (percent / 100);
      autoResults.vat = { amount, due };
      events.push({
        id: autoEvt.id,
        label: `${prefix}${autoEvt.label || "EUSt-Erstattung"}`.trim(),
        date: dueIso,
        amount,
        type: "vat_refund",
        auto: true,
        due,
        direction: amount <= 0 ? "out" : "in",
      });
      continue;
    }

    if (autoEvt.type === "fx_fee") {
      const percent = clampPct(autoEvt.percent ?? stateFxFee ?? settings.fxFeePct ?? 0);
      const due = addDays(baseDate, Number(autoEvt.lagDays || 0));
      const dueIso = isoDate(due);
      if (!dueIso) continue;
      const amount = -(goods * (percent / 100));
      events.push({
        id: autoEvt.id,
        label: `${prefix}${autoEvt.label || "FX"}`.trim(),
        date: dueIso,
        amount,
        type: "fx_fee",
        auto: true,
        due,
        direction: amount <= 0 ? "out" : "in",
      });
      continue;
    }
  }

  return events
    .filter(evt => evt && Number.isFinite(evt.amount))
    .sort((a, b) => (a.date === b.date ? (a.label || "").localeCompare(b.label || "") : a.date.localeCompare(b.date)));
}

function buildEventList(events, onStatusChange) {
  const wrapper = el("div", { class: "po-event-table" });
  if (!events.length) {
    wrapper.append(el("div", { class: "muted" }, ["Keine Ereignisse definiert."]));
    return wrapper;
  }
  const status = getStatusSnapshot();
  const statusMap = status.events || {};
  const autoManual = status.autoManualCheck === true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTime = today.getTime();
  wrapper.append(
    el("div", { class: "po-event-head" }, [
      el("span", { class: "po-event-col" }, ["Name"]),
      el("span", { class: "po-event-col" }, ["Datum"]),
      el("span", { class: "po-event-col amount" }, ["Betrag"]),
      el("span", { class: "po-event-col status" }, ["Bezahlt"]),
    ]),
  );
  for (const evt of events) {
    const statusRec = statusMap[evt.id] || {};
    const manual = typeof statusRec.manual === "boolean" ? statusRec.manual : undefined;
    const baseDue = evt.due instanceof Date ? evt.due : (evt.date ? new Date(evt.date) : null);
    const dueTime = baseDue && !Number.isNaN(baseDue.getTime())
      ? new Date(baseDue.getFullYear(), baseDue.getMonth(), baseDue.getDate()).getTime()
      : null;
    const isAuto = evt.auto === true;
    let autoApplied = false;
    let checked;
    if (typeof manual === "boolean") {
      checked = manual;
    } else if (isAuto && !autoManual && dueTime != null && dueTime <= todayTime) {
      checked = true;
      autoApplied = true;
    } else {
      checked = false;
    }
    const checkbox = el("input", {
      type: "checkbox",
      class: "po-paid-checkbox",
      dataset: { eventId: evt.id },
    });
    checkbox.checked = checked;
    checkbox.setAttribute("aria-label", autoApplied ? "Automatisch bezahlt" : "Bezahlt");
    checkbox.addEventListener("change", (ev) => {
      setEventManualPaid(evt.id, ev.target.checked);
      if (typeof onStatusChange === "function") onStatusChange();
    });
    const autoTooltip = (() => {
      if (!isAuto) return null;
      if (autoApplied) return "Automatisch bezahlt am Fälligkeitstag";
      if (autoManual) return "Automatische Zahlung – manuelle Prüfung aktiv";
      return "Automatische Zahlung";
    })();
    const labelWrap = el("label", {
      class: "po-paid-toggle",
      title: autoTooltip || undefined,
    }, [checkbox]);
    if (autoTooltip) {
      labelWrap.append(el("span", { class: "po-auto-indicator", "aria-hidden": "true" }, [autoApplied ? "⏱" : "ⓘ"]));
    }
    wrapper.append(
      el("div", { class: "po-event-row" }, [
        el("span", { class: "po-event-col" }, [evt.label]),
        el("span", { class: "po-event-col" }, [fmtDateDE(evt.due || evt.date)]),
        el("span", { class: "po-event-col amount" }, [fmtEUR(evt.amount)]),
        el("span", { class: "po-event-col status" }, [labelWrap]),
      ]),
    );
  }
  return wrapper;
}

function renderList(container, records, config, onEdit, onDelete) {
  container.innerHTML = "";
  const settings = getSettings();
  const rows = Array.isArray(records) ? records : [];
  for (const rec of rows) normaliseGoodsFields(rec, settings);
  const table = el("table", {}, [
    el("thead", {}, [
      el("tr", {}, [
        el("th", {}, [`${config.entityLabel}-Nr.`]),
        el("th", {}, ["Order"]),
        el("th", {}, ["Stück"]),
        el("th", {}, ["Summe USD"]),
        el("th", {}, ["Zahlungen"]),
        el("th", {}, ["Transport"]),
        el("th", {}, ["Aktionen"]),
      ]),
    ]),
    el("tbody", {}, rows.map(rec =>
      el("tr", {}, [
        el("td", {}, [rec[config.numberField] || "—"]),
        el("td", {}, [fmtDateDE(rec.orderDate)]),
        el("td", {}, [Number(parseDE(rec.units ?? 0) || 0).toLocaleString("de-DE")]),
        el("td", {}, [fmtUSD(computeGoodsTotals(rec, settings).usd)]),
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

function renderMsTable(container, record, config, onChange, focusInfo, settings) {
  container.innerHTML = "";
  container.append(el("div", { class: "muted", style: "margin-bottom:6px" }, ["Zahlungsmeilensteine & Importkosten"]));

  ensureAutoEvents(record, settings, record.milestones || []);
  const previewEvents = orderEvents(JSON.parse(JSON.stringify(record)), config, settings);
  const previewMap = new Map(previewEvents.map(evt => [evt.id, evt]));

  const table = el("table", {}, [
    el("thead", {}, [
      el("tr", {}, [
        el("th", {}, ["Label"]),
        el("th", {}, ["%"]),
        el("th", {}, ["Anker"]),
        el("th", {}, ["Lag"]),
        el("th", {}, ["Datum"]),
        el("th", {}, ["Betrag (€)"]),
        el("th", {}, ["Aktion"]),
      ]),
    ]),
  ]);

  const tbody = el("tbody", {});
  table.append(tbody);

  const totals = computeGoodsTotals(record, settings);
  const goods = totals.eur || parseDE(record.goodsEur);

  (record.milestones || []).forEach((ms, index) => {
    const computed = previewMap.get(ms.id);
    const dueText = fmtDateDE(computed?.due || computed?.date);
    const amount = computed?.amount ?? -(goods * (clampPct(ms.percent) / 100));

    const row = el("tr", { dataset: { msId: ms.id } }, [
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
      el("td", { dataset: { role: "ms-date" } }, [dueText]),
      el("td", { dataset: { role: "ms-amount" } }, [fmtEUR(amount)]),
      el("td", {}, [
        el("button", { class: "btn danger", onclick: () => { record.milestones.splice(index, 1); onChange(); } }, ["Entfernen"]),
      ]),
    ]);
    tbody.append(row);
  });

  (record.autoEvents || []).forEach((autoEvt) => {
    const computed = previewMap.get(autoEvt.id);
    const dueText = fmtDateDE(computed?.due || computed?.date);
    const amount = computed?.amount ?? 0;
    const active = autoEvt.enabled !== false;
    const lagValue = autoEvt.type === "vat_refund"
      ? Number(autoEvt.lagMonths ?? record.vatRefundLagMonths ?? settings.vatRefundLagMonths ?? 0)
      : Number(autoEvt.lagDays || 0);

    const row = el("tr", { dataset: { msId: autoEvt.id }, class: `auto-ms${active ? "" : " disabled"}` }, [
      el("td", {}, [
        el("input", {
          value: autoEvt.label || "",
          dataset: { field: "label" },
          oninput: (e) => { autoEvt.label = e.target.value; onChange(); },
          onblur: (e) => { autoEvt.label = e.target.value.trim(); onChange(); },
        }),
      ]),
      el("td", {}, [
        el("input", {
          type: "text",
          inputmode: "decimal",
          value: fmtPercent(autoEvt.percent ?? 0),
          dataset: { field: "percent" },
          oninput: (e) => { autoEvt.percent = e.target.value; onChange(); },
          onblur: (e) => {
            const next = clampPct(e.target.value);
            autoEvt.percent = next;
            e.target.value = fmtPercent(next);
            onChange();
          },
        }),
      ]),
      el("td", {}, [
        (() => {
          const select = el("select", { dataset: { field: "anchor" }, onchange: (e) => { autoEvt.anchor = e.target.value; onChange(); } }, [
            el("option", { value: "ORDER_DATE" }, ["ORDER_DATE"]),
            el("option", { value: "PROD_DONE" }, ["PROD_DONE"]),
            el("option", { value: "ETD" }, ["ETD"]),
            el("option", { value: "ETA" }, ["ETA"]),
          ]);
          select.value = autoEvt.anchor || "ETA";
          return select;
        })(),
      ]),
      el("td", {}, [
        autoEvt.type === "vat_refund"
          ? el("input", {
              type: "number",
              min: "0",
              value: String(lagValue),
              dataset: { field: "lagMonths" },
              oninput: (e) => { autoEvt.lagMonths = Number(e.target.value || 0); onChange(); },
            })
          : el("input", {
              type: "number",
              value: String(lagValue),
              dataset: { field: "lag" },
              oninput: (e) => { autoEvt.lagDays = Number(e.target.value || 0); onChange(); },
              onblur: (e) => {
                const next = Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : 0;
                e.target.value = String(next);
                autoEvt.lagDays = next;
                onChange();
              },
            }),
      ]),
      el("td", { dataset: { role: "ms-date" } }, [dueText]),
      el("td", { dataset: { role: "ms-amount" } }, [fmtEUR(amount)]),
      el("td", {}, [
        el("label", { class: "inline-checkbox" }, [
          el("input", {
            type: "checkbox",
            checked: active,
            onchange: (e) => {
              const checked = e.target.checked;
              autoEvt.enabled = checked;
              if (!checked) autoEvt._ddpEnabledBackup = false;
              else delete autoEvt._ddpEnabledBackup;
              onChange();
            },
          }),
          " Aktiv",
        ]),
      ]),
    ]);

    tbody.append(row);
  });

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
  const initialSettings = getSettings();
  state[config.entityKey].forEach(rec => normaliseGoodsFields(rec, initialSettings));

  const ids = {
    list: `${config.slug}-list`,
    number: `${config.slug}-number`,
    orderDate: `${config.slug}-order-date`,
    unitCost: `${config.slug}-unit-cost`,
    unitExtra: `${config.slug}-unit-extra`,
    units: `${config.slug}-units`,
    extraFlat: `${config.slug}-extra-flat`,
    goodsSummary: `${config.slug}-goods-summary`,
    fxRate: `${config.slug}-fx-rate`,
    freight: `${config.slug}-freight`,
    prod: `${config.slug}-prod`,
    transport: `${config.slug}-transport`,
    transit: `${config.slug}-transit`,
    dutyRate: `${config.slug}-duty-rate`,
    dutyInclude: `${config.slug}-duty-include`,
    eustRate: `${config.slug}-eust-rate`,
    fxFee: `${config.slug}-fx-fee`,
    vatLag: `${config.slug}-vat-lag`,
    vatToggle: `${config.slug}-vat-toggle`,
    ddp: `${config.slug}-ddp`,
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
      </div>
      <div class="grid two" style="margin-top:12px">
        <div>
          <label>Stückkosten (USD)</label>
          <input id="${ids.unitCost}" placeholder="z. B. 12,50" inputmode="decimal" />
        </div>
        <div>
          <label>Zusatzkosten je Stück (USD)</label>
          <input id="${ids.unitExtra}" placeholder="z. B. 0,80" inputmode="decimal" />
        </div>
        <div>
          <label>Stückzahl</label>
          <input id="${ids.units}" type="number" min="0" step="1" />
        </div>
        <div>
          <label>Zusatzkosten pauschal (USD)</label>
          <input id="${ids.extraFlat}" placeholder="z. B. 150,00" inputmode="decimal" />
        </div>
      </div>
      <div class="po-goods-summary" id="${ids.goodsSummary}">Summe Warenwert: 0,00 € (0,00 USD)</div>
      <div class="grid two" style="margin-top:12px">
        <div>
          <label>FX-Kurs (USD → EUR)</label>
          <input id="${ids.fxRate}" placeholder="z. B. 1,08" inputmode="decimal" />
        </div>
      </div>
      <div class="grid two" style="margin-top:12px">
        <div>
          <label>Fracht (€)</label>
          <input id="${ids.freight}" placeholder="z. B. 4.800,00" />
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
      <div class="grid two" style="margin-top:12px">
        <div>
          <label>Zollsatz (%)</label>
          <input id="${ids.dutyRate}" placeholder="z. B. 6,5" />
          <label class="inline-checkbox"><input type="checkbox" id="${ids.dutyInclude}" /> Freight einbeziehen</label>
        </div>
        <div>
          <label>EUSt (%)</label>
          <input id="${ids.eustRate}" placeholder="z. B. 19" />
        </div>
        <div>
          <label>FX-Gebühr (%)</label>
          <input id="${ids.fxFee}" placeholder="z. B. 0,5" />
        </div>
        <div>
          <label>EUSt-Erstattung (Monate)</label>
          <input id="${ids.vatLag}" type="number" min="0" step="1" />
          <label class="inline-checkbox"><input type="checkbox" id="${ids.vatToggle}" /> Erstattung aktiv</label>
        </div>
        <div class="checkbox-line">
          <label><input type="checkbox" id="${ids.ddp}" /> DDP (Importkosten enthalten)</label>
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
  const unitCostInput = $(`#${ids.unitCost}`, root);
  const unitExtraInput = $(`#${ids.unitExtra}`, root);
  const unitsInput = $(`#${ids.units}`, root);
  const extraFlatInput = $(`#${ids.extraFlat}`, root);
  const goodsSummary = $(`#${ids.goodsSummary}`, root);
  const fxRateInput = $(`#${ids.fxRate}`, root);
  const freightInput = $(`#${ids.freight}`, root);
  const prodInput = $(`#${ids.prod}`, root);
  const transportSelect = $(`#${ids.transport}`, root);
  const transitInput = $(`#${ids.transit}`, root);
  const dutyRateInput = $(`#${ids.dutyRate}`, root);
  const dutyIncludeToggle = $(`#${ids.dutyInclude}`, root);
  const eustRateInput = $(`#${ids.eustRate}`, root);
  const fxFeeInput = $(`#${ids.fxFee}`, root);
  const vatLagInput = $(`#${ids.vatLag}`, root);
  const vatToggle = $(`#${ids.vatToggle}`, root);
  const ddpToggle = $(`#${ids.ddp}`, root);
  const msZone = $(`#${ids.msZone}`, root);
  const saveBtn = $(`#${ids.save}`, root);
  const createBtn = $(`#${ids.create}`, root);
  const deleteBtn = $(`#${ids.remove}`, root);
  const preview = $(`#${ids.preview}`, root);
  const convertBtn = ids.convert ? $(`#${ids.convert}`, root) : null;

  let editing = defaultRecord(config, getSettings());

  function updatePreview(settings) {
    syncEditingFromForm(settings);
    const draft = JSON.parse(JSON.stringify({
      ...editing,
      [config.numberField]: numberInput.value,
      orderDate: orderDateInput.value,
      unitCostUsd: unitCostInput.value,
      unitExtraUsd: unitExtraInput.value,
      units: unitsInput.value,
      extraFlatUsd: extraFlatInput.value,
      prodDays: Number(prodInput.value || 0),
      transport: transportSelect.value,
      transitDays: Number(transitInput.value || 0),
    }));
    normaliseGoodsFields(draft, settings);
    const events = orderEvents(draft, config, settings);
    preview.innerHTML = "";
    preview.append(el("h4", {}, ["Ereignisse"]));
    preview.append(buildEventList(events, () => updatePreview(settings)));
  }

  function updateSaveEnabled() {
    const sum = (editing.milestones || []).reduce((acc, row) => acc + clampPct(row.percent || 0), 0);
    const ok = (Math.round(sum * 10) / 10 === 100)
      && (numberInput.value.trim() !== "")
      && (computeGoodsTotals(editing, getSettings()).usd > 0)
      && !!orderDateInput.value;
    saveBtn.disabled = !ok;
    if (convertBtn) convertBtn.disabled = !ok;
  }

  function updateGoodsSummary(totals) {
    if (!goodsSummary) return;
    const eurText = fmtEUR(totals.eur || 0);
    const usdText = fmtUSD(totals.usd || 0);
    const fxText = fmtFxRate(totals.fxRate);
    goodsSummary.textContent = fxText
      ? `Summe Warenwert: ${eurText} (${usdText} ÷ FX ${fxText})`
      : `Summe Warenwert: ${eurText} (${usdText})`;
  }

  function syncEditingFromForm(settings = getSettings()) {
    editing[config.numberField] = numberInput.value.trim();
    editing.orderDate = orderDateInput.value;
    editing.unitCostUsd = fmtCurrencyInput(unitCostInput.value);
    editing.unitExtraUsd = fmtCurrencyInput(unitExtraInput.value);
    editing.units = unitsInput.value || "0";
    editing.extraFlatUsd = fmtCurrencyInput(extraFlatInput.value);
    const fxOverrideValue = parseDE(fxRateInput?.value ?? "");
    editing.fxOverride = Number.isFinite(fxOverrideValue) && fxOverrideValue > 0 ? fxOverrideValue : null;
    normaliseGoodsFields(editing, settings);
    const totals = computeGoodsTotals(editing, settings);
    updateGoodsSummary(totals);
    editing.freightEur = fmtCurrencyInput(freightInput.value);
    editing.prodDays = Number(prodInput.value || 0);
    editing.transport = transportSelect.value;
    editing.transitDays = Number(transitInput.value || 0);
    editing.dutyRatePct = clampPct(dutyRateInput.value);
    editing.dutyIncludeFreight = dutyIncludeToggle.checked;
    editing.eustRatePct = clampPct(eustRateInput.value);
    editing.fxFeePct = clampPct(fxFeeInput.value);
    editing.vatRefundLagMonths = Number(vatLagInput.value || 0);
    editing.vatRefundEnabled = vatToggle.checked;
    editing.ddp = ddpToggle.checked;
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
    const settings = getSettings();
    syncEditingFromForm(settings);
    if (!transitInput.value) {
      transitInput.value = editing.transport === "air" ? "10" : (editing.transport === "rail" ? "30" : "60");
    }
    syncEditingFromForm(settings);
    ensureAutoEvents(editing, settings, editing.milestones);
    renderMsTable(msZone, editing, config, onAnyChange, focusInfo, settings);
    updatePreview(settings);
    updateSaveEnabled();
  }

  function loadForm(record) {
    const settings = getSettings();
    editing = JSON.parse(JSON.stringify(record));
    normaliseGoodsFields(editing, settings);
    ensureAutoEvents(editing, settings, editing.milestones);
    numberInput.value = editing[config.numberField] || "";
    orderDateInput.value = editing.orderDate || new Date().toISOString().slice(0, 10);
    unitCostInput.value = fmtCurrencyInput(editing.unitCostUsd ?? "0,00");
    unitExtraInput.value = fmtCurrencyInput(editing.unitExtraUsd ?? "0,00");
    unitsInput.value = String(editing.units ?? "0");
    extraFlatInput.value = fmtCurrencyInput(editing.extraFlatUsd ?? "0,00");
    const fxBase = editing.fxOverride ?? settings.fxRate ?? 0;
    if (fxRateInput) fxRateInput.value = fxBase ? fmtFxRate(fxBase) : "";
    updateGoodsSummary(computeGoodsTotals(editing, settings));
    freightInput.value = fmtCurrencyInput(editing.freightEur ?? "0,00");
    prodInput.value = String(editing.prodDays ?? 60);
    transportSelect.value = editing.transport || "sea";
    transitInput.value = String(editing.transitDays ?? (editing.transport === "air" ? 10 : editing.transport === "rail" ? 30 : 60));
    dutyRateInput.value = fmtPercent(editing.dutyRatePct ?? settings.dutyRatePct ?? 0);
    dutyIncludeToggle.checked = editing.dutyIncludeFreight !== false;
    eustRateInput.value = fmtPercent(editing.eustRatePct ?? settings.eustRatePct ?? 0);
    fxFeeInput.value = fmtPercent(editing.fxFeePct ?? settings.fxFeePct ?? 0);
    vatLagInput.value = String(editing.vatRefundLagMonths ?? settings.vatRefundLagMonths ?? 0);
    vatToggle.checked = editing.vatRefundEnabled !== false;
    ddpToggle.checked = !!editing.ddp;
    renderMsTable(msZone, editing, config, onAnyChange, null, settings);
    updatePreview(settings);
    updateSaveEnabled();
  }

  function saveRecord() {
    const settings = getSettings();
    syncEditingFromForm(settings);
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
    const settings = getSettings();
    syncEditingFromForm(settings);
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
    loadForm(defaultRecord(config, getSettings()));
    window.dispatchEvent(new Event("state:changed"));
  }

  unitCostInput.addEventListener("input", onAnyChange);
  unitCostInput.addEventListener("blur", () => {
    unitCostInput.value = fmtCurrencyInput(unitCostInput.value);
    onAnyChange();
  });
  unitExtraInput.addEventListener("input", onAnyChange);
  unitExtraInput.addEventListener("blur", () => {
    unitExtraInput.value = fmtCurrencyInput(unitExtraInput.value);
    onAnyChange();
  });
  unitsInput.addEventListener("input", onAnyChange);
  unitsInput.addEventListener("blur", () => {
    const numeric = Math.max(0, Math.round(Number(unitsInput.value || 0)));
    unitsInput.value = Number.isFinite(numeric) ? String(numeric) : "0";
    onAnyChange();
  });
  extraFlatInput.addEventListener("input", onAnyChange);
  extraFlatInput.addEventListener("blur", () => {
    extraFlatInput.value = fmtCurrencyInput(extraFlatInput.value);
    onAnyChange();
  });
  freightInput.addEventListener("input", onAnyChange);
  freightInput.addEventListener("blur", () => {
    freightInput.value = fmtCurrencyInput(freightInput.value);
    onAnyChange();
  });
  dutyRateInput.addEventListener("input", onAnyChange);
  dutyRateInput.addEventListener("blur", () => {
    const next = clampPct(dutyRateInput.value);
    dutyRateInput.value = fmtPercent(next);
    onAnyChange();
  });
  dutyIncludeToggle.addEventListener("change", onAnyChange);
  eustRateInput.addEventListener("input", onAnyChange);
  eustRateInput.addEventListener("blur", () => {
    const next = clampPct(eustRateInput.value);
    eustRateInput.value = fmtPercent(next);
    onAnyChange();
  });
  fxFeeInput.addEventListener("input", onAnyChange);
  fxFeeInput.addEventListener("blur", () => {
    const next = clampPct(fxFeeInput.value);
    fxFeeInput.value = fmtPercent(next);
    onAnyChange();
  });
  if (fxRateInput) {
    fxRateInput.addEventListener("input", onAnyChange);
    fxRateInput.addEventListener("blur", () => {
      const parsed = parseDE(fxRateInput.value);
      fxRateInput.value = parsed > 0 ? fmtFxRate(parsed) : "";
      onAnyChange();
    });
  }
  vatLagInput.addEventListener("input", onAnyChange);
  vatToggle.addEventListener("change", onAnyChange);
  ddpToggle.addEventListener("change", onAnyChange);
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
  createBtn.addEventListener("click", () => loadForm(defaultRecord(config, getSettings())));
  deleteBtn.addEventListener("click", () => onDelete(editing));
  if (convertBtn) convertBtn.addEventListener("click", convertRecord);

  renderList(listZone, state[config.entityKey], config, onEdit, onDelete);
  loadForm(defaultRecord(config, getSettings()));
}

export const orderEditorUtils = {
  parseDE,
  fmtEUR,
  fmtCurrencyInput,
  fmtPercent,
  clampPct,
  defaultRecord,
  normaliseGoodsFields,
};
