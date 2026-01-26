export type Anchor = "ORDER_DATE" | "PROD_DONE" | "ETD" | "ETA";

export type Milestone = {
  id: string;
  label: string;
  percent: number;
  anchor: Anchor;
  lagDays: number;
  currency?: "USD" | "EUR";
  valueEur?: number;
};

export type PO = {
  id: string;
  poNo: string;
  orderDate: string;
  goodsValueUsd: number;
  prodDays: number;
  transport: "sea" | "rail" | "air";
  transitDays: number;
  etdManual?: string | null;
  etaManual?: string | null;
  ddp: boolean;
  freightEur?: number;
  dutyRatePct?: number;
  dutyIncludeFreight?: boolean;
  dutyOverrideEur?: number | null;
  eustOverrideEur?: number | null;
  fxOverride?: number | null;
  milestones: Milestone[];
};

export type Settings = {
  fxRate: number;
  fxFeePct: number;
  eustRate: number;
  freightLagDays: number;
  vatRefundEnabled: boolean;
  vatRefundLagMonths: number;
  cnyBlackoutByYear?: Record<string, { start: string; end: string }>;
};

export type EventRow = {
  key: string;
  date: string;
  type: "PO" | "FREIGHT" | "DUTY" | "EUST" | "VAT_REFUND" | "FX";
  label: string;
  poId: string;
  poNo: string;
  amountEur: number;
  srcCurrency?: "USD" | "EUR";
  srcAmount?: number;
};

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

function iso(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDate(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(dt.getTime())) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
  return dt;
}

function parseDateOptional(value?: string | null): Date | null {
  if (!value) return null;
  const [y, m, d] = String(value).split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * MILLIS_PER_DAY);
}

function getCnyWindow(settings: Settings, year: number): { start: Date; end: Date } | null {
  const entry = settings?.cnyBlackoutByYear?.[String(year)];
  if (!entry) return null;
  const start = parseDateOptional(entry.start);
  const end = parseDateOptional(entry.end);
  if (!start || !end) return null;
  if (end < start) return null;
  return { start, end };
}

function applyCnyBlackout(orderDate: Date, prodDays: number, settings: Settings): { prodDone: Date; adjustmentDays: number } {
  const remainingBase = Math.max(0, Number(prodDays || 0));
  if (!settings?.cnyBlackoutByYear || remainingBase === 0) {
    return { prodDone: addDays(orderDate, remainingBase), adjustmentDays: 0 };
  }
  let remaining = remainingBase;
  let current = new Date(orderDate.getTime());
  let adjustmentDays = 0;
  while (remaining > 0) {
    const window = getCnyWindow(settings, current.getUTCFullYear());
    if (window) {
      const endExclusive = addDays(window.end, 1);
      if (current >= window.start && current < endExclusive) {
        adjustmentDays += 1;
        current = addDays(current, 1);
        continue;
      }
    }
    remaining -= 1;
    current = addDays(current, 1);
  }
  return { prodDone: current, adjustmentDays };
}

