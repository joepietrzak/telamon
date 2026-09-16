-- A metrics warehouse, in the shape a data team would already have it.
--
-- Nothing here was written for telamon. These are the columns a team keeps
-- anyway -- a definition, an owner, a lifecycle, when the row last changed --
-- and okf.db.json is what makes them a bundle.
--
-- What is specific to Postgres, and worth seeing:
--   * a schema, so tables are named `analytics.metric_definitions`
--   * `text[]`, which comes back as a real JavaScript array
--   * `jsonb`, which comes back as a real object
--   * `timestamptz`, which comes back as a `Date`
--   * a view, for the one thing a mapping file cannot express: a join

create schema if not exists analytics;

create table analytics.metric_definitions (
  metric_name    text primary key,
  display_name   text        not null,
  summary        text,
  definition_md  text        not null,
  tags           text[]      not null default '{}',
  lifecycle      text        not null default 'draft',
  review_by      timestamptz,
  owner          text,
  provenance     jsonb,
  is_published   boolean     not null default true,
  updated_at     timestamptz not null default now()
);

create table analytics.warehouse_tables (
  table_name   text primary key,
  fqn          text not null,
  notes        text,
  grain        text,
  row_estimate bigint,
  updated_at   timestamptz not null default now()
);

-- Which metrics read which tables. A join table, because that is how a team
-- would model it -- not because telamon wants one.
create table analytics.metric_inputs (
  metric_name text not null references analytics.metric_definitions(metric_name),
  table_name  text not null references analytics.warehouse_tables(table_name),
  primary key (metric_name, table_name)
);

-- The one concession to the renderer, and the concession a real deployment
-- makes too: a view that does the join, so the mapping file does not have to.
--
-- `relationships` targets name the file the mapping will write. telamon
-- slugifies a relationship target the same way it slugifies a path, so this
-- can use the natural key and the two agree without the view guessing the rule.
create view analytics.okf_metrics as
select
  m.metric_name,
  m.display_name,
  m.summary,
  m.definition_md,
  m.tags,
  m.lifecycle,
  m.review_by,
  m.owner,
  m.provenance,
  m.is_published,
  -- Two things going on here.
  --
  -- `greatest` because the view's change stamp has to move when anything it
  -- reads moves, or an incremental read misses an edit to the join.
  --
  -- `date_trunc` to milliseconds because that is the precision the cursor can
  -- hold. `timestamptz` keeps microseconds; a JavaScript `Date` does not, so a
  -- watermark read back through a driver that returns Dates is the truncated
  -- value -- and `updated_at > '...05.044Z'` is still true of `...05.044901`.
  -- Every tick would re-read the rows sitting on the boundary. Harmless, since
  -- telamon reparses only documents whose text actually differs, but it is a
  -- query per tick for nothing, and truncating here costs one function call.
  date_trunc('milliseconds', greatest(
    m.updated_at,
    coalesce((select max(t.updated_at)
                from analytics.metric_inputs i
                join analytics.warehouse_tables t on t.table_name = i.table_name
               where i.metric_name = m.metric_name), m.updated_at)
  )) as updated_at,
  (select coalesce(
            jsonb_agg(jsonb_build_object(
              'type', 'reads',
              'target', '../tables/' || i.table_name || '.md')
              order by i.table_name),
            '[]'::jsonb)
     from analytics.metric_inputs i
    where i.metric_name = m.metric_name) as relationships
from analytics.metric_definitions m;

-- The same truncation for the tables, which the mapping reads directly.
create view analytics.okf_tables as
select
  table_name, fqn, notes, grain, row_estimate,
  date_trunc('milliseconds', updated_at) as updated_at
from analytics.warehouse_tables;

insert into analytics.warehouse_tables (table_name, fqn, notes, grain, row_estimate) values
  ('orders',    'analytics.orders',    'One row per confirmed order.', 'order',         4200000),
  ('customers', 'analytics.customers', 'Deduplicated customer records.', 'customer',     310000),
  ('refunds',   'analytics.refunds',   'Refunds, joined back to orders.', 'refund',        90000);

insert into analytics.metric_definitions
  (metric_name, display_name, summary, definition_md, tags, lifecycle, review_by, owner, provenance, is_published) values
  ('gross_revenue', 'Gross revenue',
   'Total charged before refunds, in the reporting currency.',
   E'Sums `gross_amount` over confirmed orders.\n\nRefunds are deliberately excluded; see [net revenue](net_revenue.md).',
   '{revenue,finance}', 'stable', '2027-01-01T00:00:00Z', 'human:dana',
   '{"by": "process:warehouse-sync", "dbt_model": "fct_orders"}', true),

  ('net_revenue', 'Net revenue',
   'Gross revenue less refunds and chargebacks.',
   E'Takes [gross revenue](gross_revenue.md) and subtracts refunds.',
   '{revenue,finance}', 'stable', '2027-01-01T00:00:00Z', 'human:dana',
   '{"by": "process:warehouse-sync", "dbt_model": "fct_revenue"}', true),

  ('repeat_purchase_rate', 'Repeat purchase rate',
   'Share of customers with more than one confirmed order.',
   E'Customers with `order_count > 1`, over all customers.',
   '{retention}', 'draft', '2026-01-01T00:00:00Z', 'human:sam',
   '{"by": "human:sam"}', true),

  ('internal_scratch', 'Internal scratch metric',
   'Not for publication.',
   E'Kept in the warehouse, kept out of the bundle.',
   '{}', 'draft', null, 'human:sam', null, false);

insert into analytics.metric_inputs values
  ('gross_revenue', 'orders'),
  ('net_revenue', 'orders'),
  ('net_revenue', 'refunds'),
  ('repeat_purchase_rate', 'customers'),
  ('repeat_purchase_rate', 'orders');
