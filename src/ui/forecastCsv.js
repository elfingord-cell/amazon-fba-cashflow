// VentoryOne Revenue Forecast CSV format (2 header rows):
// Row 0: month group titles like "Erwartete Verkäufe März 2026 ...".
// Row 1: sub headers per group: Einheiten | Umsatz [€] | Gewinn [€].

const MONTH_MAP = {
  jan: "01",
  januar: "01",
  feb: "02",
  februar: "02",
  "märz": "03",
  maerz: "03",
  mrz: "03",
  marz: "03",
  apr: "04",
  april: "04",
  mai: "05",
  jun: "06",
  juni: "06",
  jul: "07",
  juli: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  okt: "10",
  oktober: "10",
  nov: "11",
  november: "11",
  dez: "12",
  dezember: "12",
};

function normalizeHeader(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parseVentoryMonth(raw) {
  if (!raw) return null;
  const text = String(raw).replace(/\s+/g, " ").trim();
  const match = text.match(/Erwartete Verkäufe\s+([A-Za-zÄÖÜäöüß\.]+)\s+(\d{4})/i);
  if (!match) return null;
  const monthRaw = match[1].replace(".", "").toLowerCase();
  const year = match[2];
  const month = MONTH_MAP[monthRaw];
  if (!month) return null;
  return `${year}-${month}`;
}

function parseNumberDE(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value)
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^0-9,.-]/g, "");
  if (!cleaned) return null;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  const decimalIndex = Math.max(lastComma, lastDot);
  let normalised = cleaned;
  if (decimalIndex >= 0) {
    const integer = cleaned.slice(0, decimalIndex).replace(/[.,]/g, "");
    const fraction = cleaned.slice(decimalIndex + 1).replace(/[.,]/g, "");
    normalised = `${integer}.${fraction}`;
  } else {
    normalised = cleaned.replace(/[.,]/g, "");
  }
  const num = Number(normalised);
  return Number.isFinite(num) ? num : null;
}

function countDelimiter(line, delimiter) {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && char === delimiter) {
      count += 1;
    }
  }
  return count;
}

function detectDelimiter(lines) {
  const sample = lines.slice(0, 3);
  let semicolons = 0;
  let commas = 0;
  sample.forEach(line => {
    semicolons += countDelimiter(line, ";");
    commas += countDelimiter(line, ",");
  });
  return semicolons >= commas ? ";" : ",";
}

function parseCsvLine(line, delimiter) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        current += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && char === delimiter) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function parseCsvMatrix(text) {
  const rawLines = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const lines = rawLines.filter(line => line.length > 0);
  if (!lines.length) return { rows: [], delimiter: ";" };
  const delimiter = detectDelimiter(lines);
  const rows = lines.map(line => parseCsvLine(line, delimiter));
  return { rows, delimiter };
}

function findSkuIndex(row0, row1) {
  const row1Index = (row1 || []).findIndex(cell => normalizeHeader(cell) === "sku");
  if (row1Index >= 0) return row1Index;
  return (row0 || []).findIndex(cell => normalizeHeader(cell) === "sku");
}

function detectMonthGroups(row0, row1) {
  const warnings = [];
  const starts = [];
  (row0 || []).forEach((cell, idx) => {
    if (!cell) return;
    if (!String(cell).includes("Erwartete Verkäufe")) return;
    const month = parseVentoryMonth(cell);
    if (!month) {
      warnings.push(`Monat konnte nicht erkannt werden: "${cell}"`);
      return;
    }
    starts.push({ month, start: idx });
  });
  if (!starts.length) {
    return { groups: [], warnings };
  }
  const groups = starts.map((entry, index) => {
    const end = index + 1 < starts.length ? starts[index + 1].start : (row1 || []).length;
    const subHeaders = row1.slice(entry.start, end).map(normalizeHeader);
    const unitsOffset = subHeaders.findIndex(val => val === "einheiten");
    const revenueOffset = subHeaders.findIndex(val => val.startsWith("umsatz"));
    const profitOffset = subHeaders.findIndex(val => val.startsWith("gewinn"));
    if (unitsOffset < 0) {
      warnings.push(`Monatsgruppe ${entry.month} ohne Einheiten-Spalte gefunden.`);
    }
    return {
      month: entry.month,
      unitsIndex: unitsOffset >= 0 ? entry.start + unitsOffset : null,
      revenueIndex: revenueOffset >= 0 ? entry.start + revenueOffset : null,
      profitIndex: profitOffset >= 0 ? entry.start + profitOffset : null,
    };
  });
  return { groups, warnings };
}

export function parseVentoryCsv(text) {
  const { rows } = parseCsvMatrix(text);
  if (rows.length < 2) {
    return { error: "CSV-Header nicht erkannt", records: [], warnings: [] };
  }
  const row0 = rows[0] || [];
  const row1 = rows[1] || [];
  const skuIndex = findSkuIndex(row0, row1);
  if (skuIndex < 0) {
    return { error: "Keine SKU-Spalte gefunden", records: [], warnings: [] };
  }
  const { groups, warnings } = detectMonthGroups(row0, row1);
  if (!groups.length) {
    return { error: "Monatsgruppen unvollständig", records: [], warnings };
  }
  const records = [];
  let ignoredTotal = 0;
  for (let i = 2; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const sku = String(row[skuIndex] || "").trim();
    if (!sku) continue;
    if (sku.toLowerCase() === "gesamt") {
      ignoredTotal += 1;
      continue;
    }
    groups.forEach(group => {
      if (group.unitsIndex == null) return;
      const units = parseNumberDE(row[group.unitsIndex]);
      const revenueEur = group.revenueIndex != null ? parseNumberDE(row[group.revenueIndex]) : null;
      const profitEur = group.profitIndex != null ? parseNumberDE(row[group.profitIndex]) : null;
      if (units == null && revenueEur == null && profitEur == null) return;
      records.push({
        sku,
        month: group.month,
        units,
        revenueEur,
        profitEur,
      });
    });
  }
  return {
    records,
    warnings,
    ignoredTotal,
    skuIndex,
    months: groups.map(group => group.month),
  };
}

export const _test = {
  detectDelimiter,
  parseVentoryMonth,
  parseNumberDE,
};
