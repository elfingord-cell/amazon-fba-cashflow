import {
  buildAccountantOverviewRows,
  formatAccountantDisplayValue,
  ACCOUNTANT_CELL_TYPES,
  ACCOUNTANT_SHEET_SCHEMAS,
  resolveAccountantStatusTone,
} from "./accountantPresentation.js";

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtCell(cellType, value) {
  return esc(formatAccountantDisplayValue(cellType, value, { emptyValue: "-" }));
}

function fmtCurrency(value) {
  const formatted = formatAccountantDisplayValue("currency", value, { emptyValue: "-" });
  return formatted === "-" ? "-" : `${esc(formatted)} EUR`;
}

function fmtDate(value) {
  return fmtCell("date", value);
}

const CSS = `
  :root {
    --ink: #1c252e;
    --muted: #606c7c;
    --line: #d4dae0;
    --panel: #f5f7f9;
    --panel-alt: #fafbfc;
    --brand: #1f3d5a;
    --brand-soft: #e7eef4;
    --accent: #bf8c47;
    --accent-soft: #f7f0e5;
    --gold-soft: #f7f2e5;
    --warn-soft: #fde6e7;
    --white: #ffffff;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 11px;
    color: var(--ink);
    background: var(--white);
    line-height: 1.4;
  }
  .page { max-width: 900px; margin: 0 auto; padding: 32px 40px; }
  .page-break { page-break-before: always; }

  /* Cover */
  .cover-header {
    background: var(--brand);
    color: white;
    padding: 28px 32px 20px;
    border-radius: 0;
  }
  .cover-header h1 { font-size: 28px; font-weight: 700; margin-bottom: 4px; }
  .cover-header .sub { font-size: 12px; color: #dfe6ec; }
  .cover-accent {
    height: 6px;
    background: var(--accent);
  }
  .cover-file-hint {
    background: var(--accent-soft);
    padding: 14px 20px;
    margin-bottom: 24px;
  }
  .cover-file-hint .label { font-weight: 700; font-size: 11px; color: var(--ink); }
  .cover-file-hint .file { font-weight: 700; font-size: 13px; color: var(--ink); margin-top: 4px; }
  .cover-file-hint .note { font-size: 10px; color: var(--muted); margin-top: 2px; }

  /* Cards grid */
  .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px; }
  .card {
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 12px 16px;
    background: var(--panel);
  }
  .card:nth-child(even) { background: var(--panel-alt); }
  .card .card-label { font-size: 9px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.3px; }
  .card .card-value { font-size: 16px; font-weight: 700; margin-top: 4px; }

  /* Info boxes */
  .info-box {
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 16px 20px;
    margin-bottom: 16px;
  }
  .info-box.brand { background: var(--brand-soft); }
  .info-box.panel { background: var(--panel); }
  .info-box h3 { font-size: 12px; font-weight: 700; margin-bottom: 8px; }
  .info-box p, .info-box li { font-size: 10px; line-height: 1.5; }
  .info-box ol { padding-left: 16px; }

  /* Section header */
  .section-header {
    background: var(--brand);
    color: white;
    padding: 18px 24px 14px;
    margin-bottom: 0;
  }
  .section-header h2 { font-size: 20px; font-weight: 700; }
  .section-header .sub { font-size: 11px; color: #dfe6ec; margin-top: 2px; }
  .section-header .detail { font-size: 10px; color: #bcc8d4; margin-top: 4px; }
  .section-accent { height: 4px; background: var(--accent); margin-bottom: 16px; }

  /* Section summary cards */
  .section-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px; }
  .section-card {
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 10px 14px;
    background: var(--panel);
  }
  .section-card .sc-label { font-size: 9px; color: var(--muted); }
  .section-card .sc-value { font-size: 16px; font-weight: 700; margin-top: 2px; }

  /* Tables */
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 8px;
    font-size: 10px;
  }
  th {
    background: var(--brand-soft);
    font-weight: 700;
    font-size: 9px;
    text-align: left;
    padding: 8px 8px;
    border: 1px solid var(--line);
    white-space: nowrap;
  }
  td {
    padding: 6px 8px;
    border: 1px solid var(--line);
    vertical-align: top;
  }
  tr:nth-child(even) td { background: var(--panel-alt); }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.date { white-space: nowrap; }
  td.planned { background: #fff4d6 !important; }
  td.warning { background: #fde6e7 !important; }

  /* Explanation box */
  .explain {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 16px;
    margin-top: 16px;
    margin-bottom: 32px;
  }
  .explain .explain-text {
    background: var(--brand-soft);
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 12px 16px;
  }
  .explain .explain-text h4 { font-size: 11px; font-weight: 700; margin-bottom: 6px; }
  .explain .explain-text p { font-size: 10px; color: var(--ink); line-height: 1.5; }
  .explain .explain-badge {
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 10px 16px;
    background: var(--accent-soft);
    text-align: center;
    min-width: 120px;
  }
  .explain .explain-badge .badge-label { font-size: 9px; color: var(--muted); }
  .explain .explain-badge .badge-value { font-size: 16px; font-weight: 700; margin-top: 2px; }

  /* Section number watermark */
  .section-number {
    text-align: right;
    font-size: 72px;
    font-weight: 700;
    color: var(--accent);
    opacity: 0.25;
    margin-top: 16px;
  }
  .section-label {
    text-align: right;
    font-size: 16px;
    font-weight: 600;
    color: var(--accent);
    opacity: 0.4;
    margin-top: -8px;
    margin-bottom: 32px;
  }

  /* Quality section */
  .quality-table td.warning { background: #fde6e7 !important; }

  /* Footer */
  .footer {
    text-align: center;
    font-size: 9px;
    color: var(--muted);
    border-top: 1px solid var(--line);
    padding-top: 10px;
    margin-top: 24px;
  }

  @media print {
    body { font-size: 10px; }
    .page { padding: 20px; max-width: none; }
    .page-break { page-break-before: always; }
  }
`;

