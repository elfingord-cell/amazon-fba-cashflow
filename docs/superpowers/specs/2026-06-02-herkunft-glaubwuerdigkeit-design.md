# Design: Herkunfts-Ledger + Glaubwürdigkeits-Ampel (Vertrauens-Fundament)

- **Datum**: 2026-06-02
- **Status**: Genehmigt im Prinzip (Pierre, 2026-06-02 — „passt so wie vorgeschlagen")
- **Strategischer Kontext**: Die Plattform wird vom manuellen Eingabe-Tool zum **Lese-/Analyse-Dashboard**,
  das Claude über die API/CLI pflegt und plausibilisiert. Vertrauen bricht heute durch **Bugs in der
  Nutzung** und durch die Frage **„ist die angezeigte Zahl glaubwürdig?"**. Dieses Fundament macht jede
  Zahl **nachvollziehbar (Herkunft), überprüfbar (Audit) und umkehrbar (Log/Backup)** — bevor irgendeine
  UI- oder Logik-Politur kommt.

## Ziel in einem Satz

Jeder Wert im CFP soll beantworten können: **woher komme ich, wann zuletzt aktualisiert, von wem** —
und ein wöchentlicher Auto-Check sagt mit einer Ampel: **stimmt gerade alles, oder muss jemand ran.**

## Drei gekoppelte Bausteine

### A. Herkunfts-Regelwerk (das Contract: „eine Quelle pro Feld")

Verbindliche, versionierte Festlegung, **welche Quelle pro Feld führend ist** und **wie Konflikte aufgelöst
werden**. Zwei Artefakte:

1. **Doc** (`docs/operating-model/herkunfts-ledger.md`) — menschenlesbar, die Tabelle unten ausformuliert.
2. **Maschinenlesbare Config** (`src/domain/provenanceRules.js`, exportiert `PROVENANCE_RULES`) — die der
   Audit + die CLI nutzen, um Soll-Quelle und Konfliktregel je Entität zu kennen.

| CFP-Position | Führende Quelle | Pflege-Weg | Konfliktregel |
|---|---|---|---|
| Bestand (Snapshot) | VentoryOne | `cfp-monats-bestandssnapshot` (Skill, monatl.) | VO gewinnt → CFP überschreiben + Log |
| Forecast-Umsatz | VentoryOne Forecast-Export | Import + Bestands-Cap | VO gewinnt; manueller Override schlägt VO (markiert) |
| POs (Wareneinkauf) | VentoryOne | `sync-po-status`, `po-einstandskosten-sync` | VO gewinnt für Mengen/Status/Kosten; CFP-Zahlungsplan bleibt |
| Landed Cost / EK | VO-Einstandspreis-Rechner | `po-einstandskosten-sync` | VO gewinnt |
| FOs / PFOs | rechnerisch (Engine, aus Absatz+Bestand) | Engine erzeugt → Claude plausibilisiert/konvertiert | Engine ist Quelle; Konvertierung = Mensch-Freigabe |
| Zahlungen: `paid` / Zahlungsziel | Holvi-Kontoauszug + PO-Zahlungsplan | Bank-Zeilen matchen (Monatsabschluss) | Bank-Ist gewinnt für `paid`+Datum |
| Fixkosten | Abos + Holvi-Daueraufträge | aus Kontoauszug ableiten/abgleichen | Bank-Ist gewinnt; Annahmen = Mensch |
| Umsatz-Ist (Reconcile) | Sellerboard + Amazon-Payouts | `reconcile:revenue` (T078-Logik) | Sellerboard gewinnt für realisierten Umsatz |
| Steuern / BWA-Kalibrierung | DATEV/Steuerberater-BWA | `import-bwa` | BWA gewinnt; Prognose-Annahmen = Mensch |
| Dividende | GF-Entscheidung | nur Mensch | Mensch, immer |
| Eröffnungssaldo | Bank-Ist (Holvi) | aus Kontoauszug | Bank-Ist gewinnt (Mensch bestätigt) |

**Konfliktlösungs-Protokoll (gilt für Claude als Pfleger):**
- **Mechanischer Sync mit klarer Leitquelle** → fix & log (autonom).
- **Annahme/Policy** → propose, you dispose (Vorschlag an Pierre).
- **Irreversibel/finanziell** (löschen, große PO, Dividende, Zahlung) → stop & ask (nie ohne explizites OK).
- **Engine liefert Unplausibles** → Daten fixen *oder* als Code-Bug behandeln (Failing-Test → Fix → Deploy).

### B. Provenienz-Stempel (Laufzeit, additiv, non-breaking)

Jeder Write über die CLI stempelt **wer/woher/wann/wie**. Gespeichert additiv in `state_json`, **von der
Engine ignoriert** (keine Berechnung hängt dran):

```
state.provenance = {
  "<entityKey>": {            // z.B. "product:029.001-TAMPER-STEEL", "setting:fxRate", "po:PO-6TKA-Q0VA"
    source: "vo" | "sellerboard" | "holvi" | "claude" | "human" | "computed",
    asOf: "2026-06-02T08:00:00Z",   // Stand der Quell-Daten
    by: "claude" | "human" | "<skill/cli-label>",
    method: "snapshot-sync" | "po-status-sync" | "manual-edit" | ...,
    rev: "<workspace rev nach dem Write>"
  }
}
```

- **CLI**: `commitState` (schreibt schon Backup + `rev`) bekommt einen Provenienz-Helfer, der die betroffenen
  Entitäten stempelt. Mutatoren geben optional `provenance` mit an.
- **Backfill**: einmalig best-effort für bekannte Quellen (Snapshots→vo, Import→vo, etc.); fehlende Stempel
  sind erlaubt → in der UI als „Herkunft unbekannt" (amber), verbessert sich über die Zeit. Kein
  Voll-Retrofit nötig.

### C. Glaubwürdigkeits-Audit (CLI-Verb + Scheduled + Report)

`node tools/fba-cli/cli.mjs audit` — rein **lesend**, berechnet Checks, gibt Report aus; mit `--write`
zusätzlich Ergebnis in `state.audit` (für die UI-Ampel); als Scheduled-Task wöchentlich + Telegram.

**Ergebnis-Schema:**
```
state.audit = {
  lastRun: "2026-06-02T08:00:00Z",
  by: "claude",
  overall: "green" | "amber" | "red",
  checks: [ { key, label, status, detail, drill } ]
}
```

**MVP-Checks (alle aus vorhandenem State/Engine rein-lesend berechenbar):**
| Check | grün, wenn … | Quelle im Code |
|---|---|---|
| `snapshot_fresh` | jüngster Inventar-Snapshot ≤ 35 Tage | `state.inventory.snapshots` |
| `forecast_current` | aktive Baseline/Import ≤ 35 Tage | `state.forecast` Baseline-Datum |
| `pfo_complete` | keine **überfälligen** offenen PFOs; alle Fehlbestände haben Vorschlag | `buildPhantomFoSuggestions` |
| `fo_plausible` | keine FO mit Lead-Time, die das Zieldatum nicht mehr schafft | Phantom-FO / `dashboardRobustness` |
| `revenue_realistic` | ø Forecast-vs-Ist-Abweichung der Ist-Monate ≤ Band (z. B. ±25 %) | `computeSeries().kpis.actuals.avgRevenueDeltaPct` |
| `balance_sane` | Kontostand-Kette ohne NaN/Lücken; `firstNegativeMonth` gemeldet | `computeSeries().breakdown` |
| `bucket_sums` | Σ Forecast je Bucket = Gesamt (Engine-Invariante) | `computeSeries()` forecastMaps |
| `provenance_coverage` | Anteil Entitäten mit Herkunfts-Stempel (Info/amber) | `state.provenance` |

**Phase 2 (eigene Datenquellen, später):** `revenue_reconciled` (vs. Sellerboard), `payments_matched`
(vs. Holvi-Bank). Bewusst nicht im MVP, weil externe Pulls nötig.

**Report:** Klartext-Telegram in die Mahona-Gruppe (gleicher Kanal wie der Monats-Snapshot): „🟢/🟡/🔴
Glaubwürdigkeit — <n> grün, <m> Hinweise. Offen: …". Wöchentlich (Default Montagmorgen).

### D. UI (read-only, additiv)
- **Ampel-Header** auf dem Dashboard: ein Streifen oben „🟢 geprüft von Claude am … · 6/8 grün" → Klick
  klappt die Check-Liste mit Klartext-Detail + Drill-Link auf.
- **Herkunfts-Badge**: kleines „Herkunft: VO · 01.06. · Claude" an Produkt-/PO-/Forecast-Zeilen (liest
  `state.provenance`).
