---
type: Metric
title: Repeat purchase rate
description: Share of customers with more than one confirmed order in the window.
tags:
- retention
status: draft
stale_after: '2026-06-01T00:00:00Z'
generated:
  by: reference_agent/gemini-3.5-flash
  at: '2026-08-14T11:02:00+00:00'
relationships:
- type: depends_on
  target: /tables/orders.md
- type: depends_on
  target: /tables/customers.md
- type: documented_by
  target: /references/analytics_style_guide.md
- type: contradicts
  target: /references/finance_handbook.md
  description: The handbook counts refunded orders; this metric does not.
---

The share of customers placing more than one confirmed order within the window. Still a draft: the treatment of guest checkout is unresolved, and the finance handbook's definition disagrees on refunds.

# Computation

```sql
WITH per_customer AS (
  SELECT customer_id, COUNT(DISTINCT order_id) AS orders
  FROM analytics.public.orders
  WHERE status != 'refunded'
    AND placed_at BETWEEN @from AND @to
  GROUP BY customer_id
)
SELECT
  COUNTIF(orders > 1) / COUNT(*) AS repeat_purchase_rate
FROM per_customer;
```
