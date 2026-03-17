# Project agent rules

## Core product rules
- Visible user flows are V2 only.
- Dashboard is aggregation only, never a second source of truth.
- Explicit data from Orders and Cash-in Setup beats estimates and fallbacks.
- Event-level truth beats PO-level heuristics.
- ETA/ETD, month, amount, status and colors must stay consistent across all visible tabs.

## Working rule for agents
Before accepting a fix as complete, check:
1. active V2 render path
2. single source of truth
3. no duplicate resolver/mapper
4. visible UI matches the intended behavior
