#!/usr/bin/env node
// FBA Cashflow CLI — BWA-Import + "Naht"-Kalibrierung.
//
// Importiert die DATEV-BWA-GuV-Zeitreihe (03_Finanzen/09_BWA/_GuV-Zeitreihe-...csv) in den CFP-State:
//   Teil A  BWA-Ist je Einzelmonat ADDITIV in state.monthlyActuals[YYYY-MM] (eigene bwa*-Felder,
//           bestehende real*-Felder werden NIE angefasst).
//   Teil B  Saison-Kalibrierung der Forecast-"Naht" -> state.forecastCalibration.
//
// Methodik-Leitplanke: Der UMSATZ wird über den Saison-Anteil des Basisjahres hochkalibriert.
// Der GEWINN wird NIE aus dem abgeschlossenen Ist-Ergebnis hochgerechnet (der unterjährige
// Monatsgewinn ist durch Bestandsaufbau verzerrt), sondern immer über die STRUKTURELLE
// Basisjahr-Marge (Jahres-Ergebnis / Jahres-Umsatz).
//
// Aufruf (eigenständig):
//   node import-bwa.mjs <csv> [--commit] [--base-year=2025] [--forecast-year=2026] [--workspace=<uuid>]
// oder via cli.mjs:
//   node cli.mjs import-bwa <csv> [--commit] [--base-year=2025] [--forecast-year=2026]
//
// Default = DRY-RUN. Echtes Schreiben nur mit --commit. Vor jedem Write schreibt commitState()
// automatisch ein Backup nach ~/.fba-cli-backups/.

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { getConfig } from "./config.mjs";
import { commitState } from "./client.mjs";
import { validateState } from "./validate.mjs";

// --- Formatierung (lokal, entities.mjs hat kein fmtEUR) -------------------
const fmtEUR = (n) =>
  n == null || Number.isNaN(n)
    ? "—"
    : new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);
const fmtPct = (x) => (x == null || Number.isNaN(x) ? "—" : (x * 100).toFixed(2) + " %");
const todayIso = () => new Date().toISOString().slice(0, 10);

// --- Zahl defensiv parsen (CSV ist Punkt-Dezimal, leer -> null) ----------
function num(s) {
  if (s == null) return null;
  const t = String(s).trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// --- CSV einlesen: Kommentare (#) + Header (Periode) raus ----------------
// Spalten: Periode;Umsatz_Monat_EUR;Ergebnis_vor_Steuern_Monat_EUR;Quelle
// Achtung: das Quelle-Feld (Spalte 4) kann selbst Semikolons enthalten -> ab Spalte 4 wieder zusammenfügen.
export function parseBwaCsv(text) {
  const rows = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("Periode")) continue; // Header
    const cells = line.split(";");
    const periode = (cells[0] || "").trim();
    if (!periode) continue;
    rows.push({
      periode,
      umsatz: num(cells[1]),
      ergebnisVorSteuern: num(cells[2]),
      quelle: cells.slice(3).join(";").trim(), // Quelle kann Semikolons enthalten
    });
  }
  return rows;
}

// Zeilentypen über die Periode-Spalte klassifizieren.
const isMonth = (p) => /^\d{4}-\d{2}$/.test(p);
const isYear = (p) => /^\d{4}-JAHR$/i.test(p);
const quartalMatch = (p) => p.match(/^(\d{4})-Q([1-4])-kum$/i);

// "vorl.Ergebnis <zahl>" aus dem JAHR-Quelle-Text ziehen (Punkt-Dezimal).
function parseVorlaeufigesErgebnis(quelle) {
  const m = String(quelle || "").match(/vorl\.?\s*Ergebnis\s+([\d.]+)/i);
  return m ? num(m[1]) : null;
}

const monthKey = (year, m) => `${year}-${String(m).padStart(2, "0")}`;

