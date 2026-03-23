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

function wrapLine(line, maxLength = 110) {
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
    if (word.length > maxLength) {
      let offset = 0;
      while (offset < word.length) {
        lines.push(word.slice(offset, offset + maxLength));
        offset += maxLength;
      }
      current = "";
      return;
    }
    current = word;
  });
  if (current) lines.push(current);
  return lines;
}

function buildReportLines(report) {
  const overview = report?.uebersicht || {};
  const quality = Array.isArray(report?.pruefhinweise) ? report.pruefhinweise : (Array.isArray(report?.quality) ? report.quality : []);
  const overviewRows = buildAccountantOverviewRows(report);

  const lines = [
    `Monatsuebersicht Buchhaltung ${report?.request?.month || ""}`,
    "",
    `Verbindliche Datei: ${overview.verbindlicheDatei || "-"}`,
    "",
    "Umfang im Monat",
    ...overviewRows.map((row) => {
      const formatted = formatAccountantDisplayValue(row.cellType, row.value, { emptyValue: "n/a" });
      const suffix = row.cellType === "currency" && formatted !== "n/a" ? " EUR" : "";
      return `- ${row.label}: ${formatted}${suffix}`;
    }),
    "",
    "Bewertungsgrundlage",
    overview.bewertungsgrundlageText || "",
    "",
    "Vollstaendigkeit innerhalb der Plattform",
    overview.vollstaendigkeitInnerhalbPlattformText || "",
    "",
    "Manuell ausserhalb der Plattform beizulegen",
  ];

  (overview.manuellAusserhalbPlattformBeizulegen || []).forEach((entry) => {
    lines.push(`- ${entry}`);
  });

  if (quality.length) {
    lines.push("");
    lines.push("Offene Pruefpunkte");
    quality.slice(0, 8).forEach((issue) => {
      lines.push(`- ${issue.bereich || "Allgemein"} | ${issue.bezug || "-"} | ${issue.hinweis || issue.message || ""}`);
    });
    if (quality.length > 8) {
      lines.push(`- ... ${quality.length - 8} weitere Hinweise in der Arbeitsdatei`);
    }
  }

  return lines.flatMap((line) => wrapLine(line, 110));
}

function buildPdfBytes(lines) {
  const pageWidth = 595;
  const pageHeight = 842;
  const top = 800;
  const bottom = 50;
  const lineHeight = 14;
  const maxLinesPerPage = Math.floor((top - bottom) / lineHeight);
  const pages = [];
  for (let index = 0; index < lines.length; index += maxLinesPerPage) {
    pages.push(lines.slice(index, index + maxLinesPerPage));
  }
  if (!pages.length) pages.push([""]);

  const objects = [];

  function addObject(content) {
    objects.push(content);
    return objects.length;
  }

  const pagesId = addObject("<< /Type /Pages /Kids [] /Count 0 >>");
  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  const pageIds = [];

  pages.forEach((pageLines) => {
    const textCommands = ["BT", "/F1 11 Tf", `1 0 0 1 40 ${top} Tm`];
    pageLines.forEach((line, idx) => {
      if (idx > 0) textCommands.push(`0 -${lineHeight} Td`);
      textCommands.push(`(${escapePdfText(line)}) Tj`);
    });
    textCommands.push("ET");
    const stream = textCommands.join("\n");
    const streamObject = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    const contentId = addObject(streamObject);
    const pageObject = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
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
  const lines = buildReportLines(report);
  const bytes = buildPdfBytes(lines);
  return new Blob([bytes], { type: "application/pdf" });
}
