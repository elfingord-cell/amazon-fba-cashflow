// Tests für die reine Sync-Logik (planPoStatusSync / applyPoStatusSync / isPoFullyPaid).
// Lauf: node --test tools/fba-cli/sync-po-status.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planPoStatusSync,
  applyPoStatusSync,
  isPoFullyPaid,
  isCorrectionVoPo,
  pickRealVoPo,
} from "./sync-po-status.mjs";

// --- Helper: eine voll bezahlte PO (Deposit + Balance beide paid) ----------
function fullyPaidPo(extra = {}) {
  return {
    milestones: [
      { id: "dep1", label: "Deposit", percent: 30 },
      { id: "bal1", label: "Balance", percent: 70 },
    ],
    paymentLog: {
      dep1: { status: "paid", amountActualEur: 100 },
      bal1: { status: "paid", amountActualEur: 233 },
    },
    ...extra,
  };
}

// --- isPoFullyPaid --------------------------------------------------------

test("isPoFullyPaid: Deposit+Balance beide paid -> true", () => {
  const po = fullyPaidPo();
  assert.equal(isPoFullyPaid(po), true);
});

test("isPoFullyPaid: Deposit paid, Balance fehlt im paymentLog -> false", () => {
  const po = {
    milestones: [
      { id: "dep1", label: "Deposit", percent: 30 },
      { id: "bal1", label: "Balance", percent: 70 },
    ],
    paymentLog: {
      dep1: { status: "paid", amountActualEur: 100 },
      // bal1 fehlt komplett -> noch nicht bezahlt
    },
  };
  assert.equal(isPoFullyPaid(po), false);
});

test("isPoFullyPaid: ohne milestones, eine paid-Zahlung -> true (fallback)", () => {
  const po = { paymentLog: { x1: { status: "paid", amountActualEur: 50 } } };
  assert.equal(isPoFullyPaid(po), true);
});

test("isPoFullyPaid: ohne milestones, eine unbezahlte Zahlung -> false (fallback)", () => {
  const po = { paymentLog: { x1: { status: "scheduled" } } };
  assert.equal(isPoFullyPaid(po), false);
});

test("isPoFullyPaid: 'po-auto-...-duty' bricht nicht (nur Nebenkosten, kein Milestone)", () => {
  const po = {
    milestones: [
      { id: "dep1", label: "Deposit", percent: 30 },
      { id: "bal1", label: "Balance", percent: 70 },
    ],
    paymentLog: {
      dep1: { status: "paid" },
      bal1: { status: "paid" },
      "po-auto-xyz-duty": { status: "paid", amountActualEur: 12 },
      "po-auto-xyz-fx_fee": { status: "paid", amountActualEur: 3 },
    },
  };
  assert.equal(isPoFullyPaid(po), true);
});

test("isPoFullyPaid: milestoneId-Referenz statt Map-Key wird erkannt", () => {
  const po = {
    milestones: [{ id: "m-deep", label: "Deposit", percent: 100 }],
    paymentLog: {
      "payrow-abc": { status: "paid", milestoneId: "m-deep" },
    },
  };
  assert.equal(isPoFullyPaid(po), true);
});

// --- planPoStatusSync -----------------------------------------------------

test("1. VO Received + voll bezahlt + archived=false -> ARCHIVE, ventoryPoId + voReceivedDate übernommen", () => {
  const cfpPos = [fullyPaidPo({ id: "c1", poNo: "260002", archived: false })];
  const voPos = [{ id: 301542, po_number: "PO260002", status: "Received", order_received_date: "2026-05-15" }];
  const plan = planPoStatusSync(cfpPos, voPos);
  assert.equal(plan.toArchive.length, 1);
  const e = plan.toArchive[0];
  assert.equal(e.action, "ARCHIVE");
  assert.equal(e.ventoryPoId, 301542);
  assert.equal(e.voReceivedDate, "2026-05-15");
  assert.equal(plan.toReceiveUnpaid.length, 0);
  assert.equal(plan.toMapOnly.length, 0);
  assert.equal(plan.unmatched.length, 0);
});

test("1b. VO Received + Balance offen + archived=false -> RECEIVE_UNPAID (nicht ARCHIVE)", () => {
  const cfpPos = [{
    id: "c6",
    poNo: "260006",
    archived: false,
    milestones: [
      { id: "dep1", label: "Deposit", percent: 30 },
      { id: "bal1", label: "Balance", percent: 70 },
    ],
    paymentLog: { dep1: { status: "paid", amountActualEur: 9839.89 } },
  }];
  const voPos = [{ id: 300359, po_number: "PO260006", status: "Received", order_received_date: "2026-03-23" }];
  const plan = planPoStatusSync(cfpPos, voPos);
  assert.equal(plan.toArchive.length, 0);
  assert.equal(plan.toReceiveUnpaid.length, 1);
  const e = plan.toReceiveUnpaid[0];
  assert.equal(e.action, "RECEIVE_UNPAID");
  assert.equal(e.ventoryPoId, 300359);
  assert.equal(e.voReceivedDate, "2026-03-23");
  assert.equal(e.fullyPaid, false);
});

