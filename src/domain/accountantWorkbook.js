import { buildZipBlob } from "./accountantBundle.js";
import {
  ACCOUNTANT_CELL_TYPES,
  ACCOUNTANT_SHEET_SCHEMAS,
  buildAccountantOverviewRows,
  formatAccountantDisplayValue,
  resolveAccountantStatusTone,
} from "./accountantPresentation.js";

const XML_HEADER = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>";
const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const CUSTOM_NUMFMT_DATE = 164;
const CUSTOM_NUMFMT_CURRENCY = 165;
const CUSTOM_NUMFMT_INTEGER = 166;

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

function toFiniteNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number;
}

function isoDateToExcelSerial(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);
  return (utc / 86400000) + 25569;
}

function buildStyles() {
  const numFmts = [
    `<numFmt numFmtId="${CUSTOM_NUMFMT_DATE}" formatCode="dd&quot;.&quot;mm&quot;.&quot;yyyy"/>`,
    `<numFmt numFmtId="${CUSTOM_NUMFMT_CURRENCY}" formatCode="#,##0.00 &quot;EUR&quot;"/>`,
    `<numFmt numFmtId="${CUSTOM_NUMFMT_INTEGER}" formatCode="#,##0"/>`,
  ].join("");

  const fonts = [
    '<font><sz val="11"/><name val="Aptos"/><family val="2"/><color rgb="FF1F2933"/></font>',
    '<font><b/><sz val="11"/><name val="Aptos"/><family val="2"/><color rgb="FF1F2933"/></font>',
    '<font><u/><sz val="11"/><name val="Aptos"/><family val="2"/><color rgb="FF0B57D0"/></font>',
  ].join("");

  const fills = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFE9EEF3"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFEAF1F7"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF4D6"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFDE6E7"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF7F3E8"/><bgColor indexed="64"/></patternFill></fill>',
  ].join("");

  const borders = [
    "<border><left/><right/><top/><bottom/><diagonal/></border>",
    "<border><left style=\"thin\"><color rgb=\"FFD3D9E0\"/></left><right style=\"thin\"><color rgb=\"FFD3D9E0\"/></right><top style=\"thin\"><color rgb=\"FFD3D9E0\"/></top><bottom style=\"thin\"><color rgb=\"FFD3D9E0\"/></bottom><diagonal/></border>",
    "<border><left style=\"thin\"><color rgb=\"FFD3D9E0\"/></left><right style=\"thin\"><color rgb=\"FFD3D9E0\"/></right><top style=\"medium\"><color rgb=\"FFB8C2CC\"/></top><bottom style=\"thin\"><color rgb=\"FFD3D9E0\"/></bottom><diagonal/></border>",
  ].join("");

  const cellXfs = [
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>',
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>',
    '<xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>',
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>',
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>',
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>',
    `<xf numFmtId="${CUSTOM_NUMFMT_INTEGER}" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>`,
    `<xf numFmtId="${CUSTOM_NUMFMT_CURRENCY}" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>`,
    `<xf numFmtId="${CUSTOM_NUMFMT_DATE}" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>`,
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>',
    '<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>',
    '<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>',
    '<xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>',
    '<xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>',
    '<xf numFmtId="0" fontId="1" fillId="6" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>',
    `<xf numFmtId="${CUSTOM_NUMFMT_INTEGER}" fontId="1" fillId="6" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>`,
    `<xf numFmtId="${CUSTOM_NUMFMT_CURRENCY}" fontId="1" fillId="6" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>`,
  ].join("");

  const xml = `${XML_HEADER}<styleSheet xmlns="${MAIN_NS}"><numFmts count="3">${numFmts}</numFmts><fonts count="3">${fonts}</fonts><fills count="7">${fills}</fills><borders count="3">${borders}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="18">${cellXfs}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return {
    xml,
    ids: {
      header: 1,
      overviewLabel: 2,
      sectionLabel: 3,
      text: 4,
      textWrap: 5,
      identifier: 6,
      integer: 7,
      currency: 8,
      date: 9,
      link: 10,
      plannedText: 11,
      plannedWrap: 12,
      warningText: 13,
      warningWrap: 14,
      summaryText: 15,
      summaryInteger: 16,
      summaryCurrency: 17,
    },
  };
}

function resolveCellStyleId(styles, cell) {
  if (cell.kind === "header") return styles.ids.header;
  if (cell.kind === "overviewLabel") return styles.ids.overviewLabel;
  if (cell.kind === "sectionLabel") return styles.ids.sectionLabel;
  if (cell.kind === "summary") {
    if (cell.cellType === ACCOUNTANT_CELL_TYPES.currency) return styles.ids.summaryCurrency;
    if (cell.cellType === ACCOUNTANT_CELL_TYPES.integer) return styles.ids.summaryInteger;
    return styles.ids.summaryText;
  }

  if (cell.tone === "warning") {
    return cell.wrap ? styles.ids.warningWrap : styles.ids.warningText;
  }
  if (cell.tone === "planned") {
    return cell.wrap ? styles.ids.plannedWrap : styles.ids.plannedText;
  }

  if (cell.cellType === ACCOUNTANT_CELL_TYPES.currency) return styles.ids.currency;
  if (cell.cellType === ACCOUNTANT_CELL_TYPES.integer) return styles.ids.integer;
  if (cell.cellType === ACCOUNTANT_CELL_TYPES.date) return styles.ids.date;
  if (cell.cellType === ACCOUNTANT_CELL_TYPES.link) return styles.ids.link;
  if (cell.cellType === ACCOUNTANT_CELL_TYPES.identifier) return styles.ids.identifier;
  return cell.wrap ? styles.ids.textWrap : styles.ids.text;
}

function buildWorkbookXml(sheets) {
  const sheetXml = sheets
    .map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join("");
  return `${XML_HEADER}<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheets>${sheetXml}</sheets></workbook>`;
}

function buildWorkbookRelsXml(sheets) {
  const rels = sheets
    .map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`)
    .concat('<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>')
    .join("");
  return `${XML_HEADER}<Relationships xmlns="${PACKAGE_REL_NS}">${rels}</Relationships>`;
}

