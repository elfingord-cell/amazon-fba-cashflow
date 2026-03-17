---
name: dashboard-consistency-check
description: Nutze diesen Skill immer dann, wenn Dashboard, Matrix, Cash-in, POs, FOs, Timelines, ETA/ETD, Zahlungsstatus oder Monatswerte gegeneinander geprüft werden müssen.
---

# Ziel
Sicherstellen, dass sichtbare V2-Flächen nur aggregieren und keine zweite Wahrheit erzeugen.

# Harte Regeln
- Dashboard ist nur Aggregation.
- Sichtbare Nutzerpfade sind V2-only.
- Eine fachliche Wahrheit darf nur einmal abgeleitet werden.
- Explizite Daten aus Bestellungen oder Cash-in Setup schlagen Schätzungen und Fallbacks.
- Event-Level schlägt PO-Level-Heuristik.
- ETA/ETD, Monat, Betrag, Status und Farben müssen in allen sichtbaren Flächen identisch sein.

# Prüfschritte
1. Bestimme die aktive Route und den echten Renderpfad.
2. Bestimme die Single Source of Truth.
3. Liste alle Resolver/Mapper auf, die dieselbe Wahrheit ableiten.
4. Prüfe auf Duplikate oder konkurrierende Ableitungen.
5. Vergleiche:
   - Dashboard vs Cash-in Setup
   - Dashboard vs Orders
   - PO-Modal vs PO-Liste vs Matrix
   - ETA/ETD zwischen allen betroffenen Views
   - Zahlungsstatus zwischen Orders und Dashboard
6. Gib eine harte Entscheidung:
   - konsistent
   - inkonsistent

# Output-Format
- Active route:
- Visible component path:
- Single source of truth:
- Competing resolvers/mappers:
- Inconsistency found:
- Exact affected files:
- Safe fix scope:
