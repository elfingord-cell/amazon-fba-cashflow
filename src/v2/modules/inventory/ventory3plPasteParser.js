function normalizeHeaderToken(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function compactToken(value) {
  return normalizeHeaderToken(value).replace(/\s+/g, "");
}

function isSkuHeader(value) {
  return normalizeHeaderToken(value) === "sku";
}

function isTotalStockHeader(value) {
  const compact = compactToken(value)
    .replace(/_/g, "")
    .replace(/\./g, "")
    .replace(/:/g, "");
  return compact === "stk-insgesamt" || compact === "stkinsgesamt";
}

function parseUnits(value) {
  if (value == null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Math.max(0, Math.round(value));
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[^0-9,.-]/g, "");
  if (!cleaned) return null;

  const commaIndex = cleaned.lastIndexOf(",");
  const dotIndex = cleaned.lastIndexOf(".");
  const hasComma = commaIndex >= 0;
  const hasDot = dotIndex >= 0;

  let normalized = cleaned;
  if (hasComma) {
    const intPart = cleaned.slice(0, commaIndex).replace(/[.,]/g, "");
    const fracPart = cleaned.slice(commaIndex + 1).replace(/[.,]/g, "");
    normalized = `${intPart}.${fracPart}`;
  } else if (hasDot) {
    const parts = cleaned.split(".");
    if (parts.length > 2) {
      normalized = cleaned.replace(/\./g, "");
    } else if (parts.length === 2 && parts[1].length === 3) {
      // Common clipboard variant: 1.234 as thousands separator for integer counts.
      normalized = `${parts[0]}${parts[1]}`;
    }
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round(parsed));
}

function splitRows(text) {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
  return lines.map((line) => line.split("\t"));
}

function detectHeader(rows) {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    let skuIndex = -1;
    let unitsIndex = -1;
    row.forEach((cell, idx) => {
      if (skuIndex < 0 && isSkuHeader(cell)) skuIndex = idx;
      if (unitsIndex < 0 && isTotalStockHeader(cell)) unitsIndex = idx;
    });
    if (skuIndex >= 0 && unitsIndex >= 0) {
      return { rowIndex, skuIndex, unitsIndex };
    }
  }
  return null;
}

function normalizeKnownSkuMap(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  Object.entries(input).forEach(([key, value]) => {
    const normalizedKey = String(key || "").trim().toLowerCase();
    const normalizedValue = String(value || "").trim();
    if (!normalizedKey || !normalizedValue) return;
    out[normalizedKey] = normalizedValue;
  });
  return out;
}

function buildPreviewStatus(row, duplicatePolicy) {
  if (!row.isKnown) return "SKU nicht bekannt";
  if (!row.hasDuplicate) return "zuordenbar";
  if (duplicatePolicy === "block") return "Duplikat (Entscheidung erforderlich)";
  if (duplicatePolicy === "sum") return "zuordenbar (Duplikat: Summe)";
  return "zuordenbar (Duplikat: letzte Zeile)";
}

/**
 * @param {{
 *   text: string,
 *   knownSkuMap?: Record<string, string>,
 *   duplicatePolicy?: "block" | "sum" | "last",
 * }} input
 */