function buildContentTypesXml(sheets) {
  const overrides = sheets
    .map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .concat('<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>')
    .join("");
  return `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}</Types>`;
}

function buildRootRelsXml() {
  return `${XML_HEADER}<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
}

function emptyCell(value = "", extra = {}) {
  return {
    value,
    cellType: ACCOUNTANT_CELL_TYPES.text,
    ...extra,
  };
}

function makeDataCell(column, value, extra = {}) {
  return {
    value,
    cellType: column.cellType || ACCOUNTANT_CELL_TYPES.text,
    wrap: column.wrap === true,
    alignment: column.alignment || "left",
    linkLabel: column.linkLabel,
    ...extra,
  };
}

function buildOverviewSheet(report) {
  const rows = [];

  buildAccountantOverviewRows(report).forEach((entry) => {
    rows.push([
      emptyCell(entry.label, { kind: "overviewLabel" }),
      emptyCell(entry.value, {
        cellType: entry.cellType,
      }),
    ]);
  });

  rows.push([emptyCell(""), emptyCell("")]);
  rows.push([emptyCell("Bewertungsgrundlage", { kind: "sectionLabel" }), emptyCell("")]);
  rows.push([emptyCell(""), emptyCell(report?.uebersicht?.bewertungsgrundlageText || "", { wrap: true })]);
  rows.push([emptyCell(""), emptyCell("")]);
  rows.push([emptyCell("Vollstaendigkeit innerhalb der Plattform", { kind: "sectionLabel" }), emptyCell("")]);
  rows.push([emptyCell(""), emptyCell(report?.uebersicht?.vollstaendigkeitInnerhalbPlattformText || "", { wrap: true })]);
  rows.push([emptyCell(""), emptyCell("")]);
  rows.push([emptyCell("Manuell ausserhalb der Plattform beizulegen", { kind: "sectionLabel" }), emptyCell("")]);
  (report?.uebersicht?.manuellAusserhalbPlattformBeizulegen || []).forEach((entry) => {
    rows.push([emptyCell(""), emptyCell(entry, { wrap: true })]);
  });

  return {
    name: "Uebersicht",
    columns: [
      { width: 34 },
      { width: 92 },
    ],
    rows,
    freezeHeader: false,
    autoFilter: false,
    filterRowCount: 0,
  };
}

function buildHeaderRow(columns) {
  return columns.map((column) => ({
    value: column.label,
    cellType: ACCOUNTANT_CELL_TYPES.text,
    wrap: true,
    kind: "header",
  }));
}

function buildSummaryCells(tableKey, report, columnCount) {
  const cells = Array.from({ length: columnCount }, () => emptyCell("", { kind: "summary" }));

  if (tableKey === "payments") {
    cells[0] = emptyCell(`Summe (${report.zahlungenLieferanten.length} Zahlungen)`, { kind: "summary" });
    cells[6] = { value: report.uebersicht.summeZahlungenIstEur || 0, cellType: ACCOUNTANT_CELL_TYPES.currency, kind: "summary" };
    const usdTotal = report.zahlungenLieferanten.reduce((sum, row) => sum + (Number(row?.betragUsd) || 0), 0);
    cells[7] = { value: usdTotal || 0, cellType: ACCOUNTANT_CELL_TYPES.currency, kind: "summary" };
    return cells;
  }

  if (tableKey === "arrivals") {
    cells[0] = emptyCell(`Summe (${report.wareneingaenge.length} Wareneingaenge)`, { kind: "summary" });
    const qty = report.wareneingaenge.reduce((sum, row) => sum + (Number(row?.gesamtmenge) || 0), 0);
    const usd = report.wareneingaenge.reduce((sum, row) => sum + (Number(row?.warenwertUsd) || 0), 0);
    cells[7] = { value: qty || 0, cellType: ACCOUNTANT_CELL_TYPES.integer, kind: "summary" };
    cells[8] = { value: usd || 0, cellType: ACCOUNTANT_CELL_TYPES.currency, kind: "summary" };
    cells[9] = { value: report.uebersicht.summeBestaetigteWareneingaengeEur || 0, cellType: ACCOUNTANT_CELL_TYPES.currency, kind: "summary" };
    return cells;
  }

  if (tableKey === "inventory") {
    cells[0] = emptyCell("Summe", { kind: "summary" });
    cells[3] = { value: report.inventory.totalAmazonUnits || 0, cellType: ACCOUNTANT_CELL_TYPES.integer, kind: "summary" };
    cells[4] = { value: report.inventory.total3plUnits || 0, cellType: ACCOUNTANT_CELL_TYPES.integer, kind: "summary" };
    cells[5] = { value: report.inventory.totalInTransitUnits || 0, cellType: ACCOUNTANT_CELL_TYPES.integer, kind: "summary" };
    const totalUnits = (report.inventory.totalAmazonUnits || 0) + (report.inventory.total3plUnits || 0) + (report.inventory.totalInTransitUnits || 0);
    cells[6] = { value: totalUnits, cellType: ACCOUNTANT_CELL_TYPES.integer, kind: "summary" };
    cells[8] = { value: report.inventory.totalValueEur || 0, cellType: ACCOUNTANT_CELL_TYPES.currency, kind: "summary" };
    return cells;
  }

  return cells;
}

function buildTabularSheet(tableKey, report, rows, includeSummary = true) {
  const schema = ACCOUNTANT_SHEET_SCHEMAS[tableKey];
  const sheetRows = [buildHeaderRow(schema.columns)];
  rows.forEach((row) => {
    sheetRows.push(schema.columns.map((column) => makeDataCell(column, row?.[column.key], {
      tone: resolveAccountantStatusTone(tableKey, column.key, row),
      linkTarget: column.cellType === ACCOUNTANT_CELL_TYPES.link ? row?.[column.key] : null,
    })));
  });

  if (includeSummary) {
    sheetRows.push(schema.columns.map(() => emptyCell("")));
    sheetRows.push(buildSummaryCells(tableKey, report, schema.columns.length));
  }

  return {
    name: schema.name,
    columns: schema.columns.map((column) => ({ width: column.columnWidth || 16 })),
    rows: sheetRows,
    freezeHeader: true,
    autoFilter: true,
    filterRowCount: rows.length + 1,
  };
}

function buildQualitySheet(report) {
  const rows = Array.isArray(report?.pruefhinweise) ? report.pruefhinweise : [];
  if (!rows.length) return null;
  return buildTabularSheet("quality", report, rows, false);
}

function buildSheets(report) {
  const sheets = [
    buildOverviewSheet(report),
    buildTabularSheet("payments", report, report.zahlungenLieferanten || []),
    buildTabularSheet("arrivals", report, report.wareneingaenge || []),
    buildTabularSheet("inventory", report, report.warenbestandRows || []),
  ];

  const qualitySheet = buildQualitySheet(report);
  if (qualitySheet) sheets.push(qualitySheet);
  return sheets;
}

function buildColsXml(columns = []) {
  if (!columns.length) return "";
  const cols = columns
    .map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${Number(column.width || 16)}" customWidth="1"/>`)
    .join("");
  return `<cols>${cols}</cols>`;
}

