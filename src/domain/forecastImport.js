function parseNumberDE(value) {
  if (value == null) return 0;
  let cleaned = String(value)
    .trim()
    .replace(/€/g, "")
    .replace(/\s+/g, "");
  if (cleaned.includes(",")) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function normalizeMonthToken(token) {
  if (token == null) return null;
  const raw = String(token).trim();
  if (/^\d{4}[-/]\d{2}$/.test(raw)) {
    const [y, m] = raw.split(/[-/]/);
    return `${y}-${m}`;
  }
  if (/^\d{2}[-/]\d{4}$/.test(raw)) {
    const [m, y] = raw.split(/[-/]/);
    return `${y}-${m}`;
  }
  const monthMap = {
    jan: 1, januar: 1,
    feb: 2, februar: 2,
    mär: 3, maerz: 3, mar: 3, march: 3,
    apr: 4, april: 4,
    mai: 5,
    jun: 6, juni: 6,
    jul: 7, juli: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    okt: 10, oct: 10, october: 10, oktober: 10,
    nov: 11, november: 11,
    dez: 12, dec: 12, december: 12, dezember: 12,
  };
  const monthNameMatch = raw.match(/^([a-zA-ZäöüÄÖÜ]+)\s+(\d{4})$/);
  if (monthNameMatch) {
    const key = monthNameMatch[1].toLowerCase();
    const m = monthMap[key];
    if (m) return `${monthNameMatch[2]}-${String(m).padStart(2, "0")}`;
  }
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber) && asNumber > 0 && String(raw).length <= 5) {
    const base = new Date(Date.UTC(1899, 11, 30));
    const dt = new Date(base.getTime() + (asNumber - 1) * 24 * 60 * 60 * 1000);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  return null;
}

function ensureMonth(token, contextLabel = "Monat") {
  const normalized = normalizeMonthToken(token);
  if (!normalized) {
    throw new Error(`Keine Monats-Spalten erkannt (Ventory). Gültig: YYYY-MM, YYYY/MM, MM-YYYY, MMM YYYY. ${contextLabel}`);
  }
  return normalized;
}

function parseCsvLine(line, delimiter) {
  const cells = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        current += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && ch === delimiter) {
      cells.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells;
}

function detectMonthFromLabel(label) {
  if (!label) return null;
  const trimmed = String(label).trim().replace(/\s+/g, " ");
  const monthNamePattern = /(jan|januar|feb|februar|mär|maerz|mar|märz|march|apr|april|mai|jun|juni|jul|juli|aug|august|sep|sept|september|okt|oct|october|oktober|nov|november|dez|dec|december|dezember)\s*(\d{4})/i;
  const monthNameMatch = trimmed.match(monthNamePattern);
  if (monthNameMatch) {
    const monthKey = monthNameMatch[1].toLowerCase();
    const year = monthNameMatch[2];
    const monthMap = {
      jan: 1, januar: 1,
      feb: 2, februar: 2,
      mär: 3, mar: 3, märz: 3, maerz: 3, march: 3,
      apr: 4, april: 4,
      mai: 5,
      jun: 6, juni: 6,
      jul: 7, juli: 7,
      aug: 8, august: 8,
      sep: 9, sept: 9, september: 9,
      okt: 10, oct: 10, october: 10, oktober: 10,
      nov: 11, november: 11,
      dez: 12, dec: 12, december: 12, dezember: 12,
    };
    const m = monthMap[monthKey];
    if (m) return `${year}-${String(m).padStart(2, "0")}`;
  }
  const normalized = normalizeMonthToken(trimmed);
  if (normalized) return normalized;
  const ymMatch = trimmed.match(/(\d{4})[-/.](\d{2})/);
  if (ymMatch) return `${ymMatch[1]}-${ymMatch[2]}`;
  const nameYearLoose = trimmed.match(/([A-Za-zÄÖÜäöü\.]{2,})[^0-9]{0,5}(\d{4})/);
  if (nameYearLoose) {
    const cleanedName = nameYearLoose[1].replace(/[^A-Za-zÄÖÜäöü]/g, "");
    const token = `${cleanedName} ${nameYearLoose[2]}`;
    const norm = normalizeMonthToken(token);
    if (norm) return norm;
  }
  return null;
}

