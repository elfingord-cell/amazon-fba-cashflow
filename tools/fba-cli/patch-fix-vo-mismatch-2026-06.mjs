// Reparatur-Patch (Stand 2026-06): Fehl-Mappings auf VentoryOne-Korrekturbuchungen korrigieren.
//
// Hintergrund: VentoryOne vergibt PO-Nummern automatisch hochzählend. Für vergangene
// Bestandskorrekturen wurden Korrektur-POs angelegt, die ebenfalls eine Nummer bekamen; der
// Zähler wurde danach manuell zurückgesetzt, damit die nächste echte PO die "richtige" Nummer
// erhält. Folge: in VO existieren ZWEI POs mit identischer po_number — eine echte Bestellung und
// eine "Korrektur"-Buchung.
//
// Der frühere sync-po-status matchte nur über po_number und nahm bei Dubletten die erste in der
// API-Reihenfolge -> bei 260006 und 260009 die archivierte Korrektur-Buchung statt der echten PO:
//
//   CFP 260006 -> VO 300359 "PO26x - Korrektur Sitzkissen"   (Received, archived)   FALSCH
//                 echt:  VO 301542 "PO260006 - BIKEPACK-Grossbestellung" (Ordered, ETA 2026-07-07)
//   CFP 260009 -> VO 307464 "Manuelle Korrektur - Lenkertasche" (Received)          FALSCH
//                 echt:  VO 307545 "PO260009 - Nespresso 2er + Dichtungsringe" (Ordered, ETA 2026-07-09)
//
// Belegt: CFP 260009 enthält die SKUs PO-6TKA-Q0VA (Nespresso-Kapsel) + I5-IMBE-OGXU
// (Dichtungsringe) = exakt die Line-Items der echten Nespresso-PO 307545.
//
// Folgen im State:
//   - falsche ventoryPoId (zeigt auf Korrektur-Buchung)
//   - arrivalDate aus dem Korrektur-Empfangsdatum (260006: 2026-03-23 = VOR dem Bestelldatum;
//     260009: 2026-05-28) -> beide Bestellungen sind in Wahrheit noch "Ordered" (nicht empfangen)
//   - 260009 zusätzlich fälschlich archiviert
//
// Fix (GF-bestätigt 2026-06-01):
//   - ventoryPoId auf die echte VO-id umhängen
//   - arrivalDate löschen (Ware noch nicht empfangen)
//   - etaManual aus VO-Planeingang setzen (260006: 2026-07-07, 260009: 2026-07-09)
//   - 260009 entarchivieren
//   - 260003 wird NICHT angefasst (Mapping VO 123625 ist korrekt: echte PO, real Received 2026-05-25)
//
// Aufruf:
//   node tools/fba-cli/cli.mjs apply tools/fba-cli/patch-fix-vo-mismatch-2026-06.mjs            # dry-run
//   node tools/fba-cli/cli.mjs apply tools/fba-cli/patch-fix-vo-mismatch-2026-06.mjs --commit   # schreibt

const FIXES = [
  {
    id: "po-typ47r3",
    poNo: "260006",
    wrongVentoryPoId: 300359,
    ventoryPoId: 301542,
    etaManual: "2026-07-07",
    clearArrival: true,
    unarchive: false,
  },
  {
    id: "po-cfp260009", // poNo-Fallback greift, falls die id abweicht
    poNo: "260009",
    wrongVentoryPoId: 307464,
    ventoryPoId: 307545,
    etaManual: "2026-07-09",
    clearArrival: true,
    unarchive: true,
  },
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
  return a === b || a === `PO${b}` || `PO${a}` === b;
}

export default async function (state) {
  const pos = Array.isArray(state?.pos) ? state.pos : [];
  const log = (m) => console.log("  " + m);

  console.log("\n=== Fix VO-Fehl-Mappings (Korrekturbuchungs-Dubletten) ===");

  for (const fix of FIXES) {
    const po = pos.find((p) => matchesTarget(p, fix));
    if (!po) {
      log(`!! NICHT GEFUNDEN: PO${fix.poNo} (id=${fix.id})`);
      continue;
    }
    const changes = [];

    if (String(po.ventoryPoId) !== String(fix.ventoryPoId)) {
      changes.push(`ventoryPoId ${po.ventoryPoId ?? "—"} -> ${fix.ventoryPoId}`);
      po.ventoryPoId = fix.ventoryPoId;
    }
    if (fix.clearArrival && po.arrivalDate != null) {
      changes.push(`arrivalDate ${po.arrivalDate} -> (leer, nicht empfangen)`);
      po.arrivalDate = null;
    }
    if (fix.etaManual && po.etaManual !== fix.etaManual) {
      changes.push(`etaManual ${po.etaManual ?? "—"} -> ${fix.etaManual}`);
      po.etaManual = fix.etaManual;
    }
    if (fix.unarchive && po.archived === true) {
      changes.push(`archived true -> false (entarchiviert)`);
      po.archived = false;
    }

    if (changes.length === 0) {
      log(`~~ PO${fix.poNo} (id=${po.id}): bereits korrekt — nichts zu tun.`);
    } else {
      log(`FIX PO${fix.poNo} (id=${po.id}): ${changes.join("; ")}.`);
    }
  }

  console.log("=== fertig ===");
}
