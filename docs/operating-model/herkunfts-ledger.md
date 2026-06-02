# Herkunfts-Ledger — Contract „eine Quelle pro Feld"

> Verbindliche Festlegung, **welche Quelle pro CFP-Feld führend ist** und **wie Konflikte aufgelöst werden**.
> Maschinenlesbare Quelle der Wahrheit: `src/domain/provenanceRules.js` (`PROVENANCE_RULES`). Dieses Doc ist
> die menschenlesbare Fassung. Bei Abweichung gilt die Config.

## Quelle pro Feld

| CFP-Position | `PROVENANCE_RULES`-Key | Führende Quelle | Pflege-Weg | Konfliktregel |
|---|---|---|---|---|
| Bestand (Snapshot) | `snapshot` | VentoryOne | `cfp-monats-bestandssnapshot` (Skill, monatl.) | VO gewinnt → CFP überschreiben + Log |
| Forecast-Umsatz | `forecastImport` | VentoryOne Forecast-Export | Import + Bestands-Cap | VO gewinnt; manueller Override schlägt VO (markiert) |
| POs (Wareneinkauf) | `po` | VentoryOne | `sync-po-status`, `po-einstandskosten-sync` | VO gewinnt für Menge/Status/Kosten; CFP-Zahlungsplan bleibt |
| Landed Cost / EK | `landedCost` | VO-Einstandspreis-Rechner | `po-einstandskosten-sync` | VO gewinnt |
| FOs / PFOs | `fo` | rechnerisch (Engine) | Engine erzeugt → Claude plausibilisiert/konvertiert | Engine ist Quelle; Konvertierung = Mensch-Freigabe |
| Zahlungen: `paid` / Zahlungsziel | `payment` | Holvi-Kontoauszug + PO-Zahlungsplan | Bank-Zeilen matchen (Monatsabschluss) | Bank-Ist gewinnt für `paid`+Datum |
| Fixkosten | `fixcost` | Abos + Holvi-Daueraufträge | aus Kontoauszug ableiten/abgleichen | Bank-Ist gewinnt; Annahmen = Mensch |
| Umsatz-Ist (Reconcile) | `revenueActual` | Sellerboard + Amazon-Payouts | `reconcile:revenue` (T078-Logik) | Sellerboard gewinnt für realisierten Umsatz |
| Steuern / BWA-Kalibrierung | `tax` | DATEV/Steuerberater-BWA | `import-bwa` | BWA gewinnt; Prognose-Annahmen = Mensch |
| Dividende | `dividend` | GF-Entscheidung | nur Mensch | Mensch, immer |
| Eröffnungssaldo | `openingBalance` | Bank-Ist (Holvi) | aus Kontoauszug | Bank-Ist gewinnt (Mensch bestätigt) |

## Konfliktlösungs-Protokoll (für Claude als Pfleger)

- **Mechanischer Sync mit klarer Leitquelle** → **fix & log** (autonom; Backup + `rev` + changeLog).
- **Annahme / Policy** → **propose, you dispose** (Vorschlag an Pierre/Patrick).
- **Irreversibel / finanziell** (löschen, große PO, Dividende, Zahlung auslösen) → **stop & ask** (nie ohne explizites OK).
- **Engine liefert Unplausibles** → Daten fixen *oder* als Code-Bug behandeln (Failing-Test → Fix → Deploy).

## Kadenz

- **Monatlich (1.)**: Bestands-Snapshot, Reconcile vs. Sellerboard, BWA/Steuer, Monatsabschluss-Vorbereitung.
- **Wöchentlich (Mo 07:00)**: Glaubwürdigkeits-Audit (`audit --commit`) + Telegram-Report in die Mahona-Gruppe.
- **Event-getrieben**: neue PO in VO → Sync · Bank-Eingang → `paid` · neue Fixkosten-Abrechnung → Update.

## Provenienz-Stempel

Jeder CLI-Write hinterlässt in `state.provenance[<entityKey>] = {source, asOf, by, method, rev}` und einen
`state.changeLog`-Eintrag (Ringpuffer ≤100). entityKey-Konvention: `product:<sku>`, `po:<id>`, `fo:<id>`,
`setting:<dottedPath>`, `snapshot:<month>`, `forecastImport:<sku>`, `fixcost:<id>`, `supplier:<id>`,
`opening:balance`.
