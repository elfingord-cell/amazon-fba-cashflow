import {
  buildAccountantOverviewRows,
  formatAccountantDisplayValue,
  hasWarningHint,
} from "./accountantPresentation.js";

const PAGE_PORTRAIT = { width: 595, height: 842, marginX: 40, marginTop: 40, marginBottom: 36 };
const PAGE_LANDSCAPE = { width: 842, height: 595, marginX: 42, marginTop: 34, marginBottom: 30 };
const COLORS = {
  ink: [28, 37, 46],
  muted: [96, 108, 124],
  line: [212, 218, 224],
  panel: [245, 247, 249],
  panelAlt: [250, 251, 252],
  brand: [31, 61, 90],
  brandSoft: [231, 238, 244],
  accent: [191, 140, 71],
  accentSoft: [247, 240, 229],
  goldSoft: [247, 242, 229],
  warnSoft: [253, 236, 235],
  white: [255, 255, 255],
};

const PDF_TABLES = [
  {
    key: "payments",
    pageLayout: "portrait",
    pageCapacity: { first: 16, next: 20 },
    title: "Zahlungen an Lieferanten",
    subtitle: (report) => `${report.zahlungenLieferanten.length} im Monat bezahlte Vorgaenge`,
    rows: (report) => report.zahlungenLieferanten || [],
    columns: [
      { key: "zahlungsdatum", label: "Datum", width: 70, cellType: "date" },
      { key: "lieferant", label: "Lieferant", width: 74, cellType: "text", maxLines: 2 },
      { key: "bestellnummerIntern", label: "Bestellnr.", width: 54, cellType: "text" },
      { key: "fachlicheBehandlung", label: "Bitte buchen als", width: 104, cellType: "text", maxLines: 3 },
      { key: "betragIstEur", label: "Betrag EUR", width: 66, cellType: "currency", align: "right" },
      { key: "geplanteAnkunft", label: "Ankunft", width: 66, cellType: "date" },
      { key: "statusZurBestellung", label: "Stand", width: 74, cellType: "text", maxLines: 2 },
    ],
  },
  {
    key: "arrivals",
    pageLayout: "portrait",
    pageCapacity: { first: 16, next: 20 },
    title: "Ware im Monat angekommen",
    subtitle: (report) => `${report.wareneingaenge.length} bestaetigte Wareneingaenge im Monat`,
    rows: (report) => report.wareneingaenge || [],
    columns: [
      { key: "wareneingangLautSystem", label: "Datum", width: 68, cellType: "date" },
      { key: "lieferant", label: "Lieferant", width: 88, cellType: "text", maxLines: 2 },
      { key: "bestellnummerIntern", label: "Bestellnr.", width: 58, cellType: "text" },
      { key: "warenwertEur", label: "Wert EUR", width: 76, cellType: "currency", align: "right" },
      { key: "davonImMonatBezahltEur", label: "Zur Bestellung bezahlt", width: 98, cellType: "currency", align: "right" },
      { key: "hinweis", label: "Hinweis", width: 127, cellType: "text", maxLines: 2 },
    ],
  },
  {
    key: "inventory",
    pageLayout: "landscape",
    pageCapacity: { first: 10, next: 12 },
    title: "Warenbestand zum Monatsende",
    subtitle: (report) => `Bestandsstichtag ${formatAccountantDisplayValue("date", report.inventory?.snapshotAsOf)}`,
    rows: (report) => report.warenbestandRows || [],
    rowSort: (rows) => rows.slice().sort((left, right) => (Number(right?.bestandswertEur) || 0) - (Number(left?.bestandswertEur) || 0)),
    columns: [
      { key: "artikelnummerSku", label: "Artikelnummer", width: 150, cellType: "text", maxLines: 1 },
      { key: "artikelbezeichnung", label: "Artikel", width: 260, cellType: "text", maxLines: 1 },
      { key: "gesamtbestand", label: "Bestand", width: 70, cellType: "integer", align: "right" },
      { key: "einstandspreisEur", label: "Einstandspreis", width: 90, cellType: "currency", align: "right" },
      { key: "bestandswertEur", label: "Bestandswert", width: 110, cellType: "currency", align: "right" },
      { key: "hinweis", label: "Hinweis", width: 80, cellType: "text", maxLines: 1 },
    ],
  },
];