export function parseVentoryCsv(text) {
  const lines = text.split(/\r?\n/).filter(line => line.length);
  if (!lines.length) return { type: "ventory-csv", records: [], warnings: [], importedMonths: [], importedSkus: [] };

  const firstNonEmpty = lines.find(line => line.trim().length) || "";
  const delimiter = firstNonEmpty.includes(";") ? ";" : ",";
  const rows = lines.map(line => parseCsvLine(line, delimiter));

  const headerIdx = rows.findIndex(r => r.some(cell => String(cell || "").trim().toLowerCase() === "sku"));
  if (headerIdx === -1) {
    throw new Error("Spalte ‘SKU’ nicht gefunden. Bitte Datei prüfen oder Spalten im Wizard zuordnen.");
  }

  const maxCols = Math.max(...rows.map(r => r.length));
  const headerRow = rows[headerIdx].map(h => String(h ?? "").trim());
  const headerLower = headerRow.map(h => h.toLowerCase());
  const skuIdx = headerLower.findIndex(h => h === "sku");
  const aliasIdx = headerLower.findIndex(h => h === "alias" || h === "produkt" || h === "produktname");

  const groupRow = headerIdx > 0 ? rows[headerIdx - 1] : [];
  const groupLabels = Array(maxCols).fill("");
  let currentGroup = "";
  for (let c = 0; c < maxCols; c++) {
    const token = groupRow[c];
    if (token && String(token).trim()) {
      currentGroup = String(token).trim();
    }
    groupLabels[c] = currentGroup;
  }

  const qtyCols = [];
  for (let c = 0; c < maxCols; c++) {
    const group = (groupLabels[c] || "").toLowerCase();
    if (!group.includes("erwartete verkäufe")) continue;
    if (group.includes("historische")) continue;
    const month = detectMonthFromLabel(groupLabels[c]);
    if (!month) continue;
    const metric = (headerLower[c] || "").trim();
    const isQty = ["einheiten", "qty", "menge", "units"].some(key => metric.includes(key));
    if (isQty) {
      qtyCols.push({ idx: c, month });
    }
  }

  if (!qtyCols.length) {
    throw new Error("Keine ‘Erwartete Verkäufe’-Spalten gefunden. Prüfe Ventory-Exportformat.");
  }

  const records = [];
  const warnings = [];
  const importedMonths = new Set();
  const importedSkus = new Set();

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const cols = rows[r].length ? rows[r] : [];
    const rawSku = (cols[skuIdx] || "").trim();
    const lowerSku = rawSku.toLowerCase();
    if (!rawSku || lowerSku === "gesamt" || lowerSku === "summe" || lowerSku.startsWith("gesamt")) {
      continue;
    }
    const sku = rawSku;
    const alias = aliasIdx >= 0 ? (cols[aliasIdx] || "").toString().trim() : "";
    qtyCols.forEach(col => {
      const raw = (cols[col.idx] || "").toString().trim();
      const cleaned = raw.replace(/[\s€]/g, "");
      const qtyVal = parseNumberDE(cleaned);
      const valid = Number.isFinite(qtyVal) && qtyVal >= 0;
      if (!valid) {
        warnings.push(`Ungültige Menge in Zeile ${r + 1}, Spalte ${headerRow[col.idx] || col.idx} → als 0 übernommen.`);
      }
      const qty = valid ? qtyVal : 0;
      importedMonths.add(col.month);
      importedSkus.add(sku);
      records.push({ sku, alias, month: col.month, qty, source: "ventory" });
    });
  }

  return {
    type: "ventory-csv",
    records,
    warnings,
    importedMonths: Array.from(importedMonths),
    importedSkus: Array.from(importedSkus),
  };
}

export function mergeForecastItems(existingItems, newRecords) {
  const importedSkus = new Set(newRecords.map(r => r.sku));
  const importedMonths = new Set(newRecords.map(r => r.month));
  const dedup = new Map();
  newRecords.forEach(rec => {
    const key = `${rec.sku}__${rec.month}`;
    dedup.set(key, { ...rec, qty: Number(rec.qty || 0) || 0 });
  });
  const kept = existingItems.filter(it => !(importedSkus.has(it.sku) && importedMonths.has(it.month)));
  return { items: [...kept, ...dedup.values()], importedSkus, importedMonths };
}