function lastOfMonth(year: number, month: number): Date {
  return new Date(Date.UTC(year, month + 1, 0));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function getFx(po: PO, settings: Settings): number {
  return po.fxOverride ?? settings.fxRate;
}

export function usdToEur(usd: number, fxRate: number, fxFeePct: number): number {
  if (!Number.isFinite(usd)) return 0;
  const rate = Number.isFinite(fxRate) && fxRate > 0 ? fxRate : 0;
  const feeFactor = 1 + (fxFeePct ?? 0) / 100;
  const converted = rate > 0 ? usd / rate : usd;
  return converted * feeFactor;
}

function computeAnchors(po: PO, settings: Settings): Record<Anchor, Date> {
  const orderDate = parseDate(po.orderDate);
  const prodDone = applyCnyBlackout(orderDate, po.prodDays ?? 0, settings).prodDone;
  const etdComputed = prodDone;
  const etaComputed = addDays(etdComputed, po.transitDays ?? 0);
  const etdManual = parseDateOptional(po.etdManual ?? null);
  const etaManual = parseDateOptional(po.etaManual ?? null);
  const etd = etdManual ?? etdComputed;
  const eta = etaManual ?? etaComputed;
  return {
    ORDER_DATE: orderDate,
    PROD_DONE: prodDone,
    ETD: etd,
    ETA: eta,
  };
}

function milestoneAmount(
  po: PO,
  settings: Settings,
  milestone: Milestone,
): { amount: number; fee?: number; srcCurrency?: "USD" | "EUR"; srcAmount?: number } {
  const percent = milestone.percent ?? 0;
  const ratio = percent / 100;
  if (milestone.currency === "EUR" && typeof milestone.valueEur === "number") {
    return {
      amount: -round2(milestone.valueEur),
      srcCurrency: "EUR",
      srcAmount: round2(milestone.valueEur),
    };
  }

  const usdAmount = po.goodsValueUsd * ratio;
  const fx = getFx(po, settings);
  const baseEur = usdToEur(usdAmount, fx, 0);
  const feePct = settings.fxFeePct ?? 0;
  const fee = baseEur * (feePct / 100);
  return {
    amount: -round2(baseEur),
    fee: feePct ? -round2(fee) : 0,
    srcCurrency: "USD",
    srcAmount: round2(usdAmount),
  };
}

function freightAmount(po: PO): number | null {
  if (po.ddp) return null;
  if (typeof po.freightEur !== "number" || po.freightEur === 0) return null;
  return -round2(po.freightEur);
}

function dutyAmount(po: PO, settings: Settings): number | null {
  if (po.ddp) return null;
  if (po.dutyOverrideEur !== undefined && po.dutyOverrideEur !== null) {
    if (po.dutyOverrideEur === 0) return 0;
    return -round2(po.dutyOverrideEur);
  }
  const dutyRate = po.dutyRatePct ?? 0;
  if (dutyRate <= 0) return null;
  const fx = getFx(po, settings);
  const goodsEur = fx > 0 ? po.goodsValueUsd / fx : po.goodsValueUsd;
  const base = goodsEur + (po.dutyIncludeFreight ? po.freightEur ?? 0 : 0);
  const result = base * (dutyRate / 100);
  if (result === 0) return null;
  return -round2(result);
}

function eustAmount(po: PO, settings: Settings, duty: number | null, freight: number | null): number | null {
  if (po.ddp) return null;
  if (po.eustOverrideEur !== undefined && po.eustOverrideEur !== null) {
    if (po.eustOverrideEur === 0) return 0;
    return -round2(po.eustOverrideEur);
  }
  const fx = getFx(po, settings);
  const goodsEur = fx > 0 ? po.goodsValueUsd / fx : po.goodsValueUsd;
  const freightAbs = freight ? Math.abs(freight) : (po.freightEur ?? 0);
  // EUSt-Bemessungsgrundlage: Warenwert + Freight (Zoll nicht enthalten)
  const base = goodsEur + freightAbs;
  if (base === 0) return null;
  const rawRate = (settings as any).eustRate ?? (settings as any).eustRatePct ?? 0;
  const rate = rawRate > 1 ? rawRate / 100 : rawRate;
  const result = base * rate;
  if (result === 0) return null;
  return -round2(result);
}

export function monthEnd(ym: string): string {
  const [year, month] = ym.split("-").map(Number);
  if (!year || !month) {
    throw new Error(`Invalid year-month: ${ym}`);
  }
  return iso(lastOfMonth(year, month - 1));
}

export function expandPO(po: PO, settings: Settings): EventRow[] {
  const anchors = computeAnchors(po, settings);
  const events: EventRow[] = [];

  for (const milestone of po.milestones ?? []) {
    const anchorDate = anchors[milestone.anchor];
    if (!anchorDate) continue;
    const dueDate = addDays(anchorDate, milestone.lagDays ?? 0);
    const { amount, srcCurrency, srcAmount, fee } = milestoneAmount(po, settings, milestone);
    const date = iso(dueDate);
    events.push({
      key: [date, "PO", po.id, milestone.id].join("|"),
      date,
      type: "PO",
      label: `${po.poNo} – ${milestone.label}`,
      poId: po.id,
      poNo: po.poNo,
      amountEur: amount,
      srcCurrency,
      srcAmount,
    });
    if (fee && fee !== 0) {
      events.push({
        key: [date, "FX", po.id, milestone.id].join("|"),
        date,
        type: "FX" as any,
        label: `${po.poNo} – FX-Gebühr`,
        poId: po.id,
        poNo: po.poNo,
        amountEur: fee,
        srcCurrency: "EUR",
        srcAmount: Math.abs(fee),
      });
    }
  }

  const eta = anchors.ETA;

  const freight = freightAmount(po);
  if (freight !== null) {
    const freightDate = iso(addDays(eta, settings.freightLagDays ?? 0));
    events.push({
      key: [freightDate, "FREIGHT", po.id].join("|"),
      date: freightDate,
      type: "FREIGHT",
      label: `${po.poNo} – Fracht`,
      poId: po.id,
      poNo: po.poNo,
      amountEur: freight,
      srcCurrency: "EUR",
      srcAmount: Math.abs(freight),
    });
  }

  const duty = dutyAmount(po, settings);
  if (duty !== null) {
    const dutyDate = iso(eta);
    events.push({
      key: [dutyDate, "DUTY", po.id].join("|"),
      date: dutyDate,
      type: "DUTY",
      label: `${po.poNo} – Zoll`,
      poId: po.id,
      poNo: po.poNo,
      amountEur: duty,
      srcCurrency: "EUR",
      srcAmount: Math.abs(duty),
    });
  }

  const eust = eustAmount(po, settings, duty, freight);
  if (eust !== null) {
    const eustDate = iso(eta);
    events.push({
      key: [eustDate, "EUST", po.id].join("|"),
      date: eustDate,
      type: "EUST",
      label: `${po.poNo} – EUSt`,
      poId: po.id,
      poNo: po.poNo,
      amountEur: eust,
      srcCurrency: "EUR",
      srcAmount: Math.abs(eust),
    });

    if (settings.vatRefundEnabled && eust !== 0) {
      const ym = eustDate.slice(0, 7);
      const refundIso = shiftMonthEnd(ym, settings.vatRefundLagMonths ?? 0);
      events.push({
        key: [refundIso, "VAT_REFUND", po.id].join("|"),
        date: refundIso,
        type: "VAT_REFUND",
        label: `${po.poNo} – EUSt-Erstattung`,
        poId: po.id,
        poNo: po.poNo,
        amountEur: Math.abs(eust),
        srcCurrency: "EUR",
        srcAmount: Math.abs(eust),
      });
    }
  }

  return events.sort((a, b) => (a.date === b.date ? a.key.localeCompare(b.key) : a.date.localeCompare(b.date)));
}

function shiftMonthEnd(ym: string, offset: number): string {
  const [yearStr, monthStr] = ym.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new Error(`Invalid year-month: ${ym}`);
  }
  const totalMonths = year * 12 + (month - 1) + offset;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = totalMonths % 12;
  return iso(lastOfMonth(targetYear, targetMonth));
}