function getPageMetrics(layout) {
  return layout === "landscape" ? PAGE_LANDSCAPE : PAGE_PORTRAIT;
}

function rgb(values) {
  return values.map((value) => (value / 255).toFixed(3)).join(" ");
}

function escapePdfText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function rect(x, y, width, height, fill, stroke = null, lineWidth = 1) {
  const parts = [];
  if (fill) parts.push(`${rgb(fill)} rg`);
  if (stroke) parts.push(`${rgb(stroke)} RG ${lineWidth} w`);
  parts.push(`${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re ${fill && stroke ? "B" : fill ? "f" : "S"}`);
  return parts.join("\n");
}

function line(x1, y1, x2, y2, stroke, lineWidth = 1) {
  return `${rgb(stroke)} RG ${lineWidth} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`;
}

function text(x, y, value, options = {}) {
  const font = options.font === "bold" ? "F2" : "F1";
  const size = Number(options.size || 10);
  const color = rgb(options.color || COLORS.ink);
  return `BT\n/${font} ${size} Tf\n${color} rg\n1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm\n(${escapePdfText(value)}) Tj\nET`;
}

function wrapText(textValue, width, fontSize, maxLines = Infinity) {
  const raw = String(textValue ?? "").trim();
  if (!raw) return [""];
  const charWidth = Math.max(5, fontSize * 0.62);
  const maxChars = Math.max(4, Math.floor(width / charWidth));
  if (raw.length <= maxChars) return [raw];

  const words = raw.split(/\s+/).flatMap((word) => {
    if (word.length <= maxChars) return [word];
    const chunks = [];
    let rest = word;
    while (rest.length > maxChars) {
      chunks.push(rest.slice(0, maxChars - 1));
      rest = rest.slice(maxChars - 1);
    }
    if (rest) chunks.push(rest);
    return chunks;
  });
  const lines = [];
  let current = "";

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
      return;
    }
    if (current) lines.push(current);
    current = word;
  });

  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const trimmed = lines.slice(0, maxLines);
  const last = trimmed[maxLines - 1] || "";
  trimmed[maxLines - 1] = last.length > 3 ? `${last.slice(0, Math.max(1, last.length - 3))}...` : "...";
  return trimmed;
}

function buildOverviewCards(report) {
  return buildAccountantOverviewRows(report).map((row) => {
    const formatted = formatAccountantDisplayValue(row.cellType, row.value, { emptyValue: "n/a" });
    return {
      label: row.label,
      value: row.cellType === "currency" && formatted !== "n/a" ? `${formatted} EUR` : formatted,
    };
  });
}

function buildSectionCards(report) {
  const inventoryValue = formatAccountantDisplayValue("currency", report.inventory?.totalValueEur ?? report.inventory?.inventoryValueEur, { emptyValue: "-" });
  return {
    payments: [
      { label: "Zahlungen", value: String(report.zahlungenLieferanten.length || 0) },
      { label: "Summe", value: `${formatAccountantDisplayValue("currency", report.uebersicht?.summeZahlungenIstEur ?? report.uebersicht?.summeLieferantenzahlungenEur, { emptyValue: "-" })} EUR` },
      { label: "Offene Hinweise", value: String((report.zahlungenLieferanten || []).filter((row) => String(row?.hinweis || "").trim()).length) },
    ],
    arrivals: [
      { label: "Angekommen", value: String(report.wareneingaenge.length || 0) },
      { label: "Wert", value: `${formatAccountantDisplayValue("currency", report.uebersicht?.summeBestaetigteWareneingaengeEur, { emptyValue: "-" })} EUR` },
      { label: "Im Monat bezahlt", value: `${formatAccountantDisplayValue("currency", (report.wareneingaenge || []).reduce((sum, row) => sum + (Number(row?.davonImMonatBezahltEur) || 0), 0), { emptyValue: "-" })} EUR` },
    ],
    inventory: [
      { label: "Stichtag", value: formatAccountantDisplayValue("date", report.inventory?.snapshotAsOf, { emptyValue: "-" }) },
      { label: "Artikel", value: String(report.warenbestandRows.length || 0) },
      { label: "Bestandswert", value: inventoryValue === "-" ? "-" : `${inventoryValue} EUR` },
    ],
    quality: [
      { label: "Hinweise", value: String(report.pruefhinweise?.length || 0) },
      { label: "Monat", value: String(report.request?.month || "-") },
      { label: "Datei", value: String(report.uebersicht?.verbindlicheDatei || "-") },
    ],
  };
}