function parseAppExportJson(obj) {
  if (!obj || typeof obj !== "object") {
    throw new Error("JSON konnte nicht gelesen werden. Prüfe Datei oder Format.");
  }
  const incomings = [];
  const warnings = [];
  if (!Array.isArray(obj.incomings) || !obj.incomings.length) {
    throw new Error("Fehlende Pflichtfelder: incomings[*].month oder revenueEur.");
  }
  obj.incomings.forEach((row, idx) => {
    if (!row?.month || row.revenueEur == null) {
      throw new Error("Fehlende Pflichtfelder: incomings[*].month oder revenueEur.");
    }
    const month = normalizeMonthToken(row.month);
    if (!month) throw new Error(`Ungültiger Monat in incomings[${idx}].`);
    const revenue = parseNumberDE(row.revenueEur);
    const payoutPct = parseNumberDE(row.payoutPct);
    incomings.push({ month, revenueEur: revenue, payoutPct });
  });

  const settings = {};
  if (obj.settings?.startMonth) settings.startMonth = normalizeMonthToken(obj.settings.startMonth) || obj.settings.startMonth;
  if (obj.settings?.horizonMonths) settings.horizonMonths = Number(obj.settings.horizonMonths) || undefined;

  return { type: "app-export", incomings, settings, warnings };
}

function parseVentoryBroad(obj) {
  const columns = Array.isArray(obj?.columns) ? obj.columns : null;
  const rows = Array.isArray(obj?.rows) ? obj.rows : null;
  if (!columns || !rows) return null;
  const headerLower = columns.map(col => String(col ?? "").trim().toLowerCase());
  const skuIdx = headerLower.findIndex(h => h === "sku");
  if (skuIdx === -1) throw new Error("Spalte ‘SKU’ nicht gefunden. Bitte Datei prüfen oder Spalten im Wizard zuordnen.");
  const aliasIdx = headerLower.findIndex(h => h === "alias");
  const monthCols = headerLower
    .map((h, idx) => {
      const normalized = normalizeMonthToken(h);
      return normalized ? { month: normalized, idx } : null;
    })
    .filter(Boolean);
  if (!monthCols.length) throw new Error("Keine Monats-Spalten erkannt (Ventory). Gültig: YYYY-MM, YYYY/MM, MM-YYYY, MMM YYYY.");
  const warnings = [];
  const records = [];
  const importId = Date.now();
  rows.forEach((row, rowIdx) => {
    if (!row || !Array.isArray(row)) return;
    const sku = String(row[skuIdx] ?? "").trim();
    if (!sku) return;
    const alias = aliasIdx >= 0 ? String(row[aliasIdx] ?? "").trim() : "";
    monthCols.forEach(col => {
      const raw = row[col.idx];
      const cleaned = raw == null ? "" : String(raw).trim();
      const qty = cleaned === "" || cleaned === "-" || cleaned === "—" ? 0 : Number.parseInt(cleaned, 10);
      if (!Number.isInteger(qty) || qty < 0) {
        warnings.push(`Ungültige Menge in Zeile ${rowIdx + 2}, Spalte ${columns[col.idx]} – Wert auf 0 gesetzt.`);
      }
      records.push({ sku, alias, month: col.month, qty: Number.isInteger(qty) && qty >= 0 ? qty : 0, priceEur: parseNumberDE(obj?.priceEur?.[sku]), source: "json", importId });
    });
  });
  return { type: "ventory-broad", records, warnings };
}

function parseVentoryLong(obj) {
  const items = Array.isArray(obj?.items) ? obj.items : null;
  if (!items) return null;
  const records = [];
  const warnings = [];
  const importId = Date.now();
  items.forEach((item, idx) => {
    if (!item?.sku || !item?.month) {
      warnings.push(`Eintrag ${idx + 1} ohne SKU/Monat übersprungen.`);
      return;
    }
    const month = normalizeMonthToken(item.month);
    if (!month) {
      warnings.push(`Ungültiger Monat in Eintrag ${idx + 1} – übersprungen.`);
      return;
    }
    const qty = Number.parseInt(item.qty, 10);
    records.push({
      sku: String(item.sku).trim(),
      alias: item.alias ? String(item.alias).trim() : "",
      month,
      qty: Number.isInteger(qty) && qty >= 0 ? qty : 0,
      priceEur: item.priceEur != null ? Number(item.priceEur) : undefined,
      source: "json",
      importId,
    });
  });
  return { type: "ventory-long", records, warnings };
}

export function parseForecastJsonPayload(obj) {
  if (obj && typeof obj === "object" && Array.isArray(obj.incomings)) {
    return parseAppExportJson(obj);
  }
  const broad = parseVentoryBroad(obj);
  if (broad) return broad;
  const long = parseVentoryLong(obj);
  if (long) return long;
  throw new Error("JSON konnte nicht gelesen werden. Prüfe Datei oder Format.");
}

export function formatEuroDE(value) {
  const num = Number(parseNumberDE(value));
  return Number.isFinite(num)
    ? num.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0,00";
}

export { normalizeMonthToken };
