export function parseLocalizedNumber(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let raw = String(value).trim();
  if (!raw) return null;
  raw = raw.replace(/\s+/g, "");
  raw = raw.replace(/[€$£]/g, "");
  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  let normalized = raw;

  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      normalized = normalized.replace(/\./g, "").replace(/,/g, ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else if (lastComma > -1) {
    normalized = normalized.replace(/\./g, "").replace(/,/g, ".");
  } else if (lastDot > -1) {
    normalized = normalized.replace(/,/g, "");
  }

  if (!/^[-+]?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

export function formatLocalizedNumber(value, decimals = 2, options = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return num.toLocaleString("de-DE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    ...options,
  });
}