function renderCoverPage(report) {
  const cards = buildAccountantOverviewRows(report).map((row) => {
    const formatted = formatAccountantDisplayValue(row.cellType, row.value, { emptyValue: "n/a" });
    const display = row.cellType === "currency" && formatted !== "n/a" ? `${formatted} EUR` : formatted;
    return `<div class="card"><div class="card-label">${esc(row.label)}</div><div class="card-value">${esc(display)}</div></div>`;
  }).join("\n");

  const fileName = report.uebersicht?.verbindlicheDatei || "-";

  return `
    <div class="cover-header">
      <h1>Buchhaltung ${esc(report.request?.month || "")}</h1>
      <div class="sub">Klarer Ueberblick fuer den Monatsabschluss</div>
    </div>
    <div class="cover-accent"></div>
    <div class="cover-file-hint">
      <div class="label">Bitte diese Excel-Datei fuer die Details verwenden</div>
      <div class="file">${esc(fileName)}</div>
      <div class="note">Diese HTML-Datei ist die Uebersicht. Fuer die Arbeit nutzen Sie die Excel-Datei.</div>
    </div>
    <div class="cards">${cards}</div>
    <div class="info-box brand">
      <h3>So nutzen Sie dieses Paket</h3>
      <ol>
        <li>Seite 1 zeigt den Monat auf einen Blick.</li>
        <li>Arbeiten Sie fuer Details in der Datei ${esc(fileName)}.</li>
        <li>'Zahlungen an Lieferanten' zeigt alle im Monat bezahlten Vorgaenge.</li>
        <li>'Ware im Monat angekommen' zeigt nur Ware, die im Monat wirklich angekommen ist.</li>
        <li>'Warenbestand zum Monatsende' zeigt Bestand und Wert zum Stichtag.</li>
        <li>'Ankunft' auf der Zahlungsseite meint die geplante Ankunft der Ware.</li>
        <li>Gelb bedeutet: geplant oder noch offen. Rot bedeutet: bitte kurz pruefen.</li>
      </ol>
    </div>
    <div class="info-box panel">
      <h3>Was diese Zahlen bedeuten</h3>
      <p>Zahlungen: EUR zeigt den tatsaechlich bezahlten Betrag im Monat.</p>
      <p>Wareneingang: EUR zeigt den Warenwert der angekommenen Ware.</p>
      <p>Warenbestand: Wert ergibt sich aus Bestand mal Einstandspreis.</p>
      <p style="margin-top:8px;color:var(--muted);font-size:9px">Diese Datei zeigt die Monatsuebersicht aus der Plattform. Fuer Details nutzen Sie die Excel-Datei.</p>
    </div>`;
}

