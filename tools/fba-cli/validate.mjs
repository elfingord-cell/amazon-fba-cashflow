// FBA Cashflow CLI — State-Validierung.
//
// PORTIERT aus src/v2/modules/export-import/WorkspaceTransferPanel.tsx -> validateState().
// Bei Änderungen dort: HIER nachziehen (oder besser: dort in ein gemeinsames Modul extrahieren
// und beide importieren lassen — siehe README "Bekannte Schuld").
// Hinweis: app_sync selbst erzwingt diese Regeln NICHT serverseitig — Validierung ist advisory.

function parseDENull(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw) return 0;
  const cleaned = raw.replace(/\./g, "").replace(",", ".");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}
function parseDE(value) {
  const parsed = parseDENull(value);
  return parsed == null ? 0 : parsed;
}
function looksLikeMonth(value) {
  return /^\d{4}-\d{2}$/.test(String(value || ""));
}
function isValidIsoDate(value) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const [year, month, day] = raw.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return (
    Number.isFinite(date.getTime())
    && date.getFullYear() === year
    && date.getMonth() + 1 === month
    && date.getDate() === day
  );
}

export function validateState(state) {
  const errors = [];
  const warnings = [];
  const settings = (state && state.settings) || {};

  const opening = parseDE(settings.openingBalance);
  if (opening < 0) errors.push("Opening Balance darf nicht negativ sein.");
  if (!looksLikeMonth(settings.startMonth)) errors.push("Startmonat fehlt oder ist ungueltig (settings.startMonth).");
  const horizon = Number(settings.horizonMonths || 0);
  if (!Number.isFinite(horizon) || horizon <= 0) errors.push("Horizont fehlt oder ist ungueltig (settings.horizonMonths).");
  const baselineNormal = parseDENull(settings.cashInRecommendationBaselineNormalPct);
  if (!(baselineNormal != null && baselineNormal >= 40 && baselineNormal <= 60)) {
    errors.push("settings.cashInRecommendationBaselineNormalPct muss im Band 40..60 liegen.");
  }
  if (settings.cashInRecommendationBaselineQ4Pct != null && String(settings.cashInRecommendationBaselineQ4Pct).trim() !== "") {
    const baselineQ4 = parseDENull(settings.cashInRecommendationBaselineQ4Pct);
    if (!(baselineQ4 != null && baselineQ4 >= 40 && baselineQ4 <= 60)) {
      errors.push("settings.cashInRecommendationBaselineQ4Pct muss im Band 40..60 liegen.");
    }
  }

  (Array.isArray(state.incomings) ? state.incomings : []).forEach((entry, index) => {
    const row = entry || {};
    if (!looksLikeMonth(row.month)) errors.push(`Incomings ${index + 1}: Monat fehlt/ungueltig.`);
    const revenue = parseDENull(row.revenueEur);
    if (!(Number.isFinite(revenue) && revenue >= 0)) errors.push(`Incomings ${index + 1}: Umsatz ungueltig.`);
    let payout = Number(row.payoutPct || 0);
    if (!Number.isFinite(payout)) payout = 0;
    if (payout > 1) payout /= 100;
    if (!(payout >= 0 && payout <= 1)) errors.push(`Incomings ${index + 1}: payoutPct muss 0..1 oder 0..100 sein.`);

    const month = String(row.month || "");
    const calibrationCutoffDate = String(row.calibrationCutoffDate || "").trim();
    if (calibrationCutoffDate) {
      if (!isValidIsoDate(calibrationCutoffDate)) {
        errors.push(`Incomings ${index + 1}: calibrationCutoffDate ungueltig (erwartet JJJJ-MM-TT).`);
      } else if (looksLikeMonth(month) && calibrationCutoffDate.slice(0, 7) !== month) {
        errors.push(`Incomings ${index + 1}: calibrationCutoffDate muss im selben Monat wie row.month liegen.`);
      }
    }
    for (const [key, label] of [
      ["calibrationRevenueToDateEur", "calibrationRevenueToDateEur muss numerisch und >= 0 sein."],
      ["calibrationSellerboardMonthEndEur", "calibrationSellerboardMonthEndEur muss numerisch und >= 0 sein."],
    ]) {
      const raw = row[key];
      if (raw != null && String(raw).trim() !== "") {
        const value = parseDENull(raw);
        if (!(Number.isFinite(value) && value >= 0)) errors.push(`Incomings ${index + 1}: ${label}`);
      }
    }
    const payoutRate = row.calibrationPayoutRateToDatePct;
    if (payoutRate != null && String(payoutRate).trim() !== "") {
      const value = parseDENull(payoutRate);
      if (!Number.isFinite(value) || value < 0) errors.push(`Incomings ${index + 1}: calibrationPayoutRateToDatePct muss numerisch und >= 0 sein.`);
    }
  });

  (Array.isArray(state.extras) ? state.extras : []).forEach((entry, index) => {
    const row = entry || {};
    const month = row.month || (row.date ? String(row.date).slice(0, 7) : "");
    if (!looksLikeMonth(month)) warnings.push(`Extras ${index + 1}: Monat fehlt.`);
    if (parseDENull(row.amountEur) == null) errors.push(`Extras ${index + 1}: Betrag ungueltig.`);
  });

  (Array.isArray(state.fixcosts) ? state.fixcosts : []).forEach((entry, index) => {
    const row = entry || {};
    if (!String(row.name || "").trim()) errors.push(`Fixkosten ${index + 1}: Name fehlt.`);
    if (!(parseDE(row.amount) > 0)) errors.push(`Fixkosten ${index + 1}: Betrag ungueltig.`);
    if (looksLikeMonth(row.startMonth) && looksLikeMonth(row.endMonth) && String(row.startMonth) > String(row.endMonth)) {
      errors.push(`Fixkosten ${index + 1}: Startmonat darf nicht nach Endmonat liegen.`);
    }
  });

  const overrides = (state.fixcostOverrides && typeof state.fixcostOverrides === "object") ? state.fixcostOverrides : {};
  Object.entries(overrides).forEach(([fixId, monthRows]) => {
    if (!monthRows || typeof monthRows !== "object") return;
    Object.entries(monthRows).forEach(([monthKey, values]) => {
      if (values?.amount != null && parseDENull(values.amount) == null) {
        errors.push(`Fixkosten-Override ${fixId}/${monthKey}: Betrag ungueltig.`);
      }
      if (values?.dueDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(values.dueDate))) {
        warnings.push(`Fixkosten-Override ${fixId}/${monthKey}: dueDate sollte JJJJ-MM-TT sein.`);
      }
    });
  });

  return { errors, warnings };
}