export function parseVentory3plPaste(input) {
  const text = String(input?.text || "");
  const duplicatePolicy = input?.duplicatePolicy === "sum" || input?.duplicatePolicy === "last"
    ? input.duplicatePolicy
    : "block";
  const knownSkuMap = normalizeKnownSkuMap(input?.knownSkuMap || {});

  if (!text.trim()) {
    return {
      error: "",
      warnings: [],
      previewRows: [],
      duplicateRows: [],
      unknownSkus: [],
      importableBySku: {},
      recognizedRows: 0,
      knownSkuCount: 0,
      unknownSkuCount: 0,
      duplicateSkuCount: 0,
      importableSkuCount: 0,
      canImport: false,
    };
  }

  const rows = splitRows(text);
  const header = detectHeader(rows);
  if (!header) {
    return {
      error: "Header nicht erkannt. Erwartet werden die Spalten SKU und STK - Insgesamt.",
      warnings: [],
      previewRows: [],
      duplicateRows: [],
      unknownSkus: [],
      importableBySku: {},
      recognizedRows: 0,
      knownSkuCount: 0,
      unknownSkuCount: 0,
      duplicateSkuCount: 0,
      importableSkuCount: 0,
      canImport: false,
    };
  }

  const grouped = new Map();
  const warnings = [];
  let recognizedRows = 0;

  for (let rowIndex = header.rowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const skuRaw = String(row[header.skuIndex] || "").trim();
    if (!skuRaw) continue;

    if (isSkuHeader(skuRaw)) continue;

    const units = parseUnits(row[header.unitsIndex]);
    if (units == null) {
      warnings.push(`Zeile ${rowIndex + 1}: STK - Insgesamt ist ungültig für SKU ${skuRaw}.`);
      continue;
    }

    recognizedRows += 1;

    const knownCanonical = knownSkuMap[skuRaw.toLowerCase()] || null;
    const displaySku = knownCanonical || skuRaw;
    const key = displaySku.toLowerCase();

    if (!grouped.has(key)) {
      grouped.set(key, {
        sku: displaySku,
        isKnown: Boolean(knownCanonical),
        values: [],
      });
    }
    grouped.get(key).values.push(units);
  }

  const importableBySku = {};
  const unknownSkus = [];
  const duplicateRows = [];

  const previewRows = Array.from(grouped.values())
    .map((entry) => {
      const values = Array.isArray(entry.values) ? entry.values.slice() : [];
      const hasDuplicate = values.length > 1;
      const isKnown = entry.isKnown === true;
      const sku = String(entry.sku || "").trim();

      if (hasDuplicate) {
        duplicateRows.push({ sku, values: values.slice(), isKnown });
      }
      if (!isKnown) {
        unknownSkus.push(sku);
      }

      let units = values[values.length - 1] || 0;
      if (duplicatePolicy === "sum") {
        units = values.reduce((sum, value) => sum + Number(value || 0), 0);
      } else if (duplicatePolicy === "last") {
        units = values[values.length - 1] || 0;
      }

      const blockedByDuplicate = hasDuplicate && duplicatePolicy === "block";
      if (isKnown && !blockedByDuplicate) {
        importableBySku[sku] = Math.max(0, Math.round(Number(units || 0)));
      }

      return {
        sku,
        units: Math.max(0, Math.round(Number(units || 0))),
        isKnown,
        hasDuplicate,
        duplicateValues: values,
        status: buildPreviewStatus({ isKnown, hasDuplicate }, duplicatePolicy),
      };
    })
    .sort((left, right) => left.sku.localeCompare(right.sku, "de-DE", { sensitivity: "base" }));

  const duplicateSkuCount = duplicateRows.length;
  const unknownUnique = Array.from(new Set(unknownSkus.map((sku) => String(sku || "").trim()))).filter(Boolean);
  const knownSkuCount = previewRows.filter((row) => row.isKnown).length;
  const importableSkuCount = Object.keys(importableBySku).length;
  const canImport = importableSkuCount > 0 && !(duplicateSkuCount > 0 && duplicatePolicy === "block");

  return {
    error: "",
    warnings,
    previewRows,
    duplicateRows: duplicateRows.sort((left, right) => left.sku.localeCompare(right.sku, "de-DE", { sensitivity: "base" })),
    unknownSkus: unknownUnique.sort((left, right) => left.localeCompare(right, "de-DE", { sensitivity: "base" })),
    importableBySku,
    recognizedRows,
    knownSkuCount,
    unknownSkuCount: unknownUnique.length,
    duplicateSkuCount,
    importableSkuCount,
    canImport,
  };
}
