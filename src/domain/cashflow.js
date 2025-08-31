
import { parseDE, yyyymmList, endOfMonth } from "./helpers.js";

export function computeMonthly(state) {
  const months = yyyymmList(state.settings.startMonth, state.settings.horizonMonths);
  const map = new Map(months.map(m => [m, { month: m, inflow: 0, outflow: 0 }]));

  for (const r of state.incomings) {
    if (!map.has(r.month)) continue;
    const revenue = parseDE(r.revenueEur);
    const pr = parseDE(r.payoutRate);
    const rate = pr > 1 ? pr / 100 : pr;
    map.get(r.month).inflow += revenue * rate;
  }
  for (const r of state.extras) {
    if (map.has(r.month)) map.get(r.month).inflow += parseDE(r.amountEur);
  }
  for (const r of state.outgoings) {
    if (map.has(r.month)) map.get(r.month).outflow += Math.abs(parseDE(r.amountEur));
  }

  let prev = parseDE(state.settings.openingBalance);
  const rows = months.map(m => {
    const { inflow, outflow } = map.get(m);
    const net = inflow - outflow;
    const opening = prev;
    const closing = opening + net;
    prev = closing;
    return { month: m, opening, inflow, outflow, net, closing, date: endOfMonth(m) };
  });
  return rows;
}
