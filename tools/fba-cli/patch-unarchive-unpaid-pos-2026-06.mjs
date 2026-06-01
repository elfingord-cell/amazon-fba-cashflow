// Reparatur-Patch (Stand 2026-06): zwei fälschlich archivierte POs entarchivieren.
//
// Hintergrund: sync-po-status archivierte POs früher, sobald VO.status=="Received", ohne zu
// prüfen, ob die PO auch voll bezahlt ist. mahona setzt POs in VentoryOne aber oft 2-3 Tage VOR
// Ankunft auf "Received", während die 70%-Balance-Zahlung noch offen ist. Der CFP-Cashflow
// ignoriert Zahlungen archivierter POs (poPaymentsLedger.js:453 / paymentJournalCore.js:419
// `if (record.archived) return;`) -> die offene Restzahlung verschwand aus dem Cashflow.
//
// Betroffen (verifiziert über paymentLog vs. milestones):
//   - PO260003 (cfpId po-83xub4y): Balance 70% offen (nur Deposit bezahlt).
//   - PO260006 (cfpId po-typ47r3): Balance 70% offen (~29k EUR Order, nur Deposit bezahlt).
//
// Fix: archived = false setzen -> offene Balance kommt zurück in den Cashflow.
//      arrivalDate + ventoryPoId BLEIBEN erhalten (der Empfang stimmt ja, die PO ist nur noch
//      nicht abgeschlossen). Defensiv: nur anfassen, wenn die PO aktuell archived===true ist.
//
// Aufruf:
//   node tools/fba-cli/cli.mjs apply tools/fba-cli/patch-unarchive-unpaid-pos-2026-06.mjs            # dry-run
//   node tools/fba-cli/cli.mjs apply tools/fba-cli/patch-unarchive-unpaid-pos-2026-06.mjs --commit   # schreibt

// Match per CFP-id (primär) ODER poNo (fallback), damit der Patch robust ist.
const TARGETS = [
  { id: "po-83xub4y", poNo: "260003" },
  { id: "po-typ47r3", poNo: "260006" },
];

function normalizePoNo(raw) {
  if (raw == null) return "";
  return String(raw).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function matchesTarget(po, target) {
  if (po == null) return false;
  if (po.id != null && String(po.id) === target.id) return true;
  const a = normalizePoNo(po.poNo);
  const b = normalizePoNo(target.poNo);
  if (!a || !b) return false;
  // präfix-tolerant: "260006" == "PO260006"
  return a === b || a === `PO${b}` || `PO${a}` === b;
}

export default async function (state) {
  const pos = Array.isArray(state?.pos) ? state.pos : [];
  const log = (m) => console.log("  " + m);

  console.log("\n=== Unarchive fälschlich archivierte (empfangene, aber unbezahlte) POs ===");

  for (const target of TARGETS) {
    const po = pos.find((p) => matchesTarget(p, target));
    if (!po) {
      log(`!! NICHT GEFUNDEN: PO${target.poNo} (id=${target.id})`);
      continue;
    }
    if (po.archived !== true) {
      log(`~~ ÜBERSPRUNGEN: PO${target.poNo} (id=${po.id}) ist bereits archived=${po.archived} — nichts zu tun.`);
      continue;
    }
    po.archived = false;
    log(
      `UNARCHIVE PO${target.poNo} (id=${po.id}): archived true -> false; ` +
      `arrivalDate=${po.arrivalDate ?? "—"} und ventoryPoId=${po.ventoryPoId ?? "—"} BLEIBEN erhalten. ` +
      `Offene Restzahlung kommt zurück in den Cashflow.`,
    );
  }

  console.log("=== fertig ===");
}
