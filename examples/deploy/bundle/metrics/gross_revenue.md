---
type: Metric
title: Gross revenue
description: Total charged before refunds, converted to the reporting currency.
tags:
  - revenue
  - finance
status: stable
generated:
  by: process:warehouse-sync
  at: '2026-09-01T04:00:00+00:00'
verified:
  - by: human:dana
    at: '2026-09-02T09:00:00+00:00'
relationships:
  - type: depends_on
    target: /tables/orders.md
    description: Sums gross_amount over confirmed orders.
---

Sums `gross_amount` over confirmed rows in [orders](../tables/orders.md).

```sql
select sum(gross_amount) as gross_revenue
from acme.warehouse.orders
where status = 'confirmed'
```

Refunds are deliberately excluded. Use net revenue for the figure after them.
