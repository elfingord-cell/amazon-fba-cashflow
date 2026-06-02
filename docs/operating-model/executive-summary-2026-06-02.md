# Executive Summary — CFP Vertrauens-Fundament & Lese-Dashboard (2026-06-02)

## 1. Was umgesetzt & live ist

**Vertrauens-Fundament (deployed, Commit-Kette bis `3d8c90d2`):**
- **Herkunfts-Regelwerk** (`src/domain/provenanceRules.js` + `docs/operating-model/herkunfts-ledger.md`): „eine Quelle pro Feld" + Konfliktprotokoll (fix&log / propose&dispose / stop&ask).
- **Provenienz-Stempel + Änderungs-Log**: jeder CLI-Write schreibt `state.provenance[entity] = {source, asOf, by, method, rev}` und einen `state.changeLog`-Eintrag (Ringpuffer ≤100). Additiv, Engine ignoriert es (Non-Regression-Test grün).
- **Glaubwürdigkeits-Audit** (`src/domain/credibilityAudit.js` + `tools/fba-cli/audit.mjs`): 8 Checks (Bestand/Forecast frisch, PFOs vollständig, FOs plausibel, Umsatz realistisch, Kontostand belastbar, Bucket-Integrität, Herkunfts-Abdeckung) → Ampel in `state.audit`. Läuft über die **echte Engine** (vite-SSR), baut keine zweite Wahrheit.
- **UI** (deployed): Glaubwürdigkeits-Ampel oben im Dashboard, `ProvenanceTag`-Komponente, Änderungs-Log in Methodik. Rein lesend/additiv.
- **Live-Stand jetzt:** Provenienz **100 %** (79/79 Entitäten gestempelt), Ampel **🔴 RED** wegen **4 überfälliger Bestellvorschläge (PFOs)** — ein echtes, sofort sichtbares Signal. Alle übrigen 7 Checks grün.

**Tests/QC:** offizielle v2-Parity-Suite grün, neue Tests grün (provenance-rules 5, credibility-audit 15, non-regression 1), Build grün, visueller Live-QC in Chrome bestätigt die Ampel.

## 2. Neuer Modus Operandi