- **Änderungs-Log**: einfache Ansicht der letzten Writes (rev + Label + Quelle + Zeit) — speist sich aus
  `state.provenance` bzw. einer schlanken `state.changeLog`-Liste (die CLI hängt pro Write einen Eintrag an,
  gekappt auf die letzten N).

## Datenmodell-Ergänzungen (alle additiv, Engine ignoriert)
- `state.provenance` (Map, s. B)
- `state.audit` (letzter Audit, s. C)
- `state.changeLog` (Ringpuffer letzte ~100 Writes: `{at, by, label, source, rev, summary}`)

Keine Migration nötig: fehlen die Keys, verhält sich alles wie heute.

## Tests
- **Audit-Checks**: je Check ein Parity-Test mit konstruiertem State (grün/amber/rot-Fall) — rein-lesend,
  deterministisch.
- **Provenienz-Stempel**: CLI-Write stempelt die richtige Entität mit `{source, by, asOf, rev}`; fehlender
  Stempel bricht nichts.
- **Non-Regression**: `computeSeries` mit/ohne `provenance/audit/changeLog` identisch (Engine ignoriert sie).

## Nicht im Scope (YAGNI)
- Voll-Retrofit aller historischen Werte mit Provenienz (best-effort-Backfill reicht).
- Tägliches Audit (wöchentlich + on-demand genügt bei eurem Puffer).
- Auto-Fix ohne Log (jede Änderung bleibt nachvollziehbar/umkehrbar).
- Sellerboard-/Holvi-Reconcile-Checks (Phase 2).
- UI-Umbau/Nav-Konsolidierung (separates, späteres Thema).