function toCellXml(cell, rowIndex, columnIndex, styles, hyperlinks) {
  const ref = cellRef(columnIndex, rowIndex);
  const styleId = resolveCellStyleId(styles, cell);
  const styleAttr = ` s="${styleId}"`;

  if (cell.cellType === ACCOUNTANT_CELL_TYPES.date) {
    const serial = isoDateToExcelSerial(cell.value);
    if (serial != null) {
      return `<c r="${ref}"${styleAttr}><v>${serial}</v></c>`;
    }
  }

  if (cell.cellType === ACCOUNTANT_CELL_TYPES.integer || cell.cellType === ACCOUNTANT_CELL_TYPES.currency) {
    const number = toFiniteNumber(cell.value);
    if (number != null) {
      return `<c r="${ref}"${styleAttr}><v>${number}</v></c>`;
    }
  }

  if (cell.cellType === ACCOUNTANT_CELL_TYPES.link) {
    const target = String(cell.linkTarget || "").trim();
    if (target) {
      hyperlinks.push({
        ref,
        target,
      });
      const display = escapeXml(formatAccountantDisplayValue(ACCOUNTANT_CELL_TYPES.link, target, {
        emptyValue: "",
        linkLabel: cell.linkLabel,
      }));
      return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${display}</t></is></c>`;
    }
  }

  const display = escapeXml(cell.value == null ? "" : String(cell.value));
  return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${display}</t></is></c>`;
}

function buildSheetXml(sheet, styles) {
  const hyperlinks = [];
  const rowXml = sheet.rows
    .map((cells, rowOffset) => {
      const rowIndex = rowOffset + 1;
      const cellXml = cells.map((cell, columnIndex) => toCellXml(cell, rowIndex, columnIndex, styles, hyperlinks)).join("");
      return `<row r="${rowIndex}">${cellXml}</row>`;
    })
    .join("");
  const lastCol = Math.max(sheet.columns.length, sheet.rows.reduce((max, row) => Math.max(max, row.length), 0)) || 1;
  const lastRow = Math.max(sheet.rows.length, 1);
  const dimension = `A1:${cellRef(lastCol - 1, lastRow)}`;
  const sheetViews = sheet.freezeHeader
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>`
    : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;
  const autoFilter = sheet.autoFilter && sheet.filterRowCount > 1
    ? `<autoFilter ref="A1:${cellRef(lastCol - 1, sheet.filterRowCount)}"/>`
    : "";
  const hyperlinksXml = hyperlinks.length
    ? `<hyperlinks>${hyperlinks.map((entry, index) => `<hyperlink ref="${entry.ref}" r:id="rId${index + 1}"/>`).join("")}</hyperlinks>`
    : "";
  const xml = `${XML_HEADER}<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><dimension ref="${dimension}"/>${sheetViews}<sheetFormatPr defaultRowHeight="18"/>${buildColsXml(sheet.columns)}<sheetData>${rowXml}</sheetData>${autoFilter}${hyperlinksXml}</worksheet>`;
  const rels = hyperlinks.length
    ? `${XML_HEADER}<Relationships xmlns="${PACKAGE_REL_NS}">${hyperlinks.map((entry, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXml(entry.target)}" TargetMode="External"/>`).join("")}</Relationships>`
    : null;

  return { xml, rels };
}

export async function buildAccountantWorkbookBlob(report) {
  const styles = buildStyles();
  const sheets = buildSheets(report);
  const entries = [
    { name: "[Content_Types].xml", data: buildContentTypesXml(sheets) },
    { name: "_rels/.rels", data: buildRootRelsXml() },
    { name: "xl/workbook.xml", data: buildWorkbookXml(sheets) },
    { name: "xl/_rels/workbook.xml.rels", data: buildWorkbookRelsXml(sheets) },
    { name: "xl/styles.xml", data: styles.xml },
  ];

  sheets.forEach((sheet, index) => {
    const sheetXml = buildSheetXml(sheet, styles);
    entries.push({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: sheetXml.xml,
    });
    if (sheetXml.rels) {
      entries.push({
        name: `xl/worksheets/_rels/sheet${index + 1}.xml.rels`,
        data: sheetXml.rels,
      });
    }
  });

  return buildZipBlob(
    entries,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
}
