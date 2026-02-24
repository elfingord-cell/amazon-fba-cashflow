# PO Payments Ledger Contract

## Scope
- Source: PO platform monthly export `po-payments_YYYY-MM.csv`
- Target: matching platform monthly import (`month_id = YYYY-MM`)
- One row is exactly one paid PO event (deposit/balance/full/other)

## File and Encoding
- File name: `po-payments_YYYY-MM.csv`
- Encoding: UTF-8
- Delimiter: `,`
- Numeric format: decimal point (`.`), no thousands separators

## Required Header Order
`po_number,payment_stage,supplier_name,payment_date,payment_channel,invoice_currency,invoice_amount,paid_currency,paid_amount,reference_hint,invoice_id_or_number,units_total,sku_list,notes`

## Field Rules
- `po_number`: non-empty string
- `payment_stage`: `DEPOSIT|BALANCE|FULL|OTHER`
- `supplier_name`: normalized supplier label from PO master data
- `payment_date`: ISO date `YYYY-MM-DD`
- `payment_channel`: `WISE|ALIBABA_TA|PAYPAL|SEPA|OTHER`
- `invoice_currency`: 3-letter ISO code (usually `USD` or `EUR`)
- `invoice_amount`: positive number
- `paid_currency`: 3-letter ISO code (usually `EUR`)
- `paid_amount`: positive number, includes fees as captured in PO payment booking
- `reference_hint`: must include at least `PO {po_number} {payment_stage}`; may include payment id, transfer reference, invoice number
- `invoice_id_or_number`: optional string
- `units_total`: optional non-negative integer
- `sku_list`: optional compact list (`SKU1:100|SKU2:50`)
- `notes`: optional string

## Import Validation
- Reject import if header names/order mismatch.
- Reject rows with invalid enum values.
- Reject rows with invalid date format.
- Reject rows where `paid_amount <= 0`.
- Normalize whitespace in string fields.

## Idempotency and Delta Behavior
- Dedupe key: `(month_id, po_number, payment_stage, payment_date, paid_amount, payment_channel)`
- Mode: **upsert by key**
  - Key not found: insert
  - Key found: update mutable columns (`supplier_name`, `invoice_*`, `reference_hint`, `units_total`, `sku_list`, `notes`)
- No duplicate keys after import.

## Matching Rules

### A) Bank Payment -> Ledger Entry (high confidence)
- Candidate pool:
  - Bank rail in `{WISE, ALIBABA_TA, PAYPAL}` OR counterparty text contains Wise/Alibaba/PayPal.
- Matching constraints:
  - Amount tolerance: `abs(bank_amount_eur - ledger.paid_amount) <= max(2 EUR, 0.5% of ledger.paid_amount)`
  - Date window: bank booking date within `±7 days` of `ledger.payment_date`
  - Rail/channel equality when rail is available
- Result:
  - Exactly one candidate: create `SupplierPaymentMatch` with high confidence
  - Multiple candidates: create `REVIEW` match set with ranked candidates

### B) Ledger Entry -> Invoice (medium/high confidence)
- Evidence signals:
  - PO number in invoice filename or OCR text
  - supplier name similarity
  - stage consistency (`DEPOSIT`/`BALANCE`/`FULL`/`OTHER`)
  - amount and currency consistency using `invoice_currency` + `invoice_amount`
- Result:
  - One confident invoice: link and mark as `CONFIRMED` or `SUGGESTED_HIGH`
  - No invoice: mark as missing document task

## Missing Document Definition
- A ledger entry is considered missing document when:
  - no `invoice_id` link exists after matching, and
  - no manual override marks document as received.
- User-facing task label:
  - `fehlender Beleg für PO {po_number} Stage {payment_stage}`

## Downstream Exports Required in Matching App
- Monthly match export rows include:
  - `payment_id`, `invoice_id`, `ledger_entry_id`, `po_number`, `payment_stage`, `supplier_name`
- Missing document export includes:
  - all ledger entries with no linked `invoice_id`

## Operational Notes
- Monthly import can be repeated safely (idempotent upsert).
- Keep original source filename and import timestamp for auditability.
- Recommended importer metadata fields:
  - `source_file_name`
  - `imported_at`
  - `month_id`
