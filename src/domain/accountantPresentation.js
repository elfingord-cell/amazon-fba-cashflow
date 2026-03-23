export const ACCOUNTANT_CELL_TYPES = Object.freeze({
  text: "text",
  identifier: "identifier",
  date: "date",
  integer: "integer",
  currency: "currency",
  link: "link",
});

function toFiniteNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number;
}

export function formatAccountantDate(value, emptyValue = "-") {
  const raw = String(value || "").trim();
  if (!raw) return emptyValue;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return raw || emptyValue;
  return `${match[3]}.${match[2]}.${match[1]}`;
}

export function formatAccountantInteger(value, emptyValue = "-") {
  const number = toFiniteNumber(value);
  if (number == null) return emptyValue;
  return Math.round(number).toLocaleString("de-DE");
}

export function formatAccountantCurrency(value, emptyValue = "-") {
  const number = toFiniteNumber(value);
  if (number == null) return emptyValue;
  return number.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatAccountantDisplayValue(cellType, value, options = {}) {
  const emptyValue = options.emptyValue ?? "-";
  if (cellType === ACCOUNTANT_CELL_TYPES.date) return formatAccountantDate(value, emptyValue);
  if (cellType === ACCOUNTANT_CELL_TYPES.integer) return formatAccountantInteger(value, emptyValue);
  if (cellType === ACCOUNTANT_CELL_TYPES.currency) return formatAccountantCurrency(value, emptyValue);
  if (cellType === ACCOUNTANT_CELL_TYPES.link) {
    if (!String(value || "").trim()) return emptyValue;
    return String(options.linkLabel || "oeffnen");
  }
  if (value == null || value === "") return emptyValue;
  return String(value);
}

export function hasWarningHint(value) {
  const text = String(value || "").toLowerCase();
  return text.includes("pruefen") || text.includes("unklar") || text.includes("fehlt");
}

export function resolveAccountantStatusTone(tableKey, columnKey, row) {
  const hint = String(row?.hinweis || "").trim();
  const hasActualArrival = Boolean(row?.wareneingangLautSystem);
  const hasPlannedArrival = Boolean(row?.geplanteAnkunft);

  if (tableKey === "quality") return "warning";

  if (columnKey === "hinweis") {
    if (!hint) return "neutral";
    return hasWarningHint(hint) ? "warning" : "planned";
  }

  if (columnKey === "wareneingangGrundlageLabel" || columnKey === "statusZurBestellung") {
    if (hasActualArrival) return "neutral";
    if (hasPlannedArrival) return "planned";
  }

  if (columnKey === "fachlicheBehandlung" && hasWarningHint(row?.fachlicheBehandlung)) {
    return "warning";
  }

  return "neutral";
}

export function accountantToneToAntColor(tone) {
  if (tone === "warning") return "orange";
  if (tone === "planned") return "gold";
  return "default";
}

export const ACCOUNTANT_SHEET_SCHEMAS = Object.freeze({
  payments: {
    name: "Zahlungen Lieferanten",
    columns: [
      { key: "fachlicheBehandlung", label: "Fachliche Behandlung", cellType: "text", columnWidth: 24, wrap: true },
      { key: "zahlungsdatum", label: "Zahlungsdatum", cellType: "date", columnWidth: 13, alignment: "left" },
      { key: "lieferant", label: "Lieferant", cellType: "text", columnWidth: 20 },
      { key: "bestellnummerIntern", label: "Bestellnummer (intern)", cellType: "identifier", columnWidth: 18 },
      { key: "verknuepfteBestellung", label: "Verknuepfte Bestellung", cellType: "identifier", columnWidth: 18 },
      { key: "zahlungsart", label: "Zahlungsart", cellType: "text", columnWidth: 16 },
      { key: "betragIstEur", label: "Betrag Ist EUR", cellType: "currency", columnWidth: 15, alignment: "right" },
      { key: "betragUsd", label: "Betrag USD", cellType: "currency", columnWidth: 15, alignment: "right" },
      { key: "artikelMengen", label: "Artikel / Mengen", cellType: "text", columnWidth: 42, wrap: true },
      { key: "geplanteAbfahrt", label: "Geplante Abfahrt", cellType: "date", columnWidth: 15 },
      { key: "geplanteAnkunft", label: "Geplante Ankunft", cellType: "date", columnWidth: 15 },
      { key: "wareneingangLautSystem", label: "Wareneingang laut System", cellType: "date", columnWidth: 18 },
      { key: "wareneingangGrundlageLabel", label: "Datengrundlage Wareneingang", cellType: "text", columnWidth: 26, wrap: true },
      { key: "statusZurBestellung", label: "Status zur Bestellung", cellType: "text", columnWidth: 22, wrap: true },
      { key: "beleglink", label: "Beleglink", cellType: "link", columnWidth: 13, linkLabel: "oeffnen" },
      { key: "hinweis", label: "Hinweis", cellType: "text", columnWidth: 30, wrap: true },
    ],
  },
  arrivals: {
    name: "Wareneingaenge",
    columns: [
      { key: "fachlicheBehandlung", label: "Fachliche Behandlung", cellType: "text", columnWidth: 28, wrap: true },
      { key: "wareneingangLautSystem", label: "Wareneingang laut System", cellType: "date", columnWidth: 18 },
      { key: "wareneingangGrundlageLabel", label: "Datengrundlage Wareneingang", cellType: "text", columnWidth: 26, wrap: true },
      { key: "lieferant", label: "Lieferant", cellType: "text", columnWidth: 20 },
      { key: "bestellnummerIntern", label: "Bestellnummer (intern)", cellType: "identifier", columnWidth: 18 },
      { key: "verknuepfteBestellung", label: "Verknuepfte Bestellung", cellType: "identifier", columnWidth: 18 },
      { key: "artikelMengen", label: "Artikel / Mengen", cellType: "text", columnWidth: 42, wrap: true },
      { key: "gesamtmenge", label: "Gesamtmenge", cellType: "integer", columnWidth: 12, alignment: "right" },
      { key: "warenwertUsd", label: "Warenwert USD", cellType: "currency", columnWidth: 15, alignment: "right" },
      { key: "warenwertEur", label: "Warenwert EUR", cellType: "currency", columnWidth: 15, alignment: "right" },
      { key: "geplanteAbfahrt", label: "Geplante Abfahrt", cellType: "date", columnWidth: 15 },
      { key: "geplanteAnkunft", label: "Geplante Ankunft", cellType: "date", columnWidth: 15 },
      { key: "bisherigeLieferantenzahlungenEur", label: "Bisherige Lieferantenzahlungen laut System EUR", cellType: "currency", columnWidth: 20, alignment: "right" },
      { key: "davonImMonatBezahltEur", label: "Davon im aktuellen Monat bezahlt EUR", cellType: "currency", columnWidth: 19, alignment: "right" },
      { key: "transportart", label: "Transportart", cellType: "text", columnWidth: 14 },
      { key: "hinweis", label: "Hinweis", cellType: "text", columnWidth: 30, wrap: true },
    ],
  },
  inventory: {
    name: "Warenbestand Monatsende",
    columns: [
      { key: "artikelnummerSku", label: "Artikelnummer / SKU", cellType: "identifier", columnWidth: 22 },
      { key: "artikelbezeichnung", label: "Artikelbezeichnung", cellType: "text", columnWidth: 28 },
      { key: "warengruppe", label: "Warengruppe", cellType: "text", columnWidth: 18 },
      { key: "bestandAmazon", label: "Bestand Amazon", cellType: "integer", columnWidth: 14, alignment: "right" },
      { key: "bestandExternesLager", label: "Bestand externes Lager", cellType: "integer", columnWidth: 18, alignment: "right" },
      { key: "bestandImZulauf", label: "Bestand im Zulauf", cellType: "integer", columnWidth: 15, alignment: "right" },
      { key: "gesamtbestand", label: "Gesamtbestand", cellType: "integer", columnWidth: 14, alignment: "right" },
      { key: "einstandspreisEur", label: "Einstandspreis EUR", cellType: "currency", columnWidth: 16, alignment: "right" },
      { key: "bestandswertEur", label: "Bestandswert EUR", cellType: "currency", columnWidth: 16, alignment: "right" },
      { key: "hinweis", label: "Hinweis", cellType: "text", columnWidth: 24, wrap: true },
    ],
  },
  quality: {
    name: "Pruefhinweise",
    columns: [
      { key: "bereich", label: "Bereich", cellType: "text", columnWidth: 18 },
      { key: "bezug", label: "Bezug", cellType: "text", columnWidth: 20 },
      { key: "hinweis", label: "Hinweis", cellType: "text", columnWidth: 48, wrap: true },
      { key: "relevanzFuerBuchhaltung", label: "Relevanz fuer Buchhaltung", cellType: "text", columnWidth: 22, wrap: true },
    ],
  },
});

export function buildAccountantOverviewRows(report) {
  const overview = report?.uebersicht || {};
  const inventory = report?.inventory || {};
  const rows = [
    { label: "Monat", value: overview.monat || report?.request?.month || "", cellType: "text" },
    { label: "Verbindliche Datei", value: overview.verbindlicheDatei || "", cellType: "text" },
    { label: "Bestandsstichtag", value: overview.bestandStichtag || inventory.snapshotAsOf || "", cellType: "date" },
    { label: "Warenwert EUR", value: inventory.totalValueEur, cellType: "currency" },
    { label: "Zahlungen Lieferanten", value: overview.anzahlZahlungenLieferanten || 0, cellType: "integer" },
    { label: "Summe Zahlungen Ist EUR", value: overview.summeZahlungenIstEur || 0, cellType: "currency" },
    { label: "Bestaetigte Wareneingaenge im Monat", value: (overview.anzahlBestaetigteWareneingaenge ?? overview.anzahlWareneingaenge) || 0, cellType: "integer" },
    { label: "Summe bestaetigte Wareneingaenge EUR", value: (overview.summeBestaetigteWareneingaengeEur ?? overview.summeWareneingaengeEur) || 0, cellType: "currency" },
    { label: "Nur geplante Ankuenfte", value: overview.anzahlGeplanteAnkuenfte || 0, cellType: "integer" },
    { label: "Pruefhinweise", value: overview.anzahlPruefhinweise || 0, cellType: "integer" },
  ];

  return rows;
}
