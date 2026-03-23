# Buchhalterpaket: Empfaengerorientiertes Monats-Paket

## Ziel
Der Export erzeugt ein empfaengerreifes Monats-Paket fuer Frau Kalinna. Standardmaessig enthaelt das Paket nur:

1. `01_Monatsuebersicht_YYYY-MM.pdf`
2. `02_Buchhaltungslisten_YYYY-MM.xlsx`

Die Plattform liefert damit nur die Teile, die sie fachlich sauber bereitstellen kann. Externe Unterlagen wie Kontoauszuege, Kreditkartenabrechnungen und Amazon-Dokumente bleiben bewusst ausserhalb der Plattform.

## Standard-Inhalt

### PDF `01_Monatsuebersicht_YYYY-MM.pdf`
Enthaelt nur:

1. Welche Datei verbindlich ist
2. Summen und Anzahl relevanter Lieferantenzahlungen, Wareneingaenge und Warenbestand
3. Bewertungsgrundlage
4. Vollstaendigkeit innerhalb der Plattform
5. Manuell ausserhalb der Plattform beizulegende Unterlagen
6. Offene Pruefhinweise in Klartext

### XLSX `02_Buchhaltungslisten_YYYY-MM.xlsx`
Enthaelt nur diese Blaetter:

1. `Uebersicht`
2. `Zahlungen Lieferanten`
3. `Wareneingaenge`
4. `Warenbestand Monatsende`
5. optional `Pruefhinweise`

## Sichtbare Fachlogik

### Zahlungen Lieferanten
Nur tatsaechlich im Monat bezahlte Lieferantenvorgaenge.

Pflichtspalten:

1. `Fachliche Behandlung`
2. `Zahlungsdatum`
3. `Lieferant`
4. `Bestellnummer (intern)`
5. `Verknuepfte Bestellung`
6. `Zahlungsart`
7. `Betrag Ist EUR`
8. `Betrag USD`
9. `Artikel / Mengen`
10. `Geplante Abfahrt`
11. `Geplante Ankunft`
12. `Wareneingang laut System`
13. `Datengrundlage Wareneingang`
14. `Status zur Bestellung`
15. `Beleglink`
16. `Hinweis`

Mapping `Fachliche Behandlung`:

1. `Deposit` -> `Anzahlung buchen`
2. `Balance` -> `Restzahlung buchen`
3. `Balance2` -> `zweite Restzahlung buchen`
4. `Shipping/Freight` -> `Fracht buchen`
5. `Zoll` -> `Zoll buchen`
6. `EUSt` -> `EUSt buchen`
7. unklare Zahlungsart -> `Pruefen: Zahlungsart unklar`

### Wareneingaenge
Nur im Monat relevante Wareneingaenge.

Pflichtspalten:

1. `Fachliche Behandlung`
2. `Wareneingang laut System`
3. `Datengrundlage Wareneingang`
4. `Lieferant`
5. `Bestellnummer (intern)`
6. `Verknuepfte Bestellung`
7. `Artikel / Mengen`
8. `Gesamtmenge`
9. `Warenwert USD`
10. `Warenwert EUR`
11. `Geplante Abfahrt`
12. `Geplante Ankunft`
13. `Bisherige Lieferantenzahlungen laut System EUR`
14. `Davon im aktuellen Monat bezahlt EUR`
15. `Transportart`
16. `Hinweis`

Mapping `Fachliche Behandlung`:

1. tatsaechlicher Wareneingang -> `Wareneingang erfassen / mit Anzahlungen abstimmen`
2. ETA-basierter Wareneingang -> `Nur Information: Wareneingang noch nicht bestaetigt`

### Warenbestand Monatsende

1. `Artikelnummer / SKU`
2. `Artikelbezeichnung`
3. `Warengruppe`
4. `Bestand Amazon`
5. `Bestand externes Lager`
6. `Bestand im Zulauf`
7. `Gesamtbestand`
8. `Einstandspreis EUR`
9. `Bestandswert EUR`
10. `Hinweis`

## Optionaler Rohdaten-Export
CSV-Dateien werden weiterhin technisch erzeugt, aber nicht mehr standardmaessig im Paket mitgeliefert. Sie sind nur fuer spaetere interne oder erweiterte Exporte vorgesehen.

## Nicht-Ziele

1. Keine Integration von Kontoauszuegen
2. Keine Integration von Kreditkartenabrechnungen
3. Keine Integration von Amazon Gebuehren- oder Werbekostenrechnungen
4. Keine Modellierung neuer Rechnungsnummern, Kontierungen oder Bank-Beleglogik

## Single Source of Truth
Beide UIs und alle Exportformate lesen dieselbe Domain-Pipeline in `src/domain/accountantReport.js`. Workbook, PDF und V2-Preview duerfen keine eigene Fachlogik fuer Terminologie, Hinweise oder Monatsfilter haben.
