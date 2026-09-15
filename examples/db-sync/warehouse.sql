-- A small storefront-analytics warehouse: the same domain as the demo bundle
-- in packages/telamon/test/fixtures/demo, but as tables rather than markdown.
--
-- The point of the fixture is that nothing here was written for telamon. These
-- are the columns a data team already keeps -- a definition, an owner, a
-- lifecycle flag, a review date -- and okf.db.json is what makes them a bundle.

create table metric_definitions (
  metric_name   text primary key,
  display_name  text not null,
  summary       text,
  definition_md text not null,
  tags          text,           -- JSON array; SQLite has no array type
  lifecycle     text,           -- draft | stable | deprecated
  review_by     text,           -- ISO-8601
  owner         text,
  is_published  integer not null default 1
);

create table warehouse_tables (
  table_name    text primary key,
  fqn           text not null,
  notes         text,
  grain         text,
  row_estimate  integer
);

create table pipelines (
  pipeline_name text primary key,
  display_name  text not null,
  summary       text,
  schedule      text,
  definition_md text not null
);

insert into metric_definitions values
  ('gross_revenue', 'Gross revenue',
   'Total charged before refunds, converted to the reporting currency.',
   'Sums `gross_amount` over confirmed orders in [orders](../tables/orders.md).' || char(10) || char(10) ||
   'Refunds are deliberately excluded; see [net revenue](net_revenue.md) for the figure after them.',
   '["revenue","finance"]', 'stable', '2027-01-01T00:00:00Z', 'human:dana', 1),

  ('net_revenue', 'Net revenue',
   'Gross revenue less refunds and chargebacks.',
   'Takes [gross revenue](gross_revenue.md) and subtracts refunds recorded against [orders](../tables/orders.md).',
   '["revenue","finance"]', 'stable', '2027-01-01T00:00:00Z', 'human:dana', 1),

  ('average_order_value', 'Average order value',
   'Gross revenue divided by confirmed order count.',
   'Divides [gross revenue](gross_revenue.md) by the count of confirmed rows in [orders](../tables/orders.md).',
   '["revenue"]', 'stable', null, 'human:dana', 1),

  ('repeat_purchase_rate', 'Repeat purchase rate',
   'Share of customers with more than one confirmed order.',
   'Customers in [customers](../tables/customers.md) with `order_count > 1`, over all customers.',
   '["retention"]', 'draft', '2026-01-01T00:00:00Z', 'human:sam', 1),

  ('margin_per_order', 'Margin per order',
   'Superseded by contribution margin; do not use.',
   'Left in place so existing dashboards resolve. Use contribution margin instead.',
   '["finance"]', 'deprecated', null, 'human:dana', 1),

  ('internal_scratch_metric', 'Internal scratch metric',
   'Unpublished working definition.',
   'Should not reach the bundle: `is_published` is 0.',
   '[]', 'draft', null, null, 0);

insert into warehouse_tables values
  ('orders', 'bigquery://acme.warehouse.orders',
   'One row per order, confirmed or otherwise. The spine of the revenue metrics.',
   'order', 4820000),
  ('order_items', 'bigquery://acme.warehouse.order_items',
   'One row per line item on an order.', 'order_item', 11300000),
  ('customers', 'bigquery://acme.warehouse.customers',
   'One row per customer, with lifetime aggregates maintained by the nightly load.',
   'customer', 612000),
  ('products', 'bigquery://acme.warehouse.products',
   'Current product catalogue. Not history: a price change overwrites in place.',
   'product', 18400);

insert into pipelines values
  ('nightly_orders_load', 'Nightly orders load',
   'Rebuilds the order tables from the storefront replica.',
   '0 4 * * *',
   'Writes [orders](../tables/orders.md) and [order_items](../tables/order_items.md) every night.');