test("2. VO Ordered + CFP archived=false -> kein ARCHIVE, aber MAP (ventoryPoId)", () => {
  const cfpPos = [{ id: "c5", poNo: "260005", archived: false }];
  const voPos = [{ id: 301545, po_number: "PO260005", status: "Ordered", order_received_date: null }];
  const plan = planPoStatusSync(cfpPos, voPos);
  assert.equal(plan.toArchive.length, 0);
  assert.equal(plan.toReceiveUnpaid.length, 0);
  assert.equal(plan.toMapOnly.length, 1);
  assert.equal(plan.toMapOnly[0].action, "MAP");
  assert.equal(plan.toMapOnly[0].ventoryPoId, 301545);
});

test("3. VO Received + CFP bereits archived=true (+ ID gemappt) -> NOOP", () => {
  const cfpPos = [{ id: "c2", poNo: "260002", archived: true, ventoryPoId: 301542 }];
  const voPos = [{ id: 301542, po_number: "PO260002", status: "Received", order_received_date: "2026-05-15" }];
  const plan = planPoStatusSync(cfpPos, voPos);
  assert.equal(plan.toArchive.length, 0);
  assert.equal(plan.toReceiveUnpaid.length, 0);
  assert.equal(plan.toMapOnly.length, 0);
  assert.equal(plan.all.length, 1);
  assert.equal(plan.all[0].action, "NOOP");
});

test("4. Matching: poNo '260002' matcht VO po_number 'PO260002' (Präfix-tolerant)", () => {
  const cfpPos = [{ id: "c1", poNo: "260002", archived: false }];
  const voPos = [{ id: 301542, po_number: "PO260002", status: "Ordered" }];
  const plan = planPoStatusSync(cfpPos, voPos);
  assert.equal(plan.unmatched.length, 0);
  assert.equal(plan.all.length, 1);
  assert.equal(plan.all[0].ventoryPoId, 301542);
});

test("5. CFP-PO ohne VO-Match -> unmatched", () => {
  const cfpPos = [{ id: "cX", poNo: "999999", archived: false }];
  const voPos = [{ id: 301542, po_number: "PO260002", status: "Received" }];
  const plan = planPoStatusSync(cfpPos, voPos);
  assert.equal(plan.unmatched.length, 1);
  assert.equal(plan.unmatched[0].poNo, "999999");
  assert.equal(plan.toArchive.length, 0);
  assert.equal(plan.toReceiveUnpaid.length, 0);
  assert.equal(plan.toMapOnly.length, 0);
});

// --- Korrektur-Erkennung + Dubletten-Disambiguierung ----------------------

test("isCorrectionVoPo: 'Korrektur Sitzkissen' / 'Manuelle Korrektur' -> true; echte PO -> false", () => {
  assert.equal(isCorrectionVoPo({ order_name: "PO26x - Korrektur Sitzkissen" }), true);
  assert.equal(isCorrectionVoPo({ order_name: "Manuelle Korrektur - Lenkertasche großes Logo" }), true);
  assert.equal(isCorrectionVoPo({ order_name: "PO260006 - BIKEPACK-Grossbestellung" }), false);
  assert.equal(isCorrectionVoPo({ order_name: "" }), false);
});

test("pickRealVoPo: bei Dublette gewinnt die echte PO, nicht die Korrektur-Buchung (Sitzkissen)", () => {
  const correction = { id: 300359, po_number: "PO260006", order_name: "PO26x - Korrektur Sitzkissen", status: "Received", archived: true, order_placed_date: null };
  const real = { id: 301542, po_number: "PO260006", order_name: "PO260006 - BIKEPACK-Grossbestellung", status: "Ordered", archived: false, order_placed_date: "2026-04-02" };
  assert.equal(pickRealVoPo([correction, real], "260006").id, 301542);
  assert.equal(pickRealVoPo([real, correction], "260006").id, 301542); // reihenfolgeunabhängig
});

test("pickRealVoPo: Nespresso-Dublette -> echte PO 307545 statt 'Manuelle Korrektur'", () => {
  const correction = { id: 307464, po_number: "PO260009", order_name: "Manuelle Korrektur - Lenkertasche großes Logo", status: "Received", archived: false, order_placed_date: null };
  const real = { id: 307545, po_number: "PO260009", order_name: "PO260009 - Nespresso 2er + Dichtungsringe", status: "Ordered", archived: false, order_placed_date: "2026-05-29" };
  assert.equal(pickRealVoPo([correction, real], "260009").id, 307545);
});