function renderSectionHeader(title, subtitle, detail) {
  return `
    <div class="section-header">
      <h2>${esc(title)}</h2>
      ${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ""}
      ${detail ? `<div class="detail">${esc(detail)}</div>` : ""}
    </div>
    <div class="section-accent"></div>`;
}

function renderSectionCards(cards) {
  return `<div class="section-cards">${cards.map((c) =>
    `<div class="section-card"><div class="sc-label">${esc(c.label)}</div><div class="sc-value">${esc(c.value)}</div></div>`
  ).join("")}</div>`;
}

function renderPaymentsSection(report) {
  const rows = report.zahlungenLieferanten || [];
  const hinweisCount = rows.filter((r) => String(r?.hinweis || "").trim()).length;

  const header = renderSectionHeader(
    "Zahlungen an Lieferanten",
    `${rows.length} im Monat bezahlte Vorgaenge`,
    "Hier sehen Sie Datum, Lieferant, Buchung, Betrag und den Stand der Bestellung.",
  );
  const cards = renderSectionCards([
    { label: "Zahlungen", value: String(rows.length) },
    { label: "Summe", value: fmtCurrency(report.uebersicht?.summeZahlungenIstEur) },
    { label: "Offene Hinweise", value: String(hinweisCount) },
  ]);

  const tableRows = rows.map((row) => {
    const tone = resolveAccountantStatusTone("payments", "statusZurBestellung", row);
    const standClass = tone === "warning" ? " class=\"planned\"" : tone === "danger" ? " class=\"warning\"" : "";
    return `<tr>
      <td class="date">${fmtDate(row.zahlungsdatum)}</td>
      <td>${esc(row.lieferant)}</td>
      <td>${esc(row.bestellnummerIntern)}</td>
      <td>${esc(row.fachlicheBehandlung)}</td>
      <td class="num">${fmtCell("currency", row.betragIstEur)}</td>
      <td class="date">${fmtDate(row.geplanteAnkunft)}</td>
      <td${standClass}>${esc(row.statusZurBestellung)}</td>
    </tr>`;
  }).join("\n");

  return `
    ${header}${cards}
    <table>
      <thead><tr>
        <th>Datum</th><th>Lieferant</th><th>Bestellnr.</th><th>Bitte buchen als</th>
        <th style="text-align:right">Betrag EUR</th><th>Ankunft</th><th>Stand</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    <div class="explain">
      <div class="explain-text">
        <h4>Kurz erklaert</h4>
        <p>Hier sehen Sie nur Zahlungen mit Zahlungsdatum im ausgewaehlten Monat.</p>
        <p>'Bitte buchen als' ist eine kurze Einordnung fuer die Buchhaltung.</p>
        <p>'Ankunft' meint die geplante Ankunft der Ware, nicht den echten Wareneingang.</p>
      </div>
      <div class="explain-badge">
        <div class="badge-label">Offene Hinweise</div>
        <div class="badge-value">${hinweisCount}</div>
      </div>
    </div>
    <div class="section-number">01</div>
    <div class="section-label">Zahlungen</div>`;
}