function chunkRows(rows, firstPageCapacity, nextPageCapacity) {
  if (!rows.length) return [[]];
  const pages = [];
  let index = 0;
  let capacity = firstPageCapacity;
  while (index < rows.length) {
    pages.push(rows.slice(index, index + capacity));
    index += capacity;
    capacity = nextPageCapacity;
  }
  return pages;
}

function drawCoverPage(page, report, pageMetrics) {
  const contentWidth = pageMetrics.width - (pageMetrics.marginX * 2);
  const topY = pageMetrics.height - pageMetrics.marginTop;
  page.push(rect(0, pageMetrics.height - 206, pageMetrics.width, 206, COLORS.brand));
  page.push(rect(0, pageMetrics.height - 214, pageMetrics.width, 8, COLORS.accent));
  page.push(rect(pageMetrics.marginX, pageMetrics.height - 270, contentWidth, 74, COLORS.accentSoft));
  page.push(text(pageMetrics.marginX, topY - 6, `Buchhaltung ${report.request?.month || ""}`, { font: "bold", size: 28, color: COLORS.white }));
  page.push(text(pageMetrics.marginX, topY - 36, "Klarer Ueberblick fuer den Monatsabschluss", { size: 12, color: [223, 230, 236] }));
  page.push(text(pageMetrics.width - pageMetrics.marginX - 128, topY - 10, "Bitte zuerst diese Seite lesen", { size: 10, color: [223, 230, 236] }));
  page.push(text(pageMetrics.marginX + 16, pageMetrics.height - 224, "Bitte diese Excel-Datei fuer die Details verwenden", { font: "bold", size: 11, color: COLORS.ink }));
  page.push(text(pageMetrics.marginX + 16, pageMetrics.height - 246, report.uebersicht?.verbindlicheDatei || "-", { font: "bold", size: 12, color: COLORS.ink }));
  page.push(text(pageMetrics.marginX + 16, pageMetrics.height - 262, "Diese PDF ist die Uebersicht. Fuer die Arbeit nutzen Sie die Excel-Datei.", { size: 10, color: COLORS.muted }));

  const cards = buildOverviewCards(report);
  const cardGap = 14;
  const cardWidth = (contentWidth - cardGap) / 2;
  const cardHeight = 62;
  let x = pageMetrics.marginX;
  let yTop = pageMetrics.height - 304;

  cards.forEach((card, index) => {
    const boxY = yTop - cardHeight;
    page.push(rect(x, boxY, cardWidth, cardHeight, index % 2 === 0 ? COLORS.panel : COLORS.panelAlt, COLORS.line, 0.8));
    page.push(text(x + 14, yTop - 20, card.label, { size: 9, color: COLORS.muted }));
    page.push(text(x + 14, yTop - 44, card.value, { font: "bold", size: 15, color: COLORS.ink }));
    if (index % 2 === 1) {
      x = pageMetrics.marginX;
      yTop -= cardHeight + cardGap;
    } else {
      x += cardWidth + cardGap;
    }
  });

  const guideY = 184;
  page.push(rect(pageMetrics.marginX, guideY, contentWidth, 138, COLORS.brandSoft, COLORS.line, 0.8));
  page.push(text(pageMetrics.marginX + 16, guideY + 100, "So nutzen Sie dieses Paket", { font: "bold", size: 12, color: COLORS.ink }));
  [
    "1. Seite 1 zeigt den Monat auf einen Blick.",
    `2. Arbeiten Sie fuer Details in der Datei ${report.uebersicht?.verbindlicheDatei || "-"}.`,
    "3. 'Zahlungen an Lieferanten' zeigt alle im Monat bezahlten Vorgange.",
    "4. 'Ware im Monat angekommen' zeigt nur Ware, die im Monat wirklich angekommen ist.",
    "5. 'Warenbestand zum Monatsende' zeigt Bestand und Wert zum Stichtag.",
    "6. 'Ankunft' auf der Zahlungsseite meint die geplante Ankunft der Ware.",
    "7. Gelb bedeutet: geplant oder noch offen. Rot bedeutet: bitte kurz pruefen.",
  ].forEach((lineText, index) => {
    page.push(text(pageMetrics.marginX + 16, guideY + 78 - (index * 14), lineText, { size: 10, color: COLORS.ink }));
  });

  const noteY = 48;
  page.push(rect(pageMetrics.marginX, noteY, contentWidth, 104, COLORS.panel, COLORS.line, 0.8));
  page.push(text(pageMetrics.marginX + 16, noteY + 98, "Was diese Zahlen bedeuten", { font: "bold", size: 12, color: COLORS.ink }));
  [
    "Zahlungen: EUR zeigt den tatsaechlich bezahlten Betrag im Monat.",
    "Wareneingang: EUR zeigt den Warenwert der angekommenen Ware.",
    "Warenbestand: Wert ergibt sich aus Bestand mal Einstandspreis.",
  ].forEach((lineText, index) => {
    page.push(text(pageMetrics.marginX + 16, noteY + 72 - (index * 13), lineText, { size: 9, color: COLORS.ink }));
  });
  page.push(text(pageMetrics.marginX + 16, noteY + 18, "Diese PDF zeigt die Monatsuebersicht aus der Plattform. Fuer Details nutzen Sie die Excel-Datei.", { size: 8.5, color: COLORS.muted }));
}