// Saison-Kalibrierung berechnen. Erwartet die geparsten CSV-Zeilen.
export function computeCalibration(rows, baseYear, forecastYear, csvPath) {
  const months = rows.filter((r) => isMonth(r.periode));
  const monthUmsatz = (year, m) => {
    const row = months.find((r) => r.periode === monthKey(year, m));
    return row ? row.umsatz : null;
  };

  // 1) Abgeschlossener Forecast-Zeitraum: höchste Qn-kum-Zeile des forecast-year,
  //    sonst Summe der vorhandenen Einzelmonate.
  let stichtagQuartal = 0;
  let istUmsatzAbgeschlossen = null;
  let istErgebnisAbgeschlossen = null;
  for (const r of rows) {
    const q = quartalMatch(r.periode);
    if (q && Number(q[1]) === forecastYear) {
      const n = Number(q[2]);
      if (n > stichtagQuartal) {
        stichtagQuartal = n;
        istUmsatzAbgeschlossen = r.umsatz;
        istErgebnisAbgeschlossen = r.ergebnisVorSteuern;
      }
    }
  }
  let abgeschlosseneMonate;
  if (stichtagQuartal > 0) {
    // Qn-kum deckt Monate 1 .. n*3 ab.
    abgeschlosseneMonate = [];
    for (let m = 1; m <= stichtagQuartal * 3; m += 1) abgeschlosseneMonate.push(monthKey(forecastYear, m));
  } else {
    // Fallback: Summe der vorhandenen Einzelmonate des forecast-year.
    const fm = months.filter((r) => r.periode.startsWith(`${forecastYear}-`));
    abgeschlosseneMonate = fm.map((r) => r.periode).sort();
    istUmsatzAbgeschlossen = fm.reduce((s, r) => s + (r.umsatz || 0), 0) || null;
  }
  if (istUmsatzAbgeschlossen == null) {
    throw new Error(`Kein abgeschlossener Forecast-Zeitraum für ${forecastYear} in der CSV gefunden (weder Qn-kum noch Einzelmonate).`);
  }
  const stichtag = abgeschlosseneMonate[abgeschlosseneMonate.length - 1]; // letzter abgeschlossener Forecast-Monat
  const stichtagMonthNum = Number(stichtag.slice(5, 7));

  // 2) Basis-Umsatz desselben Saison-Zeitraums (gleiche Monate im base-year).
  let basisUmsatzGleicherZeitraum = 0;
  for (const mk of abgeschlosseneMonate) {
    const m = Number(mk.slice(5, 7));
    const u = monthUmsatz(baseYear, m);
    if (u == null) {
      throw new Error(`Basisjahr-Monat ${monthKey(baseYear, m)} fehlt in der CSV — Saison-Vergleichszeitraum unvollständig.`);
    }
    basisUmsatzGleicherZeitraum += u;
  }

  // 3) Basisjahr-Jahreswerte aus der JAHR-Zeile.
  const yearRow = rows.find((r) => isYear(r.periode) && r.periode.startsWith(`${baseYear}-`));
  if (!yearRow || yearRow.umsatz == null) {
    throw new Error(`JAHR-Zeile für ${baseYear} (oder deren Umsatz) fehlt in der CSV.`);
  }
  const baseYearTotalUmsatz = yearRow.umsatz;
  const baseYearErgebnisVorSteuern = yearRow.ergebnisVorSteuern; // aus Spalte 3 der JAHR-Zeile
  const baseYearVorlaeufigesErgebnis = parseVorlaeufigesErgebnis(yearRow.quelle); // aus dem Quelle-Text

  // 4) Kennzahlen.
  const niveauFaktor = istUmsatzAbgeschlossen / basisUmsatzGleicherZeitraum;
  const saisonAnteil = basisUmsatzGleicherZeitraum / baseYearTotalUmsatz;
  const jahrUmsatzPrognose = istUmsatzAbgeschlossen / saisonAnteil; // == niveauFaktor * baseYearTotalUmsatz
  const margeVorSteuern =
    baseYearErgebnisVorSteuern != null ? baseYearErgebnisVorSteuern / baseYearTotalUmsatz : null;
  const margeNachSteuern =
    baseYearVorlaeufigesErgebnis != null ? baseYearVorlaeufigesErgebnis / baseYearTotalUmsatz : null;
  const jahrErgebnisVorSteuernPrognose =
    margeVorSteuern != null ? jahrUmsatzPrognose * margeVorSteuern : null;
  const jahrVorlaeufigesErgebnisPrognose =
    margeNachSteuern != null ? jahrUmsatzPrognose * margeNachSteuern : null;

  // 5) Kalibrierte Forecast-Monate: jeder Monat NACH dem Stichtag = baseYearMonatUmsatz * niveauFaktor.
  //    Abgeschlossene Monate (<= Stichtag) bleiben Ist und werden NICHT kalibriert.
  const kalibrierteForecastMonate = {};
  for (let m = stichtagMonthNum + 1; m <= 12; m += 1) {
    const u = monthUmsatz(baseYear, m);
    if (u == null) continue; // kein Basiswert -> nicht kalibrierbar
    kalibrierteForecastMonate[monthKey(forecastYear, m)] = u * niveauFaktor;
  }

  return {
    baseYear,
    forecastYear,
    stichtag,
    abgeschlosseneMonate,
    istUmsatzAbgeschlossen,
    istErgebnisAbgeschlossen,
    basisUmsatzGleicherZeitraum,
    baseYearTotalUmsatz,
    baseYearErgebnisVorSteuern,
    baseYearVorlaeufigesErgebnis,
    niveauFaktor,
    saisonAnteil,
    jahrUmsatzPrognose,
    margeVorSteuern,
    margeNachSteuern,
    jahrErgebnisVorSteuernPrognose,
    jahrVorlaeufigesErgebnisPrognose,
    kalibrierteForecastMonate,
    methode:
      "Umsatz kalibriert über Saison-Anteil; Gewinn über STRUKTURELLE Basisjahr-Marge, " +
      "NICHT aus verzerrtem Ist-Ergebnis (Bestandsaufbau); Stichtag = letzter testierter Monat",
    stand: todayIso(),
    quelleCsv: csvPath,
  };
}