function renderArrivalsSection(report) {
  const rows = report.wareneingaenge || [];
  const totalImMonat = rows.reduce((sum, r) => sum + (Number(r?.davonImMonatBezahltEur) || 0), 0);

  const header = renderSectionHeader(
    "Ware im Monat angekommen",
    `${rows.length} bestaetigte Wareneingaenge im Monat`,
    "Hier sehen Sie nur Ware, die im Monat wirklich angekommen ist.",
  );
  const cards = renderSectionCards([
    { label: "Angekommen", value: String(rows.length) },
    { label: "Wert", value: fmtCurrency(report.uebersicht?.summeBestaetigteWareneingaengeEur) },
    { label: "Im Monat bezahlt", value: fmtCurrency(totalImMonat) },
  ]);

  const tableRows = rows.map((row) => `<tr>
    <td class="date">${fmtDate(row.wareneingangLautSystem)}</td>
    <td>${esc(row.lieferant)}</td>
    <td>${esc(row.bestellnummerIntern)}</td>
    <td class="num">${fmtCell("currency", row.warenwertEur)}</td>
    <td class="num">${fmtCell("currency", row.davonImMonatBezahltEur)}</td>
    <td class="num">${fmtCell("currency", row.anzahlungBetragEur)}</td>
    <td class="date">${fmtDate(row.anzahlungDatum)}</td>
    <td class="num">${fmtCell("currency", row.restzahlungBetragEur)}</td>
    <td class="date">${fmtDate(row.restzahlungDatum)}</td>
    <td>${esc(row.hinweis || "Kein offener Hinweis")}</td>
  </tr>`).join("\n");

  return `
    ${header}${cards}
    <table>
      <thead><tr>
        <th>Datum</th><th>Lieferant</th><th>Bestellnr.</th>
        <th style="text-align:right">Wert EUR</th>
        <th style="text-align:right">Zur Bestellung bezahlt</th>
        <th style="text-align:right">Anzahlung EUR</th><th>Anzahlung Datum</th>
        <th style="text-align:right">Restzahlung EUR</th><th>Restzahlung Datum</th>
        <th>Hinweis</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    <div class="explain">
      <div class="explain-text">
        <h4>Kurz erklaert</h4>
        <p>Hier steht nur Ware, die im Monat wirklich angekommen ist.</p>
        <p>'Zur Bestellung bezahlt' zeigt Zahlungen zur selben Bestellung im selben Monat.</p>
        <p>'Anzahlung' und 'Restzahlung' zeigen Datum und Betrag der jeweiligen Lieferantenzahlung.</p>
        <p>Wenn kein Hinweis steht, ist aus Sicht dieses Pakets nichts offen.</p>
      </div>
      <div class="explain-badge">
        <div class="badge-label">Angekommen</div>
        <div class="badge-value">${rows.length}</div>
      </div>
    </div>
    <div class="section-number">02</div>
    <div class="section-label">Wareneingang</div>`;
}

