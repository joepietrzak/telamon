---
type: Metric
title: Gross revenue
description: Total charged before refunds, converted to the reporting currency.
tags:
- revenue
- finance
status: stable
generated:
  by: reference_agent/gemini-3.5-flash
  at: '2026-08-14T11:02:00+00:00'
verified:
- by: process:metric-linter
  at: '2026-08-14T11:30:00+00:00'
- by: human:dana
  at: '2026-08-15T09:00:00+00:00'
relationships:
- type: depends_on
  target: /tables/orders.md
  description: Sums gross_amount over confirmed orders.
- type: depends_on
  target: /tables/order_items.md
- type: documented_by
  target: /references/finance_handbook.md
sources:
- id: handbook
  title: Finance handbook, revenue recognition
  resource: https://example.com/handbook/revenue
  author: human:priya
  usage_count: 31
  last_modified: '2026-05-19'
---

Gross revenue is the sum of `gross_amount` over orders that are not refunded, converted to the reporting currency at the rate on `placed_at`.[^handbook]

It is deliberately **before** refunds. Net revenue is a separate metric and the two are not interchangeable in board reporting.

# Computation

```sql
SELECT
  DATE(placed_at) AS day,
  SUM(gross_amount) AS gross_revenue
FROM analytics.public.orders
WHERE status != 'refunded'
GROUP BY day;
```

[^handbook]: [Finance handbook, revenue recognition](https://example.com/handbook/revenue)
