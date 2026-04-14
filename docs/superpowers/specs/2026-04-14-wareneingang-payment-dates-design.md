# Wareneingang: Zahlungsdaten (Anzahlung + Restzahlung)

**Datum:** 2026-04-14
**Anforderung:** Steuerbuero MBD (Fr. Kalinna) benoetigt pro Wareneingang die Zahlungsdaten der Anzahlung und Restzahlung fuer die Zuordnung auf dem Anzahlungskonto.

## Scope

Nur Deposit + Balance Meilensteine. EUSt/Zoll/Fracht sind separate Buchungsvorgaenge und stehen bereits auf der Zahlungsseite.

## Aenderungen

### 1. accountantReport.js — buildArrivalsSection()

Neue Felder pro Wareneingang-Zeile:
- `anzahlungDatum` (string | null) — ISO date der Deposit-Zahlung
- `anzahlungBetragEur` (number | null) — tatsaechlich gezahlter EUR-Betrag
- `restzahlungDatum` (string | null) — ISO date der Balance-Zahlung
- `restzahlungBetragEur` (number | null) — tatsaechlich gezahlter EUR-Betrag

Quelle: `paymentRows` aus `buildPaymentTotalsForRecord()`, gefiltert via `normalizeAccountantPaymentType()`.

### 2. accountantPresentation.js — ACCOUNTANT_SHEET_SCHEMAS.arrivals

4 neue Spalten nach `davonImMonatBezahltEur`:
- `anzahlungBetragEur` | "Anzahlung EUR" | currency | 15
- `anzahlungDatum` | "Anzahlung Datum" | date | 14
- `restzahlungBetragEur` | "Restzahlung EUR" | currency | 15
- `restzahlungDatum` | "Restzahlung Datum" | date | 14

Excel + React-UI erben die Spalten automatisch.

### 3. accountantHtml.js (NEU)

HTML-Rendering des gesamten Reports mit eingebettetem CSS. Gleicher Look wie bestehendes PDF. Wird als HTML-Datei ins Bundle gelegt. Alter accountantPdf.js bleibt als Fallback unveraendert.

### 4. accountantBundle.js

HTML-Datei ins ZIP aufnehmen.

## Nicht im Scope

- Alter Raw-PDF-Builder bekommt die neuen Spalten NICHT
- Zahlungen-Seite, Warenbestand-Seite — unveraendert
