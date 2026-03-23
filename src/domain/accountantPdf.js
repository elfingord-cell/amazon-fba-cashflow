import {
  buildAccountantOverviewRows,
  formatAccountantDisplayValue,
} from "./accountantPresentation.js";

function escapePdfText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapLine(line, maxLength = 96) {
  const text = String(line || "").trim();
  if (!text) return [""];
  if (text.length <= maxLength) return [text];
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxLength) {
      current = next;
      return;
    }
    if (current) lines.push(current);
    current = word;
  });

  if (current) lines.push(current);
  return lines;
}

function buildReportBlocks(report) {
  const overview = report?.uebersicht || {};
  const quality = Array.isArray(report?.pruefhinweise) ? report.pruefhinweise : (Array.isArray(report?.quality) ? report.quality : []);
  const overviewRows = buildAccountantOverviewRows(report);

  const blocks = [
    { text: `Buchhalterpaket ${report?.request?.month || ""}`, font: "bold", size: 16, after: 4, maxLength: 70 },
    { text: "Deckblatt und Schnellcheck. Die XLSX ist die verbindliche Arbeitsdatei; diese PDF fasst den Monatsstatus kurz zusammen.", size: 10, after: 12, maxLength: 92 },
    { text: "Verbindliche Datei", font: "bold", size: 11, after: 4, maxLength: 80 },
    { text: overview.verbindlicheDatei || "-", size: 11, after: 12, maxLength: 90 },
    { text: "Monatsstatus", font: "bold", size: 11, after: 4, maxLength: 80 },
  ];

  overviewRows.forEach((row) => {
    const formatted = formatAccountantDisplayValue(row.cellType, row.value, { emptyValue: "n/a" });
    const suffix = row.cellType === "currency" && formatted !== "n/a" ? " EUR" : "";
    blocks.push({
      text: `- ${row.label}: ${formatted}${suffix}`,
      size: 10,
      after: 2,
      maxLength: 96,
    });
  });

  blocks.push(
    { text: "", size: 10, after: 6, maxLength: 96 },
    { text: "Bewertungsgrundlage", font: "bold", size: 11, after: 4, maxLength: 80 },
    { text: overview.bewertungsgrundlageText || "-", size: 10, after: 10, maxLength: 96 },
    { text: "Vollstaendigkeit innerhalb der Plattform", font: "bold", size: 11, after: 4, maxLength: 80 },
    { text: overview.vollstaendigkeitInnerhalbPlattformText || "-", size: 10, after: 10, maxLength: 96 },
  );

  if (quality.length) {
    blocks.push({ text: "Offene Pruefpunkte", font: "bold", size: 11, after: 4, maxLength: 80 });
    quality.slice(0, 6).forEach((issue) => {
      blocks.push({
        text: `- ${issue.bereich || "Allgemein"} | ${issue.bezug || "-"} | ${issue.hinweis || issue.message || ""}`,
        size: 10,
        after: 2,
        maxLength: 96,
      });
    });
    if (quality.length > 6) {
      blocks.push({
        text: `- ... ${quality.length - 6} weitere Hinweise in der Arbeitsdatei`,
        size: 10,
        after: 2,
        maxLength: 96,
      });
    }
  }

  return blocks;
}

function expandBlocks(blocks) {
  const items = [];

  blocks.forEach((block) => {
    const lines = wrapLine(block.text, block.maxLength || 96);
    lines.forEach((line) => {
      items.push({
        text: line,
        font: block.font === "bold" ? "bold" : "regular",
        size: Number(block.size || 10),
      });
    });
    items.push({ spacer: Number(block.after || 0) });
  });

  return items;
}

function buildPdfBytes(items) {
  const pageWidth = 595;
  const pageHeight = 842;
  const top = 800;
  const bottom = 50;

  const pages = [];
  let currentPage = [];
  let y = top;

  const startNewPage = () => {
    currentPage = [];
    pages.push(currentPage);
    y = top;
  };

  startNewPage();

  items.forEach((item) => {
    if (item.spacer) {
      y -= item.spacer;
      if (y < bottom) startNewPage();
      return;
    }

    const lineHeight = item.size + 4;
    if (y - lineHeight < bottom) startNewPage();
    currentPage.push({ ...item, y });
    y -= lineHeight;
  });

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

  pages.forEach((pageItems) => {
    const textCommands = [];
    pageItems.forEach((item) => {
      textCommands.push("BT");
      textCommands.push(`/${item.font === "bold" ? "F2" : "F1"} ${item.size} Tf`);
      textCommands.push(`1 0 0 1 40 ${item.y} Tm`);
      textCommands.push(`(${escapePdfText(item.text)}) Tj`);
      textCommands.push("ET");
    });
    const stream = textCommands.join("\n");
    const streamObject = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    const contentId = addObject(streamObject);
    const pageObject = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    const pageId = addObject(pageObject);
    pageIds.push(pageId);
  });

  const kids = pageIds.map((id) => `${id} 0 R`).join(" ");
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids}] /Count ${pageIds.length} >>`;

  let offset = 0;
  const parts = [];
  const objectOffsets = [0];
  const pushString = (value) => {
    parts.push(value);
    offset += value.length;
  };

  pushString("%PDF-1.4\n");

  objects.forEach((content, index) => {
    const objectId = index + 1;
    objectOffsets[objectId] = offset;
    pushString(`${objectId} 0 obj\n${content}\nendobj\n`);
  });

  const xrefOffset = offset;
  pushString(`xref\n0 ${objects.length + 1}\n`);
  pushString("0000000000 65535 f \n");
  for (let objectId = 1; objectId <= objects.length; objectId += 1) {
    pushString(`${String(objectOffsets[objectId]).padStart(10, "0")} 00000 n \n`);
  }
  pushString(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return new TextEncoder().encode(parts.join(""));
}

export function buildAccountantPdfBlob(report) {
  const blocks = buildReportBlocks(report);
  const bytes = buildPdfBytes(expandBlocks(blocks));
  return new Blob([bytes], { type: "application/pdf" });
}