## Festgelegte Parameter (2026-06-02)

- **Schwellen**: `snapshot_fresh` grün ≤ 35 T / amber 36–60 / rot > 60. `forecast_current` grün ≤ 35 T /
  amber ≤ 60 / rot > 60. `revenue_realistic` grün |ø-Δ| ≤ 25 % / amber ≤ 40 / rot > 40. `provenance_coverage`
  grün ≥ 80 % / amber 50–79 / rot < 50. Schwellen zentral in `provenanceRules.js` (`AUDIT_THRESHOLDS`), nicht
  hartcodiert verstreut.
- **`overall`-Ableitung**: rot, wenn ≥1 Check rot; sonst amber, wenn ≥1 amber; sonst grün. `provenance_coverage`
  ist „nur Info" und kann `overall` höchstens auf amber ziehen, nie auf rot.
- **entityKey-Konvention**: `product:<sku>`, `po:<id>`, `fo:<id>`, `setting:<dottedPath>`,
  `snapshot:<month>`, `forecastImport:<sku>`, `fixcost:<id>`, `supplier:<id>`, `opening:balance`.
- **`changeLog`**: Ringpuffer, gekappt auf die letzten **100** Einträge (älteste fallen raus).
- **Report-Kanal**: Telegram **Mahona-Gruppe** (gleicher Kanal/Token wie `cfp-monats-bestandssnapshot`).
- **Audit-Kadenz (Scheduled)**: wöchentlich **Montag 07:00** (Europe/Berlin) + jederzeit on-demand per CLI.
- **MVP-Set**: die 8 Checks aus Abschnitt C. `revenue_reconciled` + `payments_matched` = Phase 2.

## Phasen
1. **Regelwerk** (Doc + `provenanceRules.js`) — reine Festlegung, kein Risiko.
2. **Audit-CLI** (`audit`-Verb, MVP-Checks, `--write`) + Tests.
3. **Provenienz-Stempel** in `commitState` + Backfill + `changeLog`.
4. **UI**: Ampel-Header + Badge + Log (read-only).
5. **Scheduled-Task** wöchentlich + Telegram-Report.

Jede Phase ist für sich nützlich und deploybar.
