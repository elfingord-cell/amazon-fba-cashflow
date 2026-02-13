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

function normalizeNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number;
}

function toCellXml(value, rowIndex, columnIndex) {
  const ref = cellRef(columnIndex, rowIndex);
  if (value == null || value === "") {
    return `<c r=\"${ref}\" t=\"inlineStr\"><is><t></t></is></c>`;
  }
  const asNumber = normalizeNumber(value);
  if (asNumber != null && typeof value !== "string") {
    return `<c r=\"${ref}\"><v>${asNumber}</v></c>`;
  }
  if (asNumber != null && /^-?\d+(?:[.,]\d+)?$/.test(String(value).trim())) {
    return `<c r=\"${ref}\"><v>${String(value).replace(",", ".")}</v></c>`;
  }
  return `<c r=\"${ref}\" t=\"inlineStr\"><is><t xml:space=\"preserve\">${escapeXml(value)}</t></is></c>`;
}

function buildSheetXml(rows) {
  const rowXml = rows
    .map((cells, index) => {
      const rowIndex = index + 1;
      const cellXml = cells.map((value, columnIndex) => toCellXml(value, rowIndex, columnIndex)).join("");
      return `<row r=\"${rowIndex}\">${cellXml}</row>`;
    })
    .join("");
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

function mapIssueRows(issues) {
  const rows = [["code", "severity", "message", "entityType", "entityId"]];
  (issues || []).forEach((issue) => {
    rows.push([
      issue.code || "",
      issue.severity || "",
      issue.message || "",
      issue.entityType || "",
      issue.entityId || "",
    ]);
  });
  return rows;
}

function buildSheets(report) {
  const inventory = report.inventory || {};
  const inventoryRows = report.inventoryRows || [];
  const deposits = report.deposits || [];
  const arrivals = report.arrivals || [];

  const summaryRows = [
    ["Monat", report.request?.month || ""],
    ["Snapshot As Of", inventory.snapshotAsOf || ""],
    ["Warenwert EUR", inventory.totalValueEur],
    ["Amazon Units", inventory.totalAmazonUnits],
    ["3PL Units", inventory.total3plUnits],
    ["In Transit Units", inventory.totalInTransitUnits],
    ["Anzahlungen PO", deposits.length],
    ["Wareneingaenge PO", arrivals.length],
    ["Manual Override Used", inventory.manualOverrideUsed ? "yes" : "no"],
    ["Quality Issues", (report.quality || []).length],
  ];

  const inventorySheetRows = [[
    "SKU",
    "Alias",
    "Kategorie",
    "Amazon Units",
    "3PL Units",
    "In Transit Units",
    "Total Units",
    "EK EUR",
    "Warenwert EUR",
    "Notiz",
  ]];
  inventoryRows.forEach((row) => {
    inventorySheetRows.push([
      row.sku || "",
      row.alias || "",
      row.category || "",
      row.amazonUnits,
      row.threePLUnits,
      row.inTransitUnits,
      row.totalUnits,
      row.ekEur,
      row.rowValueEur,
      row.note || "",
    ]);
  });

  const depositRows = [[
    "PO Number",
    "Supplier",
    "SKU Aliases",
    "Payment Type",
    "Planned EUR",
    "Actual EUR",
    "Paid Date",
    "Due Date",
    "Amount USD",
    "ETD Date",
    "ETA Date",
    "Arrival Date",
    "Invoice URL",
    "Folder URL",
    "Issues",
  ]];
  deposits.forEach((row) => {
    depositRows.push([
      row.poNumber || "",
      row.supplier || "",
      row.skuAliases || "",
      row.paymentType || "",
      row.plannedEur,
      row.actualEur,
      row.paidDate || "",
      row.dueDate || "",
      row.amountUsd,
      row.etdDate || "",
      row.etaDate || "",
      row.arrivalDate || "",
      row.invoiceUrl || "",
      row.folderUrl || "",
      (row.issues || []).join(" | "),
    ]);
  });

  const arrivalRows = [[
    "PO Number",
    "Supplier",
    "SKU Aliases",
    "Units",
    "Goods USD",
    "Goods EUR",
    "ETD Date",
    "ETA Date",
    "Arrival Date",
    "Transport",
    "Issues",
  ]];
  arrivals.forEach((row) => {
    arrivalRows.push([
      row.poNumber || "",
      row.supplier || "",
      row.skuAliases || "",
      row.units,
      row.goodsUsd,
      row.goodsEur,
      row.etdDate || "",
      row.etaDate || "",
      row.arrivalDate || "",
      row.transport || "",
      (row.issues || []).join(" | "),
    ]);
  });

  const sheets = [
    { name: "Summary", rows: summaryRows },
    { name: "Warenbestand", rows: inventorySheetRows },
    { name: "Anzahlungen_PO", rows: depositRows },
    { name: "Wareneingang_PO", rows: arrivalRows },
    { name: "Quality", rows: mapIssueRows(report.quality || []) },
  ];

  if (Array.isArray(report.journalRows) && report.journalRows.length) {
    const journalRows = [[
      "month",
      "entityType",
      "poNumber",
      "supplierName",
      "skuAliases",
      "paymentType",
      "status",
      "dueDate",
      "paidDate",
      "amountPlannedEur",
      "amountActualEur",
      "issues",
      "paymentId",
    ]];
    report.journalRows.forEach((row) => {
      journalRows.push([
        row.month || "",
        row.entityType || "",
        row.poNumber || "",
        row.supplierName || "",
        row.skuAliases || "",
        row.paymentType || "",
        row.status || "",
        row.dueDate || "",
        row.paidDate || "",
        row.amountPlannedEur,
        row.amountActualEur,
        Array.isArray(row.issues) ? row.issues.join(" | ") : "",
        row.paymentId || "",
      ]);
    });
    sheets.push({ name: "Zahlungsjournal", rows: journalRows });
  }

  return sheets;
}

export async function buildAccountantWorkbookBlob(report) {
  const sheets = buildSheets(report);
  const entries = [
    { name: "[Content_Types].xml", data: buildContentTypesXml(sheets) },
    { name: "_rels/.rels", data: buildRootRelsXml() },
    { name: "xl/workbook.xml", data: buildWorkbookXml(sheets) },
    { name: "xl/_rels/workbook.xml.rels", data: buildWorkbookRelsXml(sheets) },
  ];

  sheets.forEach((sheet, index) => {
    entries.push({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: buildSheetXml(sheet.rows || []),
    });
  });

  return buildZipBlob(
    entries,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
}