export function expandAllPOs(pos: PO[], settings: Settings): EventRow[] {
  const events = pos.flatMap((po) => expandPO(po, settings));
  return events.sort((a, b) => (a.date === b.date ? a.key.localeCompare(b.key) : a.date.localeCompare(b.date)));
}

function monthFromDate(date: string): string {
  return date.slice(0, 7);
}

export function aggregateByMonth(
  events: EventRow[],
  months: string[],
): { month: string; inflow: number; outflow: number; net: number; items: EventRow[] }[] {
  return months.map((month) => {
    const monthlyItems = events
      .filter((event) => monthFromDate(event.date) === month)
      .sort((a, b) => (a.date === b.date ? a.key.localeCompare(b.key) : a.date.localeCompare(b.date)));
    let inflow = 0;
    let outflow = 0;
    for (const event of monthlyItems) {
      if (event.amountEur >= 0) {
        inflow += event.amountEur;
      } else {
        outflow += Math.abs(event.amountEur);
      }
    }
    const net = inflow - outflow;
    return {
      month,
      inflow: round2(inflow),
      outflow: round2(outflow),
      net: round2(net),
      items: monthlyItems,
    };
  });
}

export function validatePO(po: PO): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!po.id) {
    errors.push("PO id is required");
  }
  if (!po.poNo) {
    errors.push("PO number is required");
  }
  if (!po.orderDate) {
    errors.push("orderDate is required");
  }
  if (po.goodsValueUsd < 0) {
    errors.push("goodsValueUsd must be >= 0");
  }
  if (!Array.isArray(po.milestones) || po.milestones.length === 0) {
    errors.push("at least one milestone is required");
  }

  let percentTotal = 0;
  for (const milestone of po.milestones ?? []) {
    if (!milestone.id) {
      errors.push("milestone id is required");
    }
    if (milestone.percent < 0) {
      errors.push(`milestone ${milestone.id || milestone.label} percent must be >= 0`);
    }
    percentTotal += milestone.percent;
  }
  if (Math.abs(percentTotal - 100) > 1e-6) {
    errors.push(`milestone percent total must equal 100 (got ${percentTotal})`);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true };
}

