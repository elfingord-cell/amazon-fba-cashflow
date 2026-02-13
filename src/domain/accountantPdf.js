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
  const month = report?.request?.month || "";
  const inventory = report?.inventory || {};
  const deposits = Array.isArray(report?.deposits) ? report.deposits : [];
  const arrivals = Array.isArray(report?.arrivals) ? report.arrivals : [];
  const quality = Array.isArray(report?.quality) ? report.quality : [];
  const lines = [
    `Buchhaltungsbericht ${month}`,
    "",
    "Warenbestand",
    `- Snapshot As Of: ${inventory.snapshotAsOf || "n/a"}`,
    `- Warenwert EUR: ${Number.isFinite(Number(inventory.totalValueEur)) ? Number(inventory.totalValueEur).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "n/a"}`,
    `- Amazon Units: ${Number(inventory.totalAmazonUnits || 0).toLocaleString("de-DE")}`,
    `- 3PL Units: ${Number(inventory.total3plUnits || 0).toLocaleString("de-DE")}`,
    `- In Transit Units: ${Number(inventory.totalInTransitUnits || 0).toLocaleString("de-DE")}`,
    "",
    "Anzahlungen (PO)",
    `- Anzahl Zeilen im Monat: ${deposits.length}`,
  ];

  const paidSum = deposits.reduce((sum, row) => sum + (Number(row.actualEur) || 0), 0);
  lines.push(`- Summe Ist EUR: ${paidSum.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  lines.push("-");
  deposits.slice(0, 12).forEach((row) => {
    lines.push(`  ${row.poNumber || "PO"} | ${row.supplier || "-"} | paid ${row.paidDate || "n/a"} | EUR ${Number(row.actualEur || row.plannedEur || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  });
  if (deposits.length > 12) {
    lines.push(`  ... ${deposits.length - 12} weitere Zeilen in XLSX/CSV`);
  }

  lines.push("");
  lines.push("Wareneingang (PO)");
  lines.push(`- Anzahl Zeilen im Monat: ${arrivals.length}`);
  const unitsTotal = arrivals.reduce((sum, row) => sum + (Number(row.units) || 0), 0);
  lines.push(`- Summe Units: ${unitsTotal.toLocaleString("de-DE")}`);
  lines.push("-");
  arrivals.slice(0, 12).forEach((row) => {
    lines.push(`  ${row.poNumber || "PO"} | ${row.supplier || "-"} | arrival ${row.arrivalDate || "n/a"} | units ${Number(row.units || 0).toLocaleString("de-DE")}`);
  });
  if (arrivals.length > 12) {
    lines.push(`  ... ${arrivals.length - 12} weitere Zeilen in XLSX/CSV`);
  }

  lines.push("");
  lines.push("Datenqualitaet");
  lines.push(`- Hinweise gesamt: ${quality.length}`);
  quality.slice(0, 20).forEach((issue) => {
    lines.push(`  [${issue.severity || "info"}] ${issue.code || "ISSUE"}: ${issue.message || ""}`);
  });
  if (quality.length > 20) {
    lines.push(`  ... ${quality.length - 20} weitere Hinweise`);
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
