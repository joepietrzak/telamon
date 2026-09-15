---
type: Table
title: orders
description: One row per order, confirmed or otherwise. The spine of the revenue metrics.
resource: bigquery://acme.warehouse.orders
---

Grain: one row per order. Roughly 4.8 million rows.

| column | type | notes |
| --- | --- | --- |
| `order_id` | STRING | Primary key. |
| `gross_amount` | NUMERIC | Reporting currency. |
| `status` | STRING | `confirmed`, `pending`, or `cancelled`. |