function formatTableValue(config, column, row) {
  if (config.key === "inventory" && column.key === "hinweis" && !hasWarningHint(row?.hinweis)) {
    return "-";
  }
  if (config.key === "arrivals" && column.key === "hinweis" && !hasWarningHint(row?.hinweis)) {
    return "Kein offener Hinweis";
  }
  const rawValue = row?.[column.key];
  const formatted = formatAccountantDisplayValue(column.cellType || "text", rawValue, { emptyValue: "-" });
  return formatted;
}

function resolvePdfRowFill(config, row, rowIndex) {
  const hint = String(row?.hinweis || "").toLowerCase();
  if (hint.includes("pruefen") || hint.includes("unklar") || hint.includes("fehlt")) return COLORS.warnSoft;
  if (config.key === "payments" && !row?.wareneingangLautSystem && row?.geplanteAnkunft) return COLORS.goldSoft;
  return rowIndex % 2 === 0 ? COLORS.white : COLORS.panelAlt;
}

function buildSectionGuide(config, report) {
  if (config.key === "payments") {
    return {
      lines: [
        "Hier sehen Sie nur Zahlungen mit Zahlungsdatum im ausgewaehlten Monat.",
        "'Bitte buchen als' ist eine kurze Einordnung fuer die Buchhaltung.",
        "'Ankunft' meint die geplante Ankunft der Ware, nicht den echten Wareneingang.",
      ],
      highlightLabel: "Offene Hinweise",
      highlightValue: String((report.zahlungenLieferanten || []).filter((row) => String(row?.hinweis || "").trim()).length),
    };
  }
  if (config.key === "arrivals") {
    return {
      lines: [
        "Hier steht nur Ware, die im Monat wirklich angekommen ist.",
        "'Zur Bestellung bezahlt' zeigt Zahlungen zur selben Bestellung im selben Monat.",
        "Wenn kein Hinweis steht, ist aus Sicht dieses Pakets nichts offen.",
      ],
      highlightLabel: "Angekommen",
      highlightValue: String(report.wareneingaenge?.length || 0),
    };
  }
  if (config.key === "inventory") {
    return {
      lines: [
        "Der Warenbestand gilt immer zum Monatsende.",
        "Der Bestandswert ergibt sich aus Bestand mal Einstandspreis.",
        "Es werden nur Hinweise gezeigt, die fuer die Buchhaltung relevant sein koennen.",
      ],
      highlightLabel: "Bestandswert",
      highlightValue: `${formatAccountantDisplayValue("currency", report.inventory?.totalValueEur ?? report.inventory?.inventoryValueEur, { emptyValue: "-" })} EUR`,
    };
  }
  return {
    lines: [
      "Hier stehen nur Punkte, bei denen noch eine kurze Pruefung sinnvoll ist.",
      "Wenn kein Hinweis vorhanden ist, ist das Paket an dieser Stelle vollstaendig.",
    ],
    highlightLabel: "Offene Punkte",
    highlightValue: String(report.pruefhinweise?.length || 0),
  };
}

