import test from "node:test";
import assert from "node:assert/strict";
import { validatePaymentModalState } from "./paymentValidation.js";

test("validatePaymentModalState flags zero actuals when planned exists", () => {
  const result = validatePaymentModalState({
    selectedEvents: [{ id: "evt-1", plannedEur: 100 }],
    actualRaw: "0,00",
    invoiceUrl: "",
    folderUrl: "",
    paymentRecord: null,
    paymentIdValue: "",
    mergedPayments: [],
  });

  assert.equal(result.valid, false);
  assert.equal(result.fieldErrors.actual, "Ist-Betrag darf nicht 0 sein, wenn ein Soll-Betrag vorhanden ist.");
});