// Tests
import assert from "node:assert";
import test from "node:test";

test("expandPO creates expected events", () => {
  const po: PO = {
    id: "po-25007",
    poNo: "25007",
    orderDate: "2025-02-21",
    goodsValueUsd: 4090,
    prodDays: 60,
    transport: "sea",
    transitDays: 60,
    ddp: false,
    freightEur: 368.5,
    dutyRatePct: 6.5,
    dutyIncludeFreight: false,
    dutyOverrideEur: null,
    eustOverrideEur: null,
    fxOverride: 0.86,
    milestones: [
      { id: "m1", label: "Deposit 30%", percent: 30, anchor: "ORDER_DATE", lagDays: 0 },
      { id: "m2", label: "Balance 70%", percent: 70, anchor: "PROD_DONE", lagDays: 0 },
    ],
  };
  const settings: Settings = {
    fxRate: 0.86,
    fxFeePct: 0.5,
    eustRate: 0.19,
    freightLagDays: 14,
    vatRefundEnabled: true,
    vatRefundLagMonths: 2,
  };

  const events = expandPO(po, settings);
  assert.strictEqual(events.length, 8);
  const markers = events.map((e) => `${e.date}:${e.type}`);
  assert.deepStrictEqual(markers, [
    "2025-02-21:FX",
    "2025-02-21:PO",
    "2025-04-22:FX",
    "2025-04-22:PO",
    "2025-06-21:DUTY",
    "2025-06-21:EUST",
    "2025-07-05:FREIGHT",
    "2025-08-31:VAT_REFUND",
  ]);
});

test("CNY blackout extends production end date", () => {
  const po: PO = {
    id: "po-cny-1",
    poNo: "CNY1",
    orderDate: "2025-01-01",
    goodsValueUsd: 1000,
    prodDays: 10,
    transport: "sea",
    transitDays: 0,
    ddp: false,
    milestones: [
      { id: "m1", label: "Balance", percent: 100, anchor: "PROD_DONE", lagDays: 0 },
    ],
  };
  const settings: Settings = {
    fxRate: 1,
    fxFeePct: 0,
    eustRate: 0,
    freightLagDays: 0,
    vatRefundEnabled: false,
    vatRefundLagMonths: 0,
    cnyBlackoutByYear: {
      "2025": { start: "2025-01-05", end: "2025-01-07" },
    },
  };
  const events = expandPO(po, settings);
  const prodEvent = events.find((evt) => evt.type === "PO");
  assert.strictEqual(prodEvent?.date, "2025-01-14");
});