function renderInventorySection(report) {
  const rows = (report.warenbestandRows || [])
    .slice()
    .sort((a, b) => (Number(b?.bestandswertEur) || 0) - (Number(a?.bestandswertEur) || 0));
  const inventoryValue = fmtCurrency(report.inventory?.totalValueEur ?? report.inventory?.inventoryValueEur);

  const header = renderSectionHeader(
    "Warenbestand zum Monatsende",
    `Bestandsstichtag ${fmtDate(report.inventory?.snapshotAsOf)}`,
    "Hier sehen Sie Bestand, Einstandspreis und Bestandswert je Artikel.",
  );
  const cards = renderSectionCards([
    { label: "Stichtag", value: fmtDate(report.inventory?.snapshotAsOf) },
    { label: "Artikel", value: String(rows.length) },
    { label: "Bestandswert", value: inventoryValue },
  ]);

  const tableRows = rows.map((row) => `<tr>
    <td>${esc(row.artikelnummerSku)}</td>
    <td>${esc(row.artikelbezeichnung)}</td>
    <td class="num">${fmtCell("integer", row.gesamtbestand)}</td>
    <td class="num">${fmtCell("currency", row.einstandspreisEur)}</td>
    <td class="num">${fmtCell("currency", row.bestandswertEur)}</td>
    <td>${esc(row.hinweis || "-")}</td>
  </tr>`).join("\n");

  return `
    ${header}${cards}
    <table>
      <thead><tr>
        <th>Artikelnummer</th><th>Artikel</th>
        <th style="text-align:right">Bestand</th>
        <th style="text-align:right">Einstandspreis</th>
        <th style="text-align:right">Bestandswert</th>
        <th>Hinweis</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    <div class="explain">
      <div class="explain-text">
        <h4>Kurz erklaert</h4>
        <p>Der Warenbestand gilt immer zum Monatsende.</p>
        <p>Der Bestandswert ergibt sich aus Bestand mal Einstandspreis.</p>
        <p>Es werden nur Hinweise gezeigt, die fuer die Buchhaltung relevant sein koennen.</p>
      </div>
      <div class="explain-badge">
        <div class="badge-label">Bestandswert</div>
        <div class="badge-value">${inventoryValue}</div>
      </div>
    </div>
    <div class="section-number">03</div>
    <div class="section-label">Warenbestand</div>`;
}

function renderQualitySection(report) {
  const rows = report.pruefhinweise || [];
  if (!rows.length) return "";

  const header = renderSectionHeader(
    "Pruefhinweise",
    `${rows.length} offene Hinweise`,
    "Hier sehen Sie Punkte, die bitte geprueft werden sollten.",
  );
  const cards = renderSectionCards([
    { label: "Hinweise", value: String(rows.length) },
    { label: "Monat", value: String(report.request?.month || "-") },
    { label: "Datei", value: String(report.uebersicht?.verbindlicheDatei || "-") },
  ]);

  const tableRows = rows.map((row) => `<tr>
    <td>${esc(row.bereich)}</td>
    <td>${esc(row.bezug)}</td>
    <td>${esc(row.hinweis)}</td>
    <td>${esc(row.relevanzFuerBuchhaltung)}</td>
  </tr>`).join("\n");

  return `
    <div class="page-break"></div>
    ${header}${cards}
    <table>
      <thead><tr>
        <th>Bereich</th><th>Bezug</th><th>Hinweis</th><th>Relevanz</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    <div class="explain">
      <div class="explain-text">
        <h4>Kurz erklaert</h4>
        <p>Hier stehen nur Punkte, bei denen noch eine kurze Pruefung sinnvoll ist.</p>
        <p>Wenn kein Hinweis vorhanden ist, ist das Paket an dieser Stelle vollstaendig.</p>
      </div>
      <div class="explain-badge">
        <div class="badge-label">Offene Punkte</div>
        <div class="badge-value">${rows.length}</div>
      </div>
    </div>
    <div class="section-number">04</div>
    <div class="section-label">Pruefen</div>`;
}

export function buildAccountantHtml(report) {
  const month = report.request?.month || "";

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Buchhaltung ${esc(month)}</title>
  <style>${CSS}</style>
</head>
<body>
  <div class="page">
    ${renderCoverPage(report)}
  </div>
  <div class="page page-break">
    ${renderPaymentsSection(report)}
  </div>
  <div class="page page-break">
    ${renderArrivalsSection(report)}
  </div>
  <div class="page page-break">
    ${renderInventorySection(report)}
  </div>
  <div class="page">
    ${renderQualitySection(report)}
    <div class="footer">
      Buchhaltung ${esc(month)} &mdash; generiert aus der Plattform
    </div>
  </div>
</body>
</html>`;
}
