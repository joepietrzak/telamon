---
type: Warehouse Table
title: Products
description: Catalogue of sellable products, including delisted ones.
resource: warehouse://analytics/public/products
tags:
- catalogue
status: stable
---

Includes delisted products, so historical orders still resolve to a product name. Filter on `is_listed` for anything forward-looking.

# Schema

| Field | Type | Mode | Description |
| :--- | :--- | :--- | :--- |
| **product_id** | STRING | REQUIRED | Surrogate key. |
| **name** | STRING | REQUIRED | Display name at time of export. |
| **category** | STRING | NULLABLE | Top-level merchandising category. |
| **is_listed** | BOOL | REQUIRED | Whether the product is currently sellable. |
