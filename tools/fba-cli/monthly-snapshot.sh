#!/bin/bash
# Monatlicher CFP-Bestands-Snapshot aus VentoryOne — deterministischer Wrapper fuer launchd.
# Schreibt IMMER den VORMONAT (date -v-1m). Dry-Run-Gate vor Commit. Telegram-Bestaetigung.
# Mapping/Logik steckt im node-Tool (warehouse_only, GF-Entscheidung 2026-06-01).
#
# Test ohne Write:   SNAPSHOT_DRY_RUN=1 bash tools/fba-cli/monthly-snapshot.sh
# Scharf (Commit):   bash tools/fba-cli/monthly-snapshot.sh
set -uo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
REPO="/Users/pierre/Library/CloudStorage/GoogleDrive-pierre.debotmiliau@gmail.com/.shortcut-targets-by-id/1t9g7LuoILhoKYwDrvKSQ9CSVvAGBBLD1/mahona/24_Softwareprojekte/01_Amazon_FBA_Cashflow/amazon-fba-cashflow"
NODE="/opt/homebrew/bin/node"
LOG="$HOME/Library/Logs/cfp-monthly-snapshot.log"

log(){ echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

# Telegram → Mahona-Gruppe (Patrick + Pierre). Keys aus ~/.pierre-keys.env; Werte werden NIE geloggt/ausgegeben.
send_tg(){
  local msg="$1"
  set -a; [ -f "$HOME/.pierre-keys.env" ] && . "$HOME/.pierre-keys.env"; set +a
  if [ -n "${TELEGRAM_MAHONA_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_MAHONA_GROUP_ID:-}" ]; then
    curl -s "https://api.telegram.org/bot${TELEGRAM_MAHONA_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_MAHONA_GROUP_ID}" \
      --data-urlencode "text=${msg}" >/dev/null 2>&1
  fi
}

MONTH=$(date -v-1m +%Y-%m)   # Vormonat
NOW=$(date +%Y-%m)
log "=== Start | Vormonat=$MONTH laufend=$NOW DRY_RUN=${SNAPSHOT_DRY_RUN:-0} ==="

# Safety: niemals den laufenden Monat schreiben
if [ "$MONTH" = "$NOW" ]; then
  log "ABBRUCH: Vormonat == laufend"
  send_tg "⚠️ CFP-Snapshot: Monatslogik-Fehler (Vormonat == laufend). Nicht geschrieben."
  exit 1
fi

cd "$REPO" || { log "ABBRUCH: Repo-Pfad nicht gefunden"; send_tg "⚠️ CFP-Snapshot $MONTH: Repo-Pfad nicht gefunden."; exit 1; }

# 1) DRY-RUN-Gate (kein Write)
DRY=$("$NODE" tools/fba-cli/build-snapshot-from-ventory.mjs --month="$MONTH" 2>&1)
DRY_RC=$?
echo "$DRY" | grep -E "SUMME|neue Fehler" >> "$LOG"
if [ $DRY_RC -ne 0 ] || ! echo "$DRY" | grep -qF "neue Fehler: []"; then
  log "ABBRUCH: Dry-Run nicht sauber (rc=$DRY_RC)"
  send_tg "⚠️ CFP-Snapshot $MONTH NICHT geschrieben — Dry-Run nicht sauber (rc=$DRY_RC). Bitte manuell pruefen."
  exit 1
fi
SUMME=$(echo "$DRY" | grep "SUMME:" | tail -1)

# Test-Modus: hier stoppen, NICHT committen
if [ "${SNAPSHOT_DRY_RUN:-0}" = "1" ]; then
  AMZ=$(echo "$DRY" | grep -oE 'amazon=[0-9]+' | head -1 | cut -d= -f2)
  TPL=$(echo "$DRY" | grep -oE '3PL=[0-9]+' | head -1 | cut -d= -f2)
  log "TEST-MODUS: kein Commit | $SUMME"
  MSG=$("$NODE" tools/fba-cli/snapshot-summary.mjs --test --month="$MONTH" --amazon="${AMZ:-0}" --threepl="${TPL:-0}" 2>/dev/null)
  [ -z "$MSG" ] && MSG="🧪 [TEST] CFP-Snapshot $MONTH (Vormonat) — Dry-Run ok, kein Commit. Amazon ${AMZ:-?} Stk, 3PL ${TPL:-?} Stk."
  send_tg "$MSG"
  echo "TEST OK: Ziel-Monat $MONTH (Vormonat) | $SUMME | kein Commit"
  exit 0
fi

# 2) COMMIT (Auto-Backup passiert im node-Tool vor dem Write)
OUT=$("$NODE" tools/fba-cli/build-snapshot-from-ventory.mjs --month="$MONTH" --commit 2>&1)
RC=$?
echo "$OUT" | grep -E "SUMME|geschrieben|Backup" >> "$LOG"
if [ $RC -ne 0 ]; then
  log "ABBRUCH: Commit fehlgeschlagen (rc=$RC)"
  send_tg "⚠️ CFP-Snapshot $MONTH: Commit fehlgeschlagen (rc=$RC). Bitte manuell pruefen."
  exit 1
fi
SUMME=$(echo "$OUT" | grep "SUMME:" | tail -1)
log "COMMIT ok | $SUMME"
# Lesbare Zusammenfassung (€ Bestandswert + Einheiten) aus dem committeten State
MSG=$("$NODE" tools/fba-cli/snapshot-summary.mjs --month="$MONTH" 2>/dev/null)
[ -z "$MSG" ] && MSG="✅ CFP-Bestandssnapshot $MONTH (Vormonat) committed (Detail-Summary nicht verfügbar). ${SUMME}. Quelle VentoryOne, warehouse_only."
send_tg "$MSG"
echo "COMMIT OK: $MONTH | $SUMME"
