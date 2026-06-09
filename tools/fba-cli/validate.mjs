// FBA Cashflow CLI — State-Validierung.
//
// Seit 2026-06-09 keine Kopie mehr: UI (WorkspaceTransferPanel) und CLI
// importieren dieselbe Implementierung aus src/lib/stateValidation.mjs.
// Hinweis: app_sync selbst erzwingt diese Regeln NICHT serverseitig — Validierung ist advisory.

export { validateState } from "../../src/lib/stateValidation.mjs";