- **Ihr (Pierre/Patrick) = Viewer + Entscheider.** Ihr lest Cockpit/Diagramme/P&L, trefft Policy (Dividende, große Bestell-Freigaben, Annahmen). Manuelle Eingabe bleibt möglich, ist aber nicht mehr der Normalweg für saubere Daten.
- **Claude = Pfleger über die CLI/API.** Spiegelt aus den Quellsystemen, plausibilisiert, stempelt Herkunft, meldet wöchentlich die Ampel. Jeder Write: Dry-Run → Backup → `rev`-Lock → Log. Irreversibel/finanziell immer mit eurer Freigabe.
- **Vertrauen = messbar:** Ampel (stimmt's gerade?) + Herkunft (woher kommt der Wert?) + Änderungs-Log (wer/wann/woher) + Forecast-vs-Ist im Audit.

## 3. Datenbank-Einträge & Strukturänderungen

- **Keine SQL-Migration.** Drei rein additive `state_json`-Keys: `state.provenance`, `state.audit`, `state.changeLog`. Fehlen sie, verhält sich alles wie bisher.
- **Wichtig (dokumentierte Annahme):** Diese drei Keys leben **nur in `workspace_state.state_json`**, werden **nicht** in die Einzeltabellen materialisiert (`app_materialize_state` kennt sie nicht). Wer künftig aus den materialisierten Tabellen liest, sieht sie nicht — bei Bedarf separat nachrüsten.
- Datenverlust-Risiko: **GRÜN** (code-belegt) — UI lädt via `ensureAppStateV2` mit offener Index-Signatur, unbekannte Keys überleben den UI-Roundtrip; `app_sync` schützt per `if_match_rev`.

## 4. Autonome Datenpflege — Lücken & nötige Routinen/Skills

Die Analyse (9-Agenten-Workflow) hat die Quellen-Landkarte erstellt. **Größte Autonomie-Lücken** und was sie schließt:

| Lücke | Heute | Einzurichten (Skill/CLI) |
|---|---|---|
| **Holvi** (Zahlungen `paid`/Datum, Fixkosten-Ist, Eröffnungssaldo) | manuell | **`sync-holvi.mjs`** — liest Holvi-Export, matcht Bankzeilen → `paid`+Datum, Fixkosten-Ist, Saldo-Vorschlag (source=holvi) |
| **Sellerboard-Ist** (Umsatz/Auszahlung) | jeden Monat von Hand im Soll-vs-Ist-Tab | **Sellerboard-Import** (Skill/CLI analog `vo-forecast-export`) → `monthlyActuals[...]` (source=sellerboard) |
| **PO-ETA / Lead Times** | manuell im Planner | Lead-Time-Sync VO→CFP (Dry-Run-Patch) + Frische-Ampel im Audit |
| **Provenienz in Auto-CLIs** | snapshot/po-sync/bwa stempeln (noch) nicht | `applyProvenance(...)` in `build-snapshot-from-ventory`, `sync-po-status`, `import-bwa` ergänzen |
| **Orchestrierung** | nur Snapshot läuft scheduled (1.) | **Monats-Orchestrator** (~3.) fährt Snapshot→Forecast→PO-Status→Holvi→Sellerboard→BWA→Audit ab, mit Dry-Run-Gate + Telegram |

**Routinen (Scheduled-Tasks) einzurichten:**
- **Wöchentlich Mo 07:00 — Glaubwürdigkeits-Audit** (`tools/fba-cli/weekly-audit.sh`: `audit --commit` + Telegram-Report). *Skripte liegen bereit; Scheduled-Task noch zu registrieren.*
- **Wöchentlich — `sync-po-status`** (PO-Empfang VO→CFP) + **Forecast-Refresh** (≤30 Tage, damit „Forecast aktuell" nie failt).
- **Monatlich — CFP-Monatsabschluss-Orchestrator** (s. o.).

## 5. FO/PFO — Architektur „keep", aber EINE Entscheidung für dich

Die FO/PFO-Architektur ist sauber (PO = nächste Bestellung in VO; FO = persistente Pipeline-Bestellung im CFP; PFO = rechnerischer Vorschlag). **Aber:** PFOs treiben den Cashflow **standardmäßig nicht** — `settings.dashboardShowPhantomFoInChart` ist per Default AUS. Heute trägt die Pipeline **nur über manuell angelegte echte FOs** in den Kontostand ein. Dein Prinzip („alle künftigen Bestellungen leben als FO/PFO und treiben den Cashflow") gilt damit für FO voll, für PFO nur hinter einem Default-Off-Schalter.

**→ Richtungsentscheidung (du):**
- **(A, empfohlen)** PFO-Pipeline standardmäßig in den Cashflow nehmen (`dashboardShowPhantomFoInChart` default AN) — **aber** PFO-Beträge im Chart visuell als „Forecast/unbestätigt" trennen (eigene Serie/Schraffur), damit echte FO/PO-Abflüsse nicht mit Schätz-PFOs vermischt wirken.
- **(B)** So lassen (nur echte FOs treiben die Pipeline) und in der Methodik festhalten: „Künftige Bestellung muss als FO angelegt werden, um cashflow-wirksam zu sein."

Kleinere FO/PFO-Verbesserungen (unabhängig): Begriffe entkoppeln („Ghost-FO" → „Verwaiste FOs", „PFO" → „Empfohlene Bestellung"), Lead-Time-Auflösung deduplizieren (zwei Implementierungen), PFO-Herkunft beim Konvertieren in den FO mitnehmen, PFO-Berechnung memoisieren.

## 6. Gefundener Bug (unabhängig, sollte weg)

`resetCalculationCockpit()` im Dashboard (Z. ~1798–1804) referenziert undefinierte Setter/Werte (`setRevenueBasisMode`, `methodikCalibrationEnabled` …) → der **„Zurücksetzen"-Button wirft beim Klick einen ReferenceError**. Toter/kaputter Code — reparieren oder Button entfernen.

## 7. Offene Entscheidungen für Pierre/Patrick

1. **FO/PFO-Pipeline-Default** (A vs. B, s. §5) — der zentrale Hebel.
2. **Scheduled-Tasks freigeben** (Wochen-Audit + Telegram, Monats-Orchestrator)?
3. **Reihenfolge der neuen Sync-Skills** — Empfehlung: Holvi zuerst (größte Lücke), dann Sellerboard-Ist.
4. **`resetCalculationCockpit`** reparieren oder Button entfernen?
5. UI-Redesign-Tiefe (Cockpit-Mockups liegen in `~/Downloads/cfp-ui-inspiration-2026-06-02/`).
