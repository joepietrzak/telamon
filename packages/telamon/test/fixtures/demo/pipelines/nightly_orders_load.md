---
type: Pipeline
title: Nightly orders load
description: Rebuilds the order tables from the raw checkout event stream.
resource: airflow://analytics/dags/nightly_orders_load
tags:
- etl
- orders
status: stable
verified:
  by: process:pipeline-monitor
  at: '2026-08-20T02:41:00+00:00'
relationships:
- type: writes_to
  target: /tables/orders.md
- type: writes_to
  target: /tables/order_items.md
- type: documented_by
  target: /references/order_schema_rfc.md
---

Runs at 02:00 UTC. Truncates and rebuilds rather than merging, so a late-arriving event is picked up on the next run rather than needing a backfill.

Failure of this job is what makes [Orders](/tables/orders.md) stale; the freshness alert fires against the table, not the DAG.
