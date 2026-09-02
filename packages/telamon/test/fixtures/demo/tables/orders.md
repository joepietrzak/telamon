---
type: Warehouse Table
title: Orders
description: One row per confirmed order, from checkout through fulfilment.
resource: warehouse://analytics/public/orders
tags:
- orders
- core
status: stable
generated:
  by: reference_agent/gemini-3.5-flash
  at: '2026-07-02T09:14:00+00:00'
verified:
  by: human:dana
  at: '2026-08-01T00:00:00+00:00'
relationships:
- type: produced_by
  target: /pipelines/nightly_orders_load.md
  description: Rebuilt nightly from the checkout event stream.
- type: documented_by
  target: /references/order_schema_rfc.md
sources:
- id: schema_rfc
  title: RFC 114, Order schema
  resource: https://example.com/rfc/114
  author: human:dana
  last_modified: '2026-06-28'
---

The grain is one row per confirmed order. Cancelled carts never reach this table; they stay in the raw event stream.[^schema_rfc]

# Schema

| Field | Type | Mode | Description |
| :--- | :--- | :--- | :--- |
| **order_id** | STRING | REQUIRED | Surrogate key, unique across all channels. |
| **customer_id** | STRING | REQUIRED | Joins to [Customers](customers.md). |
| **placed_at** | TIMESTAMP | REQUIRED | Checkout confirmation time, UTC. |
| **status** | STRING | REQUIRED | One of `confirmed`, `shipped`, `delivered`, `refunded`. |
| **currency** | STRING | REQUIRED | ISO 4217 code. |
| **gross_amount** | NUMERIC | REQUIRED | Order total before refunds, in `currency`. |
| **channel** | STRING | NULLABLE | `web`, `ios`, `android`, or `phone`. |

# Common query patterns

```sql
-- Orders placed in the last 28 days, excluding refunds.
SELECT
  order_id,
  customer_id,
  gross_amount
FROM analytics.public.orders
WHERE placed_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 28 DAY)
  AND status != 'refunded';
```

[^schema_rfc]: [RFC 114, Order schema](https://example.com/rfc/114)