function drawSectionGuide(page, report, config, yCursor, pageMetrics) {
  const guide = buildSectionGuide(config, report);
  const lines = Array.isArray(guide?.lines) ? guide.lines : [];
  const wrapped = lines.flatMap((lineText) => wrapText(lineText, pageMetrics.width - (pageMetrics.marginX * 2) - 190, 9, 2));
  const lineHeight = 12;
  const boxHeight = Math.max(76, 26 + (wrapped.length * lineHeight));
  const boxY = Math.max(44, Math.min(132, yCursor - boxHeight - 18));
  if (boxY < 44) return;

  const boxWidth = pageMetrics.width - (pageMetrics.marginX * 2);
  const statWidth = 150;
  const statX = pageMetrics.marginX + boxWidth - statWidth - 14;
  page.push(rect(pageMetrics.marginX, boxY, boxWidth, boxHeight, COLORS.accentSoft, COLORS.line, 0.8));
  page.push(rect(pageMetrics.marginX, boxY, 6, boxHeight, COLORS.accent));
  page.push(rect(statX, boxY + 12, statWidth, boxHeight - 24, COLORS.white, COLORS.line, 0.8));
  page.push(text(pageMetrics.marginX + 18, boxY + boxHeight - 18, "Kurz erklaert", { font: "bold", size: 10, color: COLORS.ink }));
  wrapped.forEach((lineText, index) => {
    page.push(text(pageMetrics.marginX + 18, boxY + boxHeight - 34 - (index * lineHeight), lineText, { size: 9, color: COLORS.ink }));
  });
  page.push(text(statX + 12, boxY + boxHeight - 26, guide.highlightLabel || "", { size: 8.5, color: COLORS.muted }));
  page.push(text(statX + 12, boxY + boxHeight - 50, guide.highlightValue || "-", { font: "bold", size: 16, color: COLORS.ink }));
}

function drawSectionCards(page, cards, pageMetrics) {
  const cardGap = 10;
  const cardWidth = Math.floor((pageMetrics.width - (pageMetrics.marginX * 2) - (cardGap * 2)) / 3);
  const topY = pageMetrics.height - 120;
  cards.forEach((card, index) => {
    const x = pageMetrics.marginX + (index * (cardWidth + cardGap));
    const y = topY - 48;
    page.push(rect(x, y, cardWidth, 48, COLORS.white, [206, 216, 226], 0.8));
    wrapText(card.label, cardWidth - 20, 8, 2).forEach((lineText, lineIndex) => {
      page.push(text(x + 10, y + 32 - (lineIndex * 9), lineText, { size: 8, color: COLORS.muted }));
    });
    page.push(text(x + 10, y + 12, card.value, { font: "bold", size: 11, color: COLORS.ink }));
  });
}

function drawSectionAtmosphere(page, config, yCursor, pageMetrics) {
  const panelTop = Math.min(286, yCursor - 16);
  const panelY = 54;
  const panelHeight = panelTop - panelY;
  if (panelHeight < 120) return;

  const label = config.key === "payments"
    ? "Zahlungen"
    : config.key === "arrivals"
      ? "Wareneingang"
      : config.key === "inventory"
        ? "Bestand"
        : "Pruefen";
  const number = config.key === "payments"
    ? "01"
    : config.key === "arrivals"
      ? "02"
      : config.key === "inventory"
        ? "03"
        : "04";

  page.push(rect(pageMetrics.marginX, panelY, pageMetrics.width - (pageMetrics.marginX * 2), panelHeight, COLORS.panel));
  page.push(line(pageMetrics.marginX, panelTop, pageMetrics.width - pageMetrics.marginX, panelTop, COLORS.line, 0.8));
  page.push(text(pageMetrics.width - pageMetrics.marginX - 82, panelY + panelHeight - 40, number, { font: "bold", size: 34, color: [215, 223, 231] }));
  page.push(text(pageMetrics.width - pageMetrics.marginX - 182, panelY + 34, label, { font: "bold", size: 18, color: [208, 217, 226] }));
}

