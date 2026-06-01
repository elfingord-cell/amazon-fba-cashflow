// bwaNahtAdapter.ts
//
// Reiner Adapter zwischen AppStateV2 und der Soll-Ist-Anzeige der GuV-Naht.
//
// FACHLOGIK (wichtig): Die monatliche DATEV-BWA ist ab 2026 bereits
// periodengerecht — MBD/DATEV bucht die Bestandsveränderung selbst (Konto
// 3950/3980), das Monatsergebnis vor Steuern ist damit schon der echte
// periodengerechte Gewinn. Es wird daher KEINE zusätzliche
// Bestandsveränderungs-Brücke mehr gerechnet (das wäre eine Doppelkorrektur).
// Der Adapter liest das DATEV-BWA-Ist je Monat direkt aus monthlyActuals und
// reicht zusätzlich den aus dem CLI committeten Jahres-Ausblick
// (state.forecastCalibration) durch. Greift NICHT in die Plan-GuV ein.
//
// Die Felder von forecastCalibration werden vom CLI
// tools/fba-cli/import-bwa.mjs committet (state.forecastCalibration).
// Die monthlyActuals-BWA-Felder (bwaUmsatzNetto, bwaErgebnisVorSteuern /
// bwaErgebnis, bwaQuelle) legt derselbe Import ab.

import type { AppStateV2 } from "../state/types";

export interface BwaNahtForecastCalibration {
  jahrUmsatzPrognose: number | null; // netto (DATEV-/Steuer-Basis)
  jahrUmsatzPrognoseBrutto: number | null; // brutto (Sellerboard-Maßstab)
  jahrErgebnisVorSteuernPrognose: number | null;
  jahrVorlaeufigesErgebnisPrognose: number | null;
  niveauFaktor: number | null;
  stichtag: string | null;
  baseYear: number | null;
  forecastYear: number | null;
  abgeschlosseneMonate: string[];
  kalibrierteForecastMonate: Record<string, number>;
  margeVorSteuern: number | null;
  margeNachSteuern: number | null;
  prognoseMethode: string | null;
  stand: string | null;
}

export interface BwaNahtResultRow {
  month: string;
  bwaUmsatzNettoEur: number | null;
  bwaErgebnisVorSteuernEur: number | null;
  quelle: string | null;
}

export interface BwaNahtResult {
  forecastCalibration: BwaNahtForecastCalibration | null;
  resultRows: BwaNahtResultRow[];
  notes: string[];
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function toNumberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// monthlyActuals-Felder liegen entweder flach (Zahl/String) oder als
// versioniertes Cell-Objekt { value, source, confidence } (DATEV-BWA-Import via
// tools/fba-cli/import-bwa.mjs) vor. Beide Formen defensiv auf eine Zahl bringen.
function cellNumberOrNull(value: unknown): number | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return toNumberOrNull((value as Record<string, unknown>).value);
  }
  return toNumberOrNull(value);
}

// bwaQuelle liegt analog flach (String) oder als Cell-Objekt { value } vor.
function cellStringOrNull(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    const inner = (value as Record<string, unknown>).value;
    return inner == null || inner === "" ? null : String(inner);
  }
  const raw = String(value);
  return raw === "" ? null : raw;
}

function normalizeMonthKey(value: unknown): string | null {
  if (!value) return null;
  const raw = String(value);
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{2})-(\d{4})$/);
  if (match) return `${match[2]}-${match[1]}`;
  return raw;
}

/**
 * buildBwaNaht
 *
 * @param {AppStateV2} state  Workspace-State (V2).
 * @returns {BwaNahtResult}   forecastCalibration (Jahres-Ausblick) und
 *   resultRows (DATEV-BWA-Ist je Monat: Umsatz netto + Ergebnis vor Steuern +
 *   Quelle), plus notes (Degradations-Hinweise). Es wird KEINE
 *   Bestandsveränderungs-Brücke mehr gerechnet — die DATEV-BWA ist bereits
 *   periodengerecht.
 */
export function buildBwaNaht(state: AppStateV2): BwaNahtResult {
  const notes: string[] = [];

  // --- Jahres-Ausblick (aus dem CLI committet) ------------------------------
  const calibrationRaw = (state as unknown as Record<string, unknown>).forecastCalibration;
  let forecastCalibration: BwaNahtForecastCalibration | null = null;
  if (calibrationRaw && typeof calibrationRaw === "object") {
    const c = calibrationRaw as Record<string, unknown>;
    forecastCalibration = {
      jahrUmsatzPrognose: toNumberOrNull(c.jahrUmsatzPrognose),
      jahrUmsatzPrognoseBrutto: toNumberOrNull(c.jahrUmsatzPrognoseBrutto),
      jahrErgebnisVorSteuernPrognose: toNumberOrNull(c.jahrErgebnisVorSteuernPrognose),
      jahrVorlaeufigesErgebnisPrognose: toNumberOrNull(c.jahrVorlaeufigesErgebnisPrognose),
      niveauFaktor: toNumberOrNull(c.niveauFaktor),
      stichtag: c.stichtag == null ? null : String(c.stichtag),
      baseYear: toNumberOrNull(c.baseYear),
      forecastYear: toNumberOrNull(c.forecastYear),
      abgeschlosseneMonate: Array.isArray(c.abgeschlosseneMonate)
        ? (c.abgeschlosseneMonate as unknown[]).map((m) => String(m))
        : [],
      kalibrierteForecastMonate: toRecord(c.kalibrierteForecastMonate) as Record<string, number>,
      margeVorSteuern: toNumberOrNull(c.margeVorSteuern),
      margeNachSteuern: toNumberOrNull(c.margeNachSteuern),
      prognoseMethode: c.prognoseMethode == null ? null : String(c.prognoseMethode),
      stand: c.stand == null ? null : String(c.stand),
    };
  } else {
    notes.push("Kein BWA-Import gefunden (state.forecastCalibration fehlt) — Jahres-Ausblick nicht verfügbar.");
  }

  // --- DATEV-BWA-Ist je Monat (direkt aus monthlyActuals, periodengerecht) ---
  const monthlyActuals = toRecord(state.monthlyActuals);
  const resultRows: BwaNahtResultRow[] = [];
  Object.keys(monthlyActuals).forEach((monthRaw) => {
    const month = normalizeMonthKey(monthRaw);
    if (!month) return;
    const entry = toRecord(monthlyActuals[monthRaw]);
    const bwaUmsatzNettoEur = cellNumberOrNull(entry.bwaUmsatzNetto);
    // Ergebnis vor Steuern: import-bwa legt dies als `bwaErgebnis` (Cell) ab;
    // ältere/flache Stände als `bwaErgebnisVorSteuern`. Beide akzeptieren.
    const bwaErgebnisVorSteuernEur = cellNumberOrNull(
      entry.bwaErgebnisVorSteuern ?? entry.bwaErgebnis,
    );
    // Nur Monate aufnehmen, die mindestens einen der beiden Werte haben.
    if (bwaUmsatzNettoEur == null && bwaErgebnisVorSteuernEur == null) return;
    const quelle = cellStringOrNull(entry.bwaQuelle);
    resultRows.push({ month, bwaUmsatzNettoEur, bwaErgebnisVorSteuernEur, quelle });
  });
  resultRows.sort((a, b) => a.month.localeCompare(b.month));

  return {
    forecastCalibration,
    resultRows,
    notes,
  };
}