// --- Mutator: schreibt Teil A + Teil B in den State (in-memory) ----------
// Wird sowohl direkt (eigenständiger Aufruf) als auch über cli.mjs durch commitState() verwendet.
export function applyBwaImport(state, { rows, calibration, log = () => {} }) {
  // Teil A — BWA-Ist additiv in monthlyActuals.
  if (!state.monthlyActuals || typeof state.monthlyActuals !== "object") state.monthlyActuals = {};
  const stand = todayIso();
  const writtenMonths = [];
  for (const r of rows) {
    if (!isMonth(r.periode)) continue; // nur Einzelmonate; JAHR/Qn-kum gehen in die Kalibrierung
    const key = r.periode;
    const entry = state.monthlyActuals[key] || (state.monthlyActuals[key] = {});
    // NUR bwa*-Felder setzen. Bestehende real*-Felder NIEMALS überschreiben.
    entry.bwaUmsatzNetto = r.umsatz;
    entry.bwaErgebnisVorSteuern = r.ergebnisVorSteuern; // kann null sein
    entry.bwaQuelle = r.quelle;
    entry.bwaStand = stand;
    writtenMonths.push(key);
  }
  writtenMonths.sort();

  // Teil B — Kalibrierung ablegen.
  state.forecastCalibration = calibration;

  log(`Teil A: ${writtenMonths.length} BWA-Ist-Monate in monthlyActuals geschrieben (additiv, bwa*-Felder).`);
  log(`         ${writtenMonths.join(", ")}`);
  log("Teil B: state.forecastCalibration gesetzt.");
  return { writtenMonths };
}

