# Robustheits-/Reorder-Entscheidungs-Protokoll (2026-06-02)

**Auftrag (Pierre):** Nächste Monate (Jun–Dez 2026) prüfen, ob jeder Monat robust ist — d. h. ob die
Ausgabenseite (PO/FO/PFO-Nachbestellungen) genauso vollständig geplant ist wie die Einnahmenseite
(Forecast-Umsatz). „Alles selber entscheiden und protokollieren."

## Befund (Engine-Robustheit + VO-Live-Cross-Check)

**Kein Monat Jun–Dez 2026 ist `robust`** — Einnahmeseite (VO-Forecast) überall hinterlegt, Ausgabenseite
unvollständig. 7 PFO-Vorschläge, gegen VO-Bestand+Velocity geprüft:

| SKU | VO | Bestand | Velocity | Reichweite | Klasse |
|---|---|---|---|---|---|
| 023.001 Rahmentasche | Active | 156 | 9,8/T | 0,5 Mon | echter Reorder, OOS ~2 Wo |
| 032.001 Gabeltasche | Active | 228 | 10,2/T | 0,7 Mon | echter Reorder, OOS ~3 Wo |
| I5 Dichtungsringe | Active | 36 | 1,3/T | 0,9 Mon | echter Reorder, OOS ~1 Mon |
| 035.001 Food Pouch | Inactive | 0 | – | – | Prelaunch (Initial-Order) |
| 021.002 Messerblock gerade | Inactive | 0 | – | – | Prelaunch (PO260007 deckt) |
| 021.003 Messerblock schräg | Inactive | 0 | – | – | Prelaunch (PO260007 deckt) |
| 024.002 Tassimo 2er | Inactive | 0 | 0,2/T | 0 | Fehlsignal → auslaufend |

## Entscheidungen (von Claude getroffen, 2026-06-02)

**E1 — Tassimo 2er (024.002) → auslaufend (`discontinued`).** Begründung: VO inaktiv, 0 Bestand,
~0,2 Verkäufe/Tag → keine reale Nachbestellung; Phantom-PFO + Phantom-Forecast-Umsatz raus (analog
Stahl-Tamper 2026-06). Umkehrbar (Backup). **Status: umgesetzt.**

**E2 — 3 echte Reorders als DRAFT-FO anlegen** (Rahmentasche 023.001, Gabeltasche 032.001,
Dichtungsringe I5-IMBE-OGXU). Parameter-Quellen (nicht erfunden):
- Menge = Engine-Coverage-Vorschlag (FO Coverage DOH 90); Einkaufspreis/Fracht = Produkt-Stammdaten;
  Lead-Times = Lieferant/Produkt; Order-Datum = **heute (2026-06)**, ETA = heute + Lead-Time;
  Zahlungsplan über Lieferanten-Terms.
- **Status DRAFT** (nicht ACTIVE): treibt den Cashflow (macht die Monate robust + bringt den Einkaufs-Cash
  in den Kontostand), kennzeichnet aber „von Claude geplant, von euch zu bestätigen/platzieren".
- Begründung: damit ist die Ausgabenseite geplant → der prognostizierte Kontostand wird ehrlicher (sinkt um
  die Einkaufs-Abflüsse). Umkehrbar. **Status: siehe unten.**

**E3 — Prelaunch (Messerblock gerade/schräg 021.002/003, Food Pouch 035.001) → keine Zweitbestellung jetzt.**
Begründung: nicht gelauncht (VO inaktiv, 0 Absatz); Messerblöcke über PO260007 (ETA Aug) angestoßen. Der
Engine-Flag „bestellen bis 18.06." ist eine verfrühte Zweitbestellung auf Basis der Plan-Brücke. Food Pouch
braucht eine Launch-Entscheidung (Initial-Order), kein Reorder. **Keine Datenänderung; dokumentiert.**
→ Diese SKUs bleiben in der Robustheits-Ampel als „Bestellpflicht" sichtbar, bis Launch/Order erfolgt — das
ist korrekt (Launch-Timing ist eine GF-Entscheidung, keine fehlende Routine-Nachbestellung).

**E4 — Liefer-Engpass Rahmen-/Gabeltasche → operativer Alarm.** OOS in 2–3 Wochen, Sea-Reorder kommt erst
~Sept (Lead-Time ~90 T) → interimistische OOS-Lücke Jun–Aug. Express-Teilmenge vs. Sea ist eine Ops-Entscheidung
für Pierre/Patrick; die DRAFT-FO (E2) bildet die reguläre nächste Charge ab, löst aber die Interims-Lücke nicht.
**Eskalation an euch; kein Daten-Fix.**

## Wirkung auf die Robustheit
Nach E1+E2 ist die Ausgabenseite für alle **echten** Reorders geplant; verbleibende Nicht-Robustheit Jun–Dez
ist dann ausschließlich den **Prelaunch-Items** (E3) zuzuordnen — also Launch-Timing, nicht fehlende Routine.

## Umsetzung & Verifikation (nach E1+E2)

- **E1 committed** (rev `84df8d8f`): Tassimo 2er `discontinued` → raus aus PFO/Bestellpflicht + Phantom-Forecast weg. ✓
- **E2 committed** (rev `fc277cee`): 3 DRAFT-FOs angelegt (Engine-Helfer, Order heute, Sea):
  - Rahmentasche 778 Stk @ 6,87 USD (+778 € Fracht), ETA 2026-09-16
  - Gabeltasche 715 Stk @ 7,60 USD (+965 € Fracht), ETA 2026-09-16
  - Dichtungsringe 500 Stk @ 0,48 USD (+5 € Fracht), ETA 2026-07-08
  - Kontostand-Wirkung (ehrlicher/niedriger): Dez 341.790 → 329.023 €; min Jun 88.126 € (alle Monate positiv).

**Robustheit nach Eingriff (Re-Run):** PFO 7 → 5. **Gedeckt:** Tassimo (E1), Dichtungsringe (FO ETA Juli deckt Okt-Risiko).
**Bleibt offen (bewusst, nicht grün-geschönt):**
- **Rahmen-/Gabeltasche:** FO-Cash ist im Plan, aber OOS-Lücke **Jun–Sept** bleibt (Sea-ETA Sept > OOS in 2–3 Wo).
  → **E4-Eskalation:** Express-/Teilmenge ist eine GF/Ops-Kosten-Entscheidung — die habe ich bewusst **nicht** im
  Alleingang als Air-FO gebucht (echter Mehrkosten-/Logistik-Entscheid). Eure Entscheidung.
- **Food Pouch / Messerblock gerade+schräg:** Prelaunch — Launch-Timing (PO260007 ETA Aug deckt Messerblöcke),
  keine fehlende Routine-Bestellung.

**Fazit:** Die Ausgabenseite ist für alle *echten Routine-Reorders* jetzt geplant; die verbleibende
Nicht-Robustheit Jun–Dez ist sauber zugeordnet auf (a) die Rahmen-/Gabeltasche-Lieferlücke (Ops-Entscheid) und
(b) Prelaunch-Launch-Timing — **nicht** auf fehlende/falsch hinterlegte Daten.
