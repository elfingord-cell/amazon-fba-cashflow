# Buchhalter Export: One-Click Monats-Paket

## Ziel
Dieser Export erzeugt fuer einen gewaehleten Monat ein ZIP-Paket fuer die Buchhaltung mit:

1. Warenbestand zum Monatsende.
2. Zahlungen im Monat (PO, paidDate im Monat, inkl. Deposit/Balance/Balance2/Shipping-Freight/EUSt/Zoll).
3. Wareneingaenge im Monat (PO, Arrival/ETA im Monat).
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

### Zahlungen im Monat (PO)
Eine Zeile wird aufgenommen, wenn alle Bedingungen erfuellt sind:

1. Status ist `PAID`.
2. Zahlungsdatum ist im Zielmonat:
   `paidDate`, bei fehlendem `paidDate` Fallback auf `dueDate` + Hinweis `DATE_UNCERTAIN`.
3. Zahlungs-Typ ist aus vorhandenen Daten klassifiziert:
   `Deposit`, `Balance`, `Balance2`, `Shipping/Freight`, `EUSt`, `Zoll`.

Unklare Typen werden als `Other` mit Hinweis `PAYMENT_TYPE_UNCLEAR` exportiert (keine Betrags-Erfindung).

### Wareneingaenge im Monat (PO)
Arrival-Datum wird in dieser Prioritaet bestimmt:

1. `arrivalDateDe`
2. `arrivalDate`
3. `etaManual`
4. `etaDate`
5. `eta`
6. Fallback auf berechnetes ETA

Die PO-Zeile wird aufgenommen, wenn das resultierende Datum im Zielmonat liegt.

### Kombiliste (PO)
`buchhaltung_YYYY-MM_anzahlung_wareneingang_po.csv` bleibt bestehen und fuehrt eine klare Relevanz aus:

1. `Zahlung im Monat`
2. `Wareneingang im Monat`
3. `Zahlung im Monat + Wareneingang im Monat`
4. `Nicht relevant im Monat`

### Item-Darstellung
In den PO-Tabellen werden zwei Sichten geliefert:

1. `itemSummary` (gekuerzt, z. B. `Alias1, ...`)
2. `allItems` (vollstaendige Itemliste)

## Datenqualitaet
Der Export blockiert nicht hart bei Datenluecken. Stattdessen werden `quality issues` erzeugt, z. B.:

1. fehlender Snapshot
2. fehlender EK-Preis
3. fehlende USD-Werte bei USD-relevanten Zahlungspositionen
4. fehlende Arrival-Daten
5. fehlende Invoice-/Folder-Links
6. unklare Zahlungstypen

## Scope

1. `core`: nur Kernblaetter/Dateien
2. `core_plus_journal`: zusaetzlich `zahlungsjournal.csv` (nur PO-Zeilen)

## Kompatibilitaet
Dateinamen bleiben unveraendert. Bestehende CSV/XLSX/PDF-Formate bleiben erhalten, Inhalte wurden auf die klare Monatslogik umgestellt.

## Legacy + V2
Beide UIs nutzen dieselbe Domain-Pipeline (`src/domain/accountantReport.js`).
Damit sind Filter- und Summenlogik zwischen Legacy und V2 identisch.

## Hinweis zur Technik
Im aktuellen Build-Environment ist npm-Netzwerkzugriff blockiert. Deshalb sind XLSX/PDF/ZIP lokal umgesetzt (ohne externe Runtime-Dependencies), mit unveraendertem One-Click-Workflow.