test("CNY blackout skips full holiday window before production resumes", () => {
  const po: PO = {
    id: "po-cny-2",
    poNo: "CNY2",
    orderDate: "2025-01-10",
    goodsValueUsd: 1000,
    prodDays: 5,
    transport: "sea",
    transitDays: 0,
    ddp: false,
    milestones: [
      { id: "m1", label: "Balance", percent: 100, anchor: "PROD_DONE", lagDays: 0 },
    ],
  };
  const settings: Settings = {
    fxRate: 1,
    fxFeePct: 0,
    eustRate: 0,
    freightLagDays: 0,
    vatRefundEnabled: false,
    vatRefundLagMonths: 0,
    cnyBlackoutByYear: {
      "2025": { start: "2025-01-10", end: "2025-01-20" },
    },
  };
  const events = expandPO(po, settings);
  const prodEvent = events.find((evt) => evt.type === "PO");
  assert.strictEqual(prodEvent?.date, "2025-01-26");
});

test("auto-events use goods + freight base and FX fee split", () => {
  const po: PO = {
    id: "po-25007",
    poNo: "PO25007",
    orderDate: "2025-10-20",
    goodsValueUsd: 80000,
    prodDays: 40,
    transport: "sea",
    transitDays: 60,
    ddp: false,
    freightEur: 4800,
    dutyRatePct: 6.5,
    dutyIncludeFreight: true,
    milestones: [
      { id: "m1", label: "Deposit", percent: 30, anchor: "ORDER_DATE", lagDays: 0 },
      { id: "m2", label: "Balance", percent: 70, anchor: "ETD", lagDays: 0 },
    ],
  };
  const settings: Settings = {
    fxRate: 1.08,
    fxFeePct: 0.5,
    eustRate: 0.19,
    freightLagDays: 14,
    vatRefundEnabled: true,
    vatRefundLagMonths: 2,
  };

  const events = expandPO(po, settings);
  const byType = Object.fromEntries(events.map(evt => [evt.type, evt]));

  const goodsEur = 80000 / 1.08; // 74,074.07
  const dutyBase = goodsEur + 4800;
  const duty = round2(dutyBase * 0.065);
  const eustBase = dutyBase;
  const eust = round2(eustBase * 0.19);

  assert.strictEqual(round2(Math.abs(byType.FREIGHT.amountEur)), 4800);
  assert.strictEqual(round2(Math.abs(byType.DUTY.amountEur)), round2(duty));
  assert.strictEqual(round2(Math.abs(byType.EUST.amountEur)), round2(eust));
  const fxEvents = events.filter(e => e.type === "FX");
  assert.ok(fxEvents.length >= 2);
  const fxSum = round2(fxEvents.reduce((sum, e) => sum + Math.abs(e.amountEur), 0));
  assert.strictEqual(fxSum, round2(goodsEur * 0.005));
});

test("aggregateByMonth groups sums", () => {
  const events: EventRow[] = [
    { key: "2025-01-01|PO|1|m1", date: "2025-01-01", type: "PO", label: "", poId: "1", poNo: "1", amountEur: -100 },
    { key: "2025-01-15|VAT_REFUND|1", date: "2025-01-15", type: "VAT_REFUND", label: "", poId: "1", poNo: "1", amountEur: 20 },
    { key: "2025-02-01|PO|1|m2", date: "2025-02-01", type: "PO", label: "", poId: "1", poNo: "1", amountEur: -50 },
  ];
  const result = aggregateByMonth(events, ["2025-01", "2025-02"]);
  assert.deepStrictEqual(result[0].inflow, 20);
  assert.deepStrictEqual(result[0].outflow, 100);
  assert.deepStrictEqual(result[0].net, -80);
  assert.deepStrictEqual(result[1].net, -50);
});

test("validatePO catches invalid sums", () => {
  const po: PO = {
    id: "1",
    poNo: "PO1",
    orderDate: "2025-01-01",
    goodsValueUsd: 1000,
    prodDays: 10,
    transport: "sea",
    transitDays: 30,
    ddp: true,
    milestones: [
      { id: "m1", label: "Deposit", percent: 40, anchor: "ORDER_DATE", lagDays: 0 },
    ],
  };
  const result = validatePO(po);
  assert.strictEqual(result.ok, false);
});