function drawTablePage(page, report, config, rows, pageIndex, pageCount, pageMetrics) {
  const title = pageIndex === 0 ? config.title : `${config.title} (Fortsetzung ${pageIndex + 1}/${pageCount})`;
  const subtitle = typeof config.subtitle === "function" ? config.subtitle(report) : String(config.subtitle || "");
  const helperText = config.key === "payments"
    ? "Hier sehen Sie Datum, Lieferant, Buchung, Betrag und den Stand der Bestellung."
    : config.key === "arrivals"
      ? "Hier sehen Sie nur Ware, die im Monat wirklich angekommen ist."
      : config.key === "inventory"
        ? "Hier sehen Sie Bestand, Einstandspreis und Bestandswert je Artikel."
        : "Hier sehen Sie Punkte, die bitte geprueft werden sollten.";
  const sectionCards = buildSectionCards(report);

  page.push(rect(0, pageMetrics.height - 112, pageMetrics.width, 112, COLORS.brand));
  page.push(rect(0, pageMetrics.height - 120, pageMetrics.width, 8, COLORS.accent));
  page.push(text(pageMetrics.marginX, pageMetrics.height - 54, title, { font: "bold", size: 18, color: COLORS.white }));
  page.push(text(pageMetrics.marginX, pageMetrics.height - 78, subtitle, { size: 10, color: [223, 230, 236] }));
  page.push(text(pageMetrics.marginX, pageMetrics.height - 94, helperText, { size: 9, color: [223, 230, 236] }));
  const detailLabel = "Details in Excel-Datei";
  const detailLabelWidth = detailLabel.length * 4.8;
  page.push(text(pageMetrics.width - pageMetrics.marginX - detailLabelWidth, pageMetrics.height - 54, detailLabel, { size: 9, color: [223, 230, 236] }));
  drawSectionCards(page, sectionCards[config.key] || sectionCards.quality, pageMetrics);

  const tableX = pageMetrics.marginX;
  const tableTop = pageMetrics.height - 186;
  const headerHeight = 24;
  const tableWidth = config.columns.reduce((sum, column) => sum + column.width, 0);

  page.push(rect(tableX, tableTop - headerHeight, tableWidth, headerHeight, COLORS.brandSoft, COLORS.line, 0.8));
  let currentX = tableX;
  config.columns.forEach((column) => {
    page.push(text(currentX + 6, tableTop - 16, column.label, { font: "bold", size: 8.5, color: COLORS.ink }));
    if (currentX > tableX) {
      page.push(line(currentX, tableTop - headerHeight, currentX, tableTop, COLORS.line, 0.5));
    }
    currentX += column.width;
  });

  let yCursor = tableTop - headerHeight;
  rows.forEach((row, rowIndex) => {
    const cellLines = config.columns.map((column) => wrapText(
      formatTableValue(config, column, row),
      column.width - 10,
      9,
      column.maxLines || 3,
    ));
    const rowHeight = Math.max(22, ...cellLines.map((lines) => 10 + (lines.length * 11)));
    const fill = resolvePdfRowFill(config, row, rowIndex);
    page.push(rect(tableX, yCursor - rowHeight, tableWidth, rowHeight, fill, COLORS.line, 0.5));

    let cellX = tableX;
    config.columns.forEach((column, columnIndex) => {
      if (cellX > tableX) {
        page.push(line(cellX, yCursor - rowHeight, cellX, yCursor, COLORS.line, 0.35));
      }
      const lines = cellLines[columnIndex];
      lines.forEach((lineText, lineIndex) => {
        const isRight = column.align === "right";
        const lineWidth = lineText.length * 4.3;
        const textX = isRight
          ? Math.max(cellX + 6, cellX + column.width - 8 - lineWidth)
          : cellX + 6;
        page.push(text(textX, yCursor - 14 - (lineIndex * 11), lineText, { size: 9, color: COLORS.ink }));
      });
      cellX += column.width;
    });

    yCursor -= rowHeight;
  });

  if (!rows.length) {
    page.push(rect(tableX, yCursor - 28, tableWidth, 28, COLORS.white, COLORS.line, 0.5));
    page.push(text(tableX + 8, yCursor - 18, "Keine Daten im gewaehlten Monat.", { size: 9, color: COLORS.muted }));
    yCursor -= 28;
  }

  drawSectionAtmosphere(page, config, yCursor, pageMetrics);
  drawSectionGuide(page, report, config, yCursor, pageMetrics);
}

