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

function sanitizeHeaderKey(value) {
  return compactToken(value).replace(/[_.:-]/g, "");
}

function isSkuHeader(value) {
  return normalizeHeaderToken(value) === "sku";
}

function isFbaStockHeader(value) {
  return sanitizeHeaderKey(value) === "fbabestand";
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
  if (hasComma && hasDot) {
    if (commaIndex > dotIndex) {
      const intPart = cleaned.slice(0, commaIndex).replace(/[.,]/g, "");
      const fracPart = cleaned.slice(commaIndex + 1).replace(/[.,]/g, "");
      normalized = `${intPart}.${fracPart}`;
    } else {
      const intPart = cleaned.slice(0, dotIndex).replace(/[.,]/g, "");
      const fracPart = cleaned.slice(dotIndex + 1).replace(/[.,]/g, "");
      normalized = `${intPart}.${fracPart}`;
    }
  } else if (hasComma) {
    const parts = cleaned.split(",");
    if (parts.length > 2) {
      normalized = cleaned.replace(/,/g, "");
    } else if (parts.length === 2 && parts[1].length === 3) {
      normalized = `${parts[0]}${parts[1]}`;
    } else if (parts.length === 2) {
      normalized = `${parts[0]}.${parts[1]}`;
    }
  } else if (hasDot) {
    const parts = cleaned.split(".");
    if (parts.length > 2) {
      normalized = cleaned.replace(/\./g, "");
    } else if (parts.length === 2 && parts[1].length === 3) {
      normalized = `${parts[0]}${parts[1]}`;
    }
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round(parsed));
}

function stripWrappingQuotes(value) {
  const text = String(value || "");
  if (text.startsWith("\"") && text.endsWith("\"")) return text.slice(1, -1);
  return text;
}

function splitRows(text) {
  const cleaned = stripWrappingQuotes(text);
  const lines = String(cleaned || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
  return lines.map((line) => line.split("\t"));
}

function cleanCellText(value) {
  return String(value || "")
    .replace(/^"+/, "")
    .replace(/"+$/, "")
    .trim();
}

function detectHeader(rows) {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    let skuIndex = -1;
    let fbaStockIndex = -1;
    row.forEach((cell, idx) => {
      if (skuIndex < 0 && isSkuHeader(cell)) skuIndex = idx;
      if (fbaStockIndex < 0 && isFbaStockHeader(cell)) fbaStockIndex = idx;
    });
    if (skuIndex >= 0 && fbaStockIndex >= 0) {
      return {
        rowIndex,
        skuIndex,
        fbaStockIndex,
      };
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

/**
 * @param {{
 *   text: string,
 *   knownSkuMap?: Record<string, string>,
 * }} input
 */
export function parseVentoryFbaPaste(input) {
  const text = String(input?.text || "");
  const knownSkuMap = normalizeKnownSkuMap(input?.knownSkuMap || {});

  if (!text.trim()) {
    return {
      error: "",
      warnings: [],
      previewRows: [],
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
      error: "Header nicht erkannt. Erwartet werden die Spalten SKU und FBA Bestand.",
      warnings: [],
      previewRows: [],
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
    const skuRaw = cleanCellText(row[header.skuIndex]);
    if (!skuRaw) continue;
    if (isSkuHeader(skuRaw)) continue;

    const fbaUnits = parseUnits(cleanCellText(row[header.fbaStockIndex]));
    if (fbaUnits == null) {
      warnings.push(`Zeile ${rowIndex + 1}: FBA Bestand ist ungueltig fuer SKU ${skuRaw}.`);
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
    grouped.get(key).values.push(fbaUnits);
  }

  const importableBySku = {};
  const unknownSkus = [];
  const duplicateWarnings = [];

  const previewRows = Array.from(grouped.values())
    .map((entry) => {
      const values = Array.isArray(entry.values) ? entry.values.slice() : [];
      const isKnown = entry.isKnown === true;
      const sku = String(entry.sku || "").trim();
      const latest = parseUnits(values[values.length - 1]);
      const hasDuplicate = values.length > 1;

      if (hasDuplicate) {
        duplicateWarnings.push(`SKU ${sku} kommt mehrfach vor (${values.length} Zeilen). Letzte Zeile wird verwendet.`);
      }
      if (!isKnown) {
        unknownSkus.push(sku);
      } else {
        importableBySku[sku] = {
          fbaUnits: Math.max(0, Math.round(Number(latest || 0))),
        };
      }

      return {
        sku,
        fbaUnits: Math.max(0, Math.round(Number(latest || 0))),
        status: isKnown ? "zuordenbar" : "SKU nicht bekannt",
        isKnown,
      };
    })
    .sort((left, right) => left.sku.localeCompare(right.sku, "de-DE", { sensitivity: "base" }));

  const unknownUnique = Array.from(new Set(unknownSkus.map((sku) => String(sku || "").trim()))).filter(Boolean);
  const knownSkuCount = previewRows.filter((row) => row.isKnown).length;
  const duplicateSkuCount = duplicateWarnings.length;
  const importableSkuCount = Object.keys(importableBySku).length;
  const canImport = importableSkuCount > 0;

  return {
    error: "",
    warnings: [...warnings, ...duplicateWarnings],
    previewRows,
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
