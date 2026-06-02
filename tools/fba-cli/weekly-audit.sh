#!/usr/bin/env bash
# Wöchentlicher Glaubwürdigkeits-Audit + Telegram-Report (Mahona-Gruppe).
# Gedacht für einen Scheduled-Task (Mo 07:00). Schreibt state.audit (additiv, Backup) und meldet die Ampel.
set -euo pipefail
cd "$(dirname "$0")/../.."
node tools/fba-cli/cli.mjs audit --commit
node -e "import('./tools/fba-cli/audit.mjs').then(async (m) => { \
  const r = await m.runAudit({}); \
  const t = await import('./tools/fba-cli/notify-telegram.mjs'); \
  await t.sendTelegram(r.reportText + '\n\n(CFP-Wochen-Audit)'); \
  console.log('Telegram gesendet.'); \
})"