function appendFooter(page, report, pageNumber, pageCount, pageMetrics) {
  page.push(line(pageMetrics.marginX, 28, pageMetrics.width - pageMetrics.marginX, 28, COLORS.line, 0.8));
  page.push(text(pageMetrics.marginX, 14, `Buchhaltung ${report.request?.month || ""}`, { size: 9, color: COLORS.muted }));
  page.push(text(pageMetrics.width - pageMetrics.marginX - 86, 14, `Seite ${pageNumber} von ${pageCount}`, { size: 9, color: COLORS.muted }));
}

function buildPages(report) {
  const pages = [{ commands: [], layout: "portrait" }];
  drawCoverPage(pages[0].commands, report, getPageMetrics("portrait"));

  PDF_TABLES.forEach((config) => {
    const rowsSource = config.rows(report);
    const rows = typeof config.rowSort === "function" ? config.rowSort(rowsSource) : rowsSource;
    const pageChunks = chunkRows(rows, config.pageCapacity?.first || 16, config.pageCapacity?.next || 20);
    pageChunks.forEach((chunk, index) => {
      const pageSpec = { commands: [], layout: config.pageLayout || "portrait" };
      pages.push(pageSpec);
      drawTablePage(pageSpec.commands, report, config, chunk, index, pageChunks.length, getPageMetrics(pageSpec.layout));
    });
  });

  if (Array.isArray(report?.pruefhinweise) && report.pruefhinweise.length) {
    const qualityConfig = {
      title: "Pruefhinweise",
      subtitle: (data) => `${data.pruefhinweise.length} offene Hinweise`,
      columns: [
        { key: "bereich", label: "Bereich", width: 84, cellType: "text", maxLines: 2 },
        { key: "bezug", label: "Bezug", width: 92, cellType: "text", maxLines: 2 },
        { key: "hinweis", label: "Hinweis", width: 236, cellType: "text", maxLines: 3 },
        { key: "relevanzFuerBuchhaltung", label: "Relevanz", width: 103, cellType: "text", maxLines: 2 },
      ],
    };
    const chunks = chunkRows(report.pruefhinweise, 14, 18);
    chunks.forEach((chunk, index) => {
      const pageSpec = { commands: [], layout: "portrait" };
      pages.push(pageSpec);
      drawTablePage(pageSpec.commands, report, qualityConfig, chunk, index, chunks.length, getPageMetrics("portrait"));
    });
  }

  const totalPages = pages.length;
  return pages.map((pageSpec, index) => {
    appendFooter(pageSpec.commands, report, index + 1, totalPages, getPageMetrics(pageSpec.layout));
    return {
      commands: pageSpec.commands,
      layout: pageSpec.layout,
      pageNumber: index + 1,
    };
  });
}

function buildPdfBytes(report) {
  const pageSpecs = buildPages(report);
  const objects = [];

  function addObject(content) {
    objects.push(content);
    return objects.length;
  }

  const pagesId = addObject("<< /Type /Pages /Kids [] /Count 0 >>");
  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const regularFontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const boldFontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const pageIds = [];

  pageSpecs.forEach((pageSpec) => {
    const stream = pageSpec.commands.join("\n");
    const contentId = addObject(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageMetrics = getPageMetrics(pageSpec.layout);
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageMetrics.width} ${pageMetrics.height}] /Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  });

  const kids = pageIds.map((id) => `${id} 0 R`).join(" ");
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids}] /Count ${pageIds.length} >>`;

  let offset = 0;
  const parts = [];
  const objectOffsets = [0];

  function push(value) {
    parts.push(value);
    offset += value.length;
  }

  push("%PDF-1.4\n");
  objects.forEach((content, index) => {
    const objectId = index + 1;
    objectOffsets[objectId] = offset;
    push(`${objectId} 0 obj\n${content}\nendobj\n`);
  });

  const xrefOffset = offset;
  push(`xref\n0 ${objects.length + 1}\n`);
  push("0000000000 65535 f \n");
  for (let objectId = 1; objectId <= objects.length; objectId += 1) {
    push(`${String(objectOffsets[objectId]).padStart(10, "0")} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return new TextEncoder().encode(parts.join(""));
}

export function buildAccountantPdfBlob(report) {
  const bytes = buildPdfBytes(report);
  return new Blob([bytes], { type: "application/pdf" });
}
