# Buchhalter Export: One-Click Monats-Paket

## Ziel
Dieser Export erzeugt fuer einen gewaehleten Monat ein ZIP-Paket fuer die Buchhaltung mit:

1. Warenbestand zum Monatsende.
2. Lieferanzahlungen (PO, paidDate im Monat).
3. Wareneingaenge (PO, Arrival/ETA im Monat).
4. E-Mail Entwurf inkl. Anlagenliste.

## Enthaltene Dateien
Fuer Monat `YYYY-MM` werden erzeugt:

1. `buchhaltung_YYYY-MM_bericht.pdf`
2. `buchhaltung_YYYY-MM.xlsx`
3. `buchhaltung_YYYY-MM_warenbestand.csv`
4. `buchhaltung_YYYY-MM_anzahlungen_po.csv`
5. `buchhaltung_YYYY-MM_wareneingang_po.csv`
6. `buchhaltung_YYYY-MM_email.txt`
7. optional: `buchhaltung_YYYY-MM_zahlungsjournal.csv`

## Monatslogik

### Anzahlungen (PO)
Eine Zeile wird aufgenommen, wenn alle Bedingungen erfuellt sind:

1. Payment-Typ ist `Deposit`.
2. Status ist `PAID`.
3. `paidDate` liegt im Zielmonat.

### Wareneingang (PO)
Arrival-Datum wird in dieser Prioritaet bestimmt:

1. `arrivalDateDe`
2. `arrivalDate`
3. `etaManual`
4. `etaDate`
5. `eta`
6. Fallback auf berechnetes ETA

Die PO-Zeile wird aufgenommen, wenn das resultierende Datum im Zielmonat liegt.

## Datenqualitaet
Der Export blockiert nicht hart bei Datenluecken. Stattdessen werden `quality issues` erzeugt, z. B.:

1. fehlender Snapshot
2. fehlender EK-Preis
3. fehlende USD-Werte
4. fehlende Arrival-Daten
5. fehlende Invoice-/Folder-Links

## Scope

1. `core`: nur Kernblatter/Dateien
2. `core_plus_journal`: zusaetzlich `zahlungsjournal.csv` (nur PO-Zeilen)

## Legacy + V2
Beide UIs nutzen dieselbe Domain-Pipeline (`src/domain/accountantReport.js`).
Damit sind Filter- und Summenlogik zwischen Legacy und V2 identisch.

## Hinweis zur Technik
Im aktuellen Build-Environment ist npm-Netzwerkzugriff blockiert. Deshalb sind XLSX/PDF/ZIP lokal umgesetzt (ohne externe Runtime-Dependencies), mit unveraendertem One-Click-Workflow.
