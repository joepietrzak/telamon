---
type: Warehouse Table
title: Customers
description: One row per customer account, current state only.
resource: warehouse://analytics/public/customers
tags:
- customers
- core
status: stable
relationships:
- type: documented_by
  target: /references/analytics_style_guide.md
---

Current state, not history: an address change overwrites the previous value. Point-in-time questions need the event stream instead.

# Schema

| Field | Type | Mode | Description |
| :--- | :--- | :--- | :--- |
| **customer_id** | STRING | REQUIRED | Surrogate key. |
| **created_at** | TIMESTAMP | REQUIRED | Account creation time, UTC. |
| **country** | STRING | NULLABLE | ISO 3166-1 alpha-2. |
| **marketing_opt_in** | BOOL | REQUIRED | Current consent state. |