test("pickRealVoPo: Einzelkandidat wird IMMER zurückgegeben (auch ohne order_placed_date)", () => {
  const only = { id: 300359, po_number: "PO260006", status: "Received", order_received_date: "2026-03-23" };
  assert.equal(pickRealVoPo([only], "260006").id, 300359);
  assert.equal(pickRealVoPo([], "260006"), null);
});

test("8. planPoStatusSync: Dublette (Korrektur + echt) -> mappt auf die echte VO-id", () => {
  const cfpPos = [{ id: "c6", poNo: "260006", archived: false }];
  const voPos = [
    { id: 300359, po_number: "PO260006", order_name: "PO26x - Korrektur Sitzkissen", status: "Received", order_received_date: "2026-03-23", archived: true, order_placed_date: null },
    { id: 301542, po_number: "PO260006", order_name: "PO260006 - BIKEPACK-Grossbestellung", status: "Ordered", order_received_date: "2026-07-07", archived: false, order_placed_date: "2026-04-02" },
  ];
  const plan = planPoStatusSync(cfpPos, voPos);
  assert.equal(plan.unmatched.length, 0);
  assert.equal(plan.all[0].ventoryPoId, 301542);   // echte PO, NICHT die Korrektur 300359
  assert.equal(plan.all[0].voStatus, "Ordered");
  assert.equal(plan.toArchive.length, 0);            // Ordered -> kein Empfang/Archiv
  assert.equal(plan.toMapOnly.length, 1);
});

test("9. planPoStatusSync: bereits gemappte ventoryPoId hat VORRANG vor po_number (id-primär)", () => {
  // CFP ist auf die echte PO (301542) gemappt; eine Korrektur-Dublette mit gleicher po_number
  // darf NICHT mehr greifen.
  const cfpPos = [{ id: "c6", poNo: "260006", archived: false, ventoryPoId: 301542 }];
  const voPos = [
    { id: 300359, po_number: "PO260006", order_name: "Korrektur", status: "Received", order_received_date: "2026-03-23", archived: true },
    { id: 301542, po_number: "PO260006", order_name: "PO260006 - Grossbestellung", status: "Ordered", order_placed_date: "2026-04-02" },
  ];
  const plan = planPoStatusSync(cfpPos, voPos);
  assert.equal(plan.all[0].ventoryPoId, 301542);
  assert.equal(plan.all[0].voStatus, "Ordered");
  assert.equal(plan.toArchive.length, 0);            // nicht über die Korrektur (Received) archivieren
});

// --- applyPoStatusSync ----------------------------------------------------

test("6. applyPoStatusSync: voll bezahlte Received-PO archived=true + arrivalDate + ventoryPoId; andere unverändert", () => {
  const state = {
    pos: [
      fullyPaidPo({ id: "c1", poNo: "260002", archived: false }),
      { id: "c9", poNo: "260009", archived: false, arrivalDate: "2026-07-01" },
    ],
  };
  const voPos = [
    { id: 301542, po_number: "PO260002", status: "Received", order_received_date: "2026-05-15" },
    { id: 301549, po_number: "PO260009", status: "Ordered", order_received_date: null },
  ];
  const plan = planPoStatusSync(state.pos, voPos);
  applyPoStatusSync(state, plan);

  const po2 = state.pos.find((p) => p.id === "c1");
  assert.equal(po2.archived, true);
  assert.equal(po2.arrivalDate, "2026-05-15");
  assert.equal(po2.ventoryPoId, 301542);

  // c9: Ordered -> nur MAP, archived/arrivalDate unangetastet.
  const po9 = state.pos.find((p) => p.id === "c9");
  assert.equal(po9.archived, false);
  assert.equal(po9.arrivalDate, "2026-07-01");
  assert.equal(po9.ventoryPoId, 301549);
});

test("7. applyPoStatusSync: RECEIVE_UNPAID setzt arrivalDate + ventoryPoId, aber NICHT archived", () => {
  const state = {
    pos: [{
      id: "c3",
      poNo: "260003",
      archived: false,
      milestones: [
        { id: "dep1", label: "Deposit", percent: 30 },
        { id: "bal1", label: "Balance", percent: 70 },
      ],
      paymentLog: { dep1: { status: "paid" } },
    }],
  };
  const voPos = [{ id: 123625, po_number: "PO260003", status: "Received", order_received_date: "2026-05-25" }];
  const plan = planPoStatusSync(state.pos, voPos);
  applyPoStatusSync(state, plan);

  const po3 = state.pos.find((p) => p.id === "c3");
  assert.equal(po3.archived, false);          // bleibt offen -> Cashflow-Schutz
  assert.equal(po3.arrivalDate, "2026-05-25"); // Empfang trotzdem eingetragen
  assert.equal(po3.ventoryPoId, 123625);
});