// --- Lesbarer Report -----------------------------------------------------
function printReport(rows, cal, writtenMonths, dryRun) {
  const c = cal;
  console.log("\n=== BWA-Import — Ergebnis ===");
  console.log(`Modus: ${dryRun ? "DRY-RUN (nichts geschrieben — mit --commit ausführen)" : "COMMITTED"}`);
  console.log(`Quelle: ${c.quelleCsv}`);
  console.log("");
  console.log("--- Teil A: BWA-Ist (monthlyActuals, additiv) ---");
  console.log(`Geschriebene Monate (${writtenMonths.length}): ${writtenMonths.join(", ")}`);
  console.log("");
  console.log("--- Teil B: Naht-Kalibrierung ---");
  console.log(`Basisjahr: ${c.baseYear}   Forecast-Jahr: ${c.forecastYear}`);
  console.log(`Stichtag (letzter abgeschlossener Forecast-Monat): ${c.stichtag}`);
  console.log(`Abgeschlossene Forecast-Monate: ${c.abgeschlosseneMonate.join(", ")}`);
  console.log("");
  console.log(`Ist-Umsatz abgeschlossen:        ${fmtEUR(c.istUmsatzAbgeschlossen)}`);
  console.log(`Basis-Umsatz gleiche Saison:     ${fmtEUR(c.basisUmsatzGleicherZeitraum)}`);
  console.log(`Niveau-Faktor:                   ${c.niveauFaktor.toFixed(4)}  (${((c.niveauFaktor - 1) * 100).toFixed(2)} % vs. Basisjahr)`);
  console.log(`Saison-Anteil (abgeschl./Jahr):  ${fmtPct(c.saisonAnteil)}`);
  console.log("");
  console.log("--- Jahres-Prognose ---");
  console.log(`Umsatz-Prognose:                 ${fmtEUR(c.jahrUmsatzPrognose)}`);
  console.log(`Marge v. St. (Basisjahr):        ${fmtPct(c.margeVorSteuern)}`);
  console.log(`Marge n. St. (Basisjahr):        ${fmtPct(c.margeNachSteuern)}`);
  console.log(`Ergebnis-v.-Steuern-Prognose:    ${fmtEUR(c.jahrErgebnisVorSteuernPrognose)}`);
  console.log(`Vorl.-Ergebnis-Prognose:         ${fmtEUR(c.jahrVorlaeufigesErgebnisPrognose)}`);
  console.log("");
  console.log("--- Kalibrierte Forecast-Monate (Monate NACH Stichtag) ---");
  const km = c.kalibrierteForecastMonate;
  const keys = Object.keys(km).sort();
  if (!keys.length) console.log("  (keine — alle Basisjahr-Monate liegen vor dem Stichtag oder fehlen)");
  for (const k of keys) console.log(`  ${k}: ${fmtEUR(km[k])}`);
  console.log("");
  console.log("CAVEAT (Methodik-Leitplanke):");
  console.log("  Der Gewinn wird NICHT aus dem abgeschlossenen Ist-Ergebnis hochgerechnet — der unterjährige");
  console.log("  Monatsgewinn ist durch Bestandsaufbau verzerrt. Nur der UMSATZ wird über den Saison-Anteil");
  console.log("  kalibriert; der Gewinn läuft immer über die strukturelle Basisjahr-Marge.");
  console.log("");
  console.log(dryRun
    ? ">> DRY-RUN: nichts geschrieben. Mit --commit erneut ausführen, um zu schreiben (Backup automatisch)."
    : ">> COMMITTED: State geschrieben, Backup unter ~/.fba-cli-backups/.");
}

// --- Hauptlogik: von cli.mjs UND vom eigenständigen Aufruf genutzt -------
export async function runImportBwa({ csvPath, commit = false, force = false, baseYear = 2025, forecastYear = 2026, workspaceId } = {}) {
  if (!csvPath) throw new Error("import-bwa benötigt <csv> (Pfad zur GuV-Zeitreihe-CSV).");
  if (!fs.existsSync(csvPath)) throw new Error(`CSV nicht gefunden: ${csvPath}`);
  const text = fs.readFileSync(csvPath, "utf8");
  const rows = parseBwaCsv(text);
  const calibration = computeCalibration(rows, Number(baseYear), Number(forecastYear), csvPath);

  const cfg = getConfig({ workspaceId });
  const dryRun = !commit;
  let writtenMonths = [];
  const res = await commitState(
    cfg,
    (state) => {
      const r = applyBwaImport(state, { rows, calibration, log: () => {} });
      writtenMonths = r.writtenMonths;
    },
    { dryRun, force, label: "import-bwa", validateFn: validateState },
  );

  printReport(rows, calibration, writtenMonths, dryRun);
  if (!dryRun) {
    console.log(`\nNeue Rev: ${res.rev}`);
    if (res.backupFile) console.log(`Backup:   ${res.backupFile}`);
  }
  if (res.validation?.newErrors?.length) {
    console.log(`\n⚠ NEUE Validierungsfehler (${res.validation.newErrors.length}):`);
    for (const e of res.validation.newErrors) console.log("  - " + e);
  }
  return res;
}

// --- Eigenständiger Aufruf: node import-bwa.mjs <csv> [flags] -------------
function parseArgv(argv) {
  const positional = [];
  const flags = {};
  for (const a of argv) {
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      flags[k] = v === undefined ? true : v;
    } else positional.push(a);
  }
  return { positional, flags };
}

// Nur ausführen, wenn direkt gestartet (nicht beim Import aus cli.mjs).
// pathToFileURL ist robust gegen Leerzeichen/Sonderzeichen im Pfad (Google-Drive-Pfad!).
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { positional, flags } = parseArgv(process.argv.slice(2));
  runImportBwa({
    csvPath: positional[0],
    commit: Boolean(flags.commit),
    force: Boolean(flags.force),
    baseYear: flags["base-year"] || 2025,
    forecastYear: flags["forecast-year"] || 2026,
    workspaceId: flags.workspace,
  }).catch((err) => {
    process.stderr.write(`FEHLER: ${err.message}\n`);
    if (err.validation) process.stderr.write(JSON.stringify(err.validation, null, 2) + "\n");
    process.exit(1);
  });
}
