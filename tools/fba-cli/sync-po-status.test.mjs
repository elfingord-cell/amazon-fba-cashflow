// Tests für die reine Sync-Logik (planPoStatusSync / applyPoStatusSync).
// Lauf: node --test tools/fba-cli/sync-po-status.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { planPoStatusSync, applyPoStatusSync } from "./sync-po-status.mjs";

test("1. VO Received + CFP archived=false -> ARCHIVE, ventoryPoId + voReceivedDate übernommen", () => {
  const cfpPos = [{ id: "c1", poNo: "260002", archived: false }];
  const voPos = [{ id: 301542, po_number: "PO260002", status: "Received", order_received_date: "2026-05-15" }];
  const plan = planPoStatusSync(cfpPos, voPos);
  assert.equal(plan.toArchive.length, 1);
  const e = plan.toArchive[0];
  assert.equal(e.action, "ARCHIVE");
  assert.equal(e.ventoryPoId, 301542);
  assert.equal(e.voReceivedDate, "2026-05-15");
  assert.equal(plan.toMapOnly.length, 0);
  assert.equal(plan.unmatched.length, 0);
});

test("2. VO Ordered + CFP archived=false -> kein ARCHIVE, aber MAP (ventoryPoId)", () => {
  const cfpPos = [{ id: "c5", poNo: "260005", archived: false }];
  const voPos = [{ id: 301545, po_number: "PO260005", status: "Ordered", order_received_date: null }];
  const plan = planPoStatusSync(cfpPos, voPos);
  assert.equal(plan.toArchive.length, 0);
  assert.equal(plan.toMapOnly.length, 1);
  assert.equal(plan.toMapOnly[0].action, "MAP");
  assert.equal(plan.toMapOnly[0].ventoryPoId, 301545);
});

test("3. VO Received + CFP bereits archived=true (+ ID gemappt) -> NOOP", () => {
  const cfpPos = [{ id: "c2", poNo: "260002", archived: true, ventoryPoId: 301542 }];
  const voPos = [{ id: 301542, po_number: "PO260002", status: "Received", order_received_date: "2026-05-15" }];
  const plan = planPoStatusSync(cfpPos, voPos);
  assert.equal(plan.toArchive.length, 0);
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
  assert.equal(plan.toMapOnly.length, 0);
});

test("6. applyPoStatusSync: richtige PO archived=true + arrivalDate + ventoryPoId; andere unverändert", () => {
  const state = {
    pos: [
      { id: "c1", poNo: "260002", archived: false },
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
