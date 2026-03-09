import { buildZipBlob } from "./accountantBundle.js";

const XML_HEADER = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>";

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnLabel(index) {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function cellRef(columnIndex, rowIndex) {
  return `${columnLabel(columnIndex)}${rowIndex}`;
}

function toCellXml(value, rowIndex, columnIndex) {
  const ref = cellRef(columnIndex, rowIndex);
  if (value == null || value === "") {
    return `<c r=\"${ref}\" t=\"inlineStr\"><is><t></t></is></c>`;
  }
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && typeof value !== "string") {
    return `<c r=\"${ref}\"><v>${asNumber}</v></c>`;
  }
  if (Number.isFinite(asNumber) && /^-?\d+(?:[.,]\d+)?$/.test(String(value).trim())) {
    return `<c r=\"${ref}\"><v>${String(value).replace(",", ".")}</v></c>`;
  }
  return `<c r=\"${ref}\" t=\"inlineStr\"><is><t xml:space=\"preserve\">${escapeXml(value)}</t></is></c>`;
}

function buildSheetXml(rows) {
  const rowXml = rows.map((cells, index) => {
    const rowIndex = index + 1;
    const cellXml = cells.map((value, columnIndex) => toCellXml(value, rowIndex, columnIndex)).join("");
    return `<row r=\"${rowIndex}\">${cellXml}</row>`;
  }).join("");
  return `${XML_HEADER}<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>${rowXml}</sheetData></worksheet>`;
}

function buildWorkbookXml(sheets) {
  const sheetXml = sheets
    .map((sheet, index) => `<sheet name=\"${escapeXml(sheet.name)}\" sheetId=\"${index + 1}\" r:id=\"rId${index + 1}\"/>`)
    .join("");
  return `${XML_HEADER}<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets>${sheetXml}</sheets></workbook>`;
}

function buildWorkbookRelsXml(sheets) {
  const rels = sheets
    .map((_, index) => `<Relationship Id=\"rId${index + 1}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet${index + 1}.xml\"/>`)
    .join("");
  return `${XML_HEADER}<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">${rels}</Relationships>`;
}

function buildContentTypesXml(sheets) {
  const overrides = sheets
    .map((_, index) => `<Override PartName=\"/xl/worksheets/sheet${index + 1}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>`)
    .join("");
  return `${XML_HEADER}<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>${overrides}</Types>`;
}

function buildRootRelsXml() {
  return `${XML_HEADER}<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>`;
}

function formatMonthLabel(month) {
  const raw = String(month || "");
  if (!/^\d{4}-\d{2}$/.test(raw)) return raw;
  const [year, monthNumber] = raw.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleDateString("de-DE", { month: "short", year: "numeric" });
}

export function buildSupplierOutlookWorkbookModel(model) {
  const months = Array.isArray(model?.months) ? model.months : [];
  const supplierRows = Array.isArray(model?.supplierRows) ? model.supplierRows : [];
  const traceRows = Array.isArray(model?.traceRows) ? model.traceRows : [];

  const supplierSheetRows = [
    ["Lieferant", model?.supplierName || model?.supplierId || ""],
    ["Startmonat", model?.startMonth || ""],
    ["Horizont", model?.horizonMonths || ""],
    ["Stand", model?.frozenAt || model?.generatedAt || ""],
    [],
    ["Produkt", ...months.map((month) => formatMonthLabel(month))],
  ];
  supplierRows.forEach((row) => {
    supplierSheetRows.push([
      row.label || "",
      ...months.map((month) => row?.cells?.[month]?.text || ""),
    ]);
  });

  const traceSheetRows = [[
    "label",
    "sku",
    "month",
    "systemQty",
    "finalQty",
    "deviation",
    "excluded",
    "supplierStatus",
    "sourceSummary",
    "sourceRefs",
    "timingSummary",
    "note",
    "reason",
  ]];
  traceRows.forEach((row) => {
    traceSheetRows.push([
      row.label || "",
      row.sku || "",
      row.month || "",
      row.systemQty,
      row.finalQty,
      row.deviation,
      row.excluded ? "yes" : "no",
      row.supplierStatus || "",
      row.sourceSummary || "",
      row.sourceRefs || "",
      row.timingSummary || "",
      row.note || "",
      row.reason || "",
    ]);
  });

  return {
    sheets: [
      { name: "Lieferant", rows: supplierSheetRows },
      { name: "Intern Trace", rows: traceSheetRows },
    ],
  };
}

export async function buildSupplierOutlookWorkbookBlob(model) {
  const workbook = buildSupplierOutlookWorkbookModel(model);
  const sheets = workbook.sheets || [];
  const entries = [
    { name: "[Content_Types].xml", data: buildContentTypesXml(sheets) },
    { name: "_rels/.rels", data: buildRootRelsXml() },
    { name: "xl/workbook.xml", data: buildWorkbookXml(sheets) },
    { name: "xl/_rels/workbook.xml.rels", data: buildWorkbookRelsXml(sheets) },
    ...sheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: buildSheetXml(sheet.rows || []),
    })),
  ];
  return buildZipBlob(entries, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
