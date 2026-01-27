# FO Suggestions (Factory Order) Architecture Notes

## Architecture Notes (short)
- Data inputs are monthly planned sales and monthly closing stock snapshots per SKU. We approximate inventory linearly within each month using the monthly BOM (EOM + planned sales). Inbound within the month is not modeled; this is a v1 assumption for deterministic planning and is documented in the calculation code as a deliberate simplification.
- A suggestion is computed on demand when the user selects a SKU. The calculation uses a daily model by integrating monthly daily rates across the ETA and coverage horizon.
- Recommendations are purely deterministic and use policy overrides per SKU; if data is missing, we fall back to conservative defaults and downgrade confidence.

## Database Schema Changes (Postgres SQL)
```sql
create table sku_policy_overrides (
  sku_id text primary key,
  safety_stock_days_total_de integer not null,
  minimum_stock_days_total_de integer,
  lead_time_days_total integer not null,
  moq_units integer not null,
  operational_coverage_days_override integer
);

create table sku_monthly_plan (
  sku_id text not null,
  month text not null, -- YYYY-MM
  planned_sales_units integer not null,
  primary key (sku_id, month)
);

create table sku_monthly_snapshot (
  sku_id text not null,
  month text not null, -- YYYY-MM
  closing_stock_units integer not null,
  primary key (sku_id, month)
);
```

## Example API Response (shape)
```json
{
  "sku": "SKU123",
  "etaDate": "2025-05-12",
  "suggestedUnits": 500,
  "confidence": "high",
  "rationale": {
    "dailyRateToday": 10,
    "dailyRateEta": 10,
    "safetyStockDays": 60,
    "leadTimeDays": 20,
    "operationalCoverageDays": 120,
    "targetCoverageTotalDays": 180,
    "projectedInventoryAtEta": 250,
    "demandUnits": 1200,
    "dohToday": 55,
    "dohEta": 25,
    "dohEndOfMonth": 20,
    "requiredUnits": 1200,
    "netNeeded": 950
  },
  "warnings": [],
  "orderNeededFlag": true
}
```
