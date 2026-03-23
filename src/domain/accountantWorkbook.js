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

function buildOverviewRows(report) {
  const overview = report.uebersicht || {};
  const inventory = report.inventory || {};
  const rows = [
    ["Monat", overview.monat || report.request?.month || ""],
    ["Verbindliche Datei", overview.verbindlicheDatei || ""],
    ["Bestandsstichtag", overview.bestandStichtag || inventory.snapshotAsOf || ""],
    ["Warenwert EUR", inventory.totalValueEur],
    ["Zahlungen Lieferanten", overview.anzahlZahlungenLieferanten || 0],
    ["Summe Zahlungen Ist EUR", overview.summeZahlungenIstEur || 0],
    ["Wareneingaenge", overview.anzahlWareneingaenge || 0],
    ["Summe Wareneingaenge EUR", overview.summeWareneingaengeEur || 0],
    ["Pruefhinweise", overview.anzahlPruefhinweise || 0],
    [""],
    ["Bewertungsgrundlage", overview.bewertungsgrundlageText || ""],
    [""],
    ["Vollstaendigkeit innerhalb der Plattform", overview.vollstaendigkeitInnerhalbPlattformText || ""],
    [""],
    ["Manuell ausserhalb der Plattform beizulegen", ""],
  ];

  (overview.manuellAusserhalbPlattformBeizulegen || []).forEach((entry) => {
    rows.push(["", entry]);
  });

  return rows;
}

function buildSheets(report) {
  const inventoryRows = report.warenbestandRows || report.inventoryRows || [];
  const zahlungenLieferanten = report.zahlungenLieferanten || report.paymentsInMonth || [];
  const wareneingaenge = report.wareneingaenge || report.arrivalsInMonth || [];
  const pruefhinweise = report.pruefhinweise || report.quality || [];

  const overviewRows = buildOverviewRows(report);

  const paymentRows = [[
    "Fachliche Behandlung",
    "Zahlungsdatum",
    "Lieferant",
    "Bestellnummer (intern)",
    "Verknuepfte Bestellung",
    "Zahlungsart",
    "Betrag Ist EUR",
    "Betrag USD",
    "Artikel / Mengen",
    "Geplante Abfahrt",
    "Geplante Ankunft",
    "Wareneingang laut System",
    "Datengrundlage Wareneingang",
    "Status zur Bestellung",
    "Beleglink",
    "Hinweis",
  ]];
  zahlungenLieferanten.forEach((row) => {
    paymentRows.push([
      row.fachlicheBehandlung || "",
      row.zahlungsdatum || "",
      row.lieferant || "",
      row.bestellnummerIntern || "",
      row.verknuepfteBestellung || "",
      row.zahlungsart || "",
      row.betragIstEur,
      row.betragUsd,
      row.artikelMengen || "",
      row.geplanteAbfahrt || "",
      row.geplanteAnkunft || "",
      row.wareneingangLautSystem || "",
      row.wareneingangGrundlageLabel || "",
      row.statusZurBestellung || "",
      row.beleglink || "",
      row.hinweis || "",
    ]);
  });

  const arrivalRows = [[
    "Fachliche Behandlung",
    "Wareneingang laut System",
    "Datengrundlage Wareneingang",
    "Lieferant",
    "Bestellnummer (intern)",
    "Verknuepfte Bestellung",
    "Artikel / Mengen",
    "Gesamtmenge",
    "Warenwert USD",
    "Warenwert EUR",
    "Geplante Abfahrt",
    "Geplante Ankunft",
    "Bisherige Lieferantenzahlungen laut System EUR",
    "Davon im aktuellen Monat bezahlt EUR",
    "Transportart",
    "Hinweis",
  ]];
  wareneingaenge.forEach((row) => {
    arrivalRows.push([
      row.fachlicheBehandlung || "",
      row.wareneingangLautSystem || "",
      row.wareneingangGrundlageLabel || "",
      row.lieferant || "",
      row.bestellnummerIntern || "",
      row.verknuepfteBestellung || "",
      row.artikelMengen || "",
      row.gesamtmenge,
      row.warenwertUsd,
      row.warenwertEur,
      row.geplanteAbfahrt || "",
      row.geplanteAnkunft || "",
      row.bisherigeLieferantenzahlungenEur,
      row.davonImMonatBezahltEur,
      row.transportart || "",
      row.hinweis || "",
    ]);
  });

  const inventorySheetRows = [[
    "Artikelnummer / SKU",
    "Artikelbezeichnung",
    "Warengruppe",
    "Bestand Amazon",
    "Bestand externes Lager",
    "Bestand im Zulauf",
    "Gesamtbestand",
    "Einstandspreis EUR",
    "Bestandswert EUR",
    "Hinweis",
  ]];
  inventoryRows.forEach((row) => {
    inventorySheetRows.push([
      row.artikelnummerSku || row.sku || "",
      row.artikelbezeichnung || row.alias || "",
      row.warengruppe || row.category || "",
      row.bestandAmazon ?? row.amazonUnits,
      row.bestandExternesLager ?? row.threePLUnits,
      row.bestandImZulauf ?? row.inTransitUnits,
      row.gesamtbestand ?? row.totalUnits,
      row.einstandspreisEur ?? row.ekEur,
      row.bestandswertEur ?? row.rowValueEur,
      row.hinweis || row.note || "",
    ]);
  });

  const sheets = [
    { name: "Uebersicht", rows: overviewRows },
    { name: "Zahlungen Lieferanten", rows: paymentRows },
    { name: "Wareneingaenge", rows: arrivalRows },
    { name: "Warenbestand Monatsende", rows: inventorySheetRows },
  ];

  if (Array.isArray(pruefhinweise) && pruefhinweise.length) {
    const qualityRows = [[
      "Bereich",
      "Bezug",
      "Hinweis",
      "Relevanz fuer Buchhaltung",
    ]];
    pruefhinweise.forEach((issue) => {
      qualityRows.push([
        issue.bereich || "",
        issue.bezug || "",
        issue.hinweis || issue.message || "",
        issue.relevanzFuerBuchhaltung || "",
      ]);
    });
    sheets.push({ name: "Pruefhinweise", rows: qualityRows });
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
