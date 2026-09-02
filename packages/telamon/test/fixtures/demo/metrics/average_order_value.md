---
type: Metric
title: Average order value
description: Gross revenue divided by the count of confirmed orders.
tags:
- revenue
status: stable
relationships:
- type: derived_from
  target: /metrics/gross_revenue.md
  description: Numerator is gross revenue over the same window.
- type: depends_on
  target: /tables/orders.md
- type: documented_by
  target: /references/finance_handbook.md
---

AOV is [gross revenue](gross_revenue.md) over the count of confirmed orders in the same window. Because the numerator excludes refunds and the denominator does not, the two must share a window or the figure drifts.

# Computation

```sql
SELECT
  SUM(gross_amount) / COUNT(DISTINCT order_id) AS average_order_value
FROM analytics.public.orders
WHERE status != 'refunded'
  AND placed_at BETWEEN @from AND @to;
```
