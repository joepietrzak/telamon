---
type: Warehouse Table
title: Order items
description: One row per line item within an order.
resource: warehouse://analytics/public/order_items
tags:
- orders
- core
status: stable
relationships:
- type: joins_to
  target: /tables/orders.md
  description: Every line item belongs to exactly one order.
- type: joins_to
  target: /tables/products.md
- type: produced_by
  target: /pipelines/nightly_orders_load.md
---

Line-item grain. An order with three products produces three rows here and one row in [Orders](orders.md).

# Schema

| Field | Type | Mode | Description |
| :--- | :--- | :--- | :--- |
| **order_id** | STRING | REQUIRED | Joins to [Orders](orders.md). |
| **product_id** | STRING | REQUIRED | Joins to [Products](products.md). |
| **quantity** | INT64 | REQUIRED | Units of this product on the order. |
| **unit_price** | NUMERIC | REQUIRED | Price charged per unit, after discount. |
