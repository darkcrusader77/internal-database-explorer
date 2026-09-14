-- Synthetic fixtures for interactive testing. Applied only when explorer_sample is created.
BEGIN;
CREATE SCHEMA crm;
CREATE SCHEMA sales;
CREATE SCHEMA analytics;

CREATE TABLE crm.regions (
  region_id integer PRIMARY KEY,
  name text NOT NULL UNIQUE
);
INSERT INTO crm.regions VALUES (1,'Northeast'),(2,'Southeast'),(3,'Midwest'),(4,'West');

CREATE TABLE crm.customers (
  customer_id integer PRIMARY KEY,
  name text NOT NULL,
  email text UNIQUE,
  region_id integer NOT NULL REFERENCES crm.regions,
  created_at timestamp NOT NULL,
  active boolean NOT NULL DEFAULT true,
  preferences jsonb
);
INSERT INTO crm.customers
SELECT n, 'Sample Customer ' || lpad(n::text,3,'0'),
  CASE WHEN n % 10 = 0 THEN NULL ELSE 'customer' || n || '@example.test' END,
  1 + (n % 4), timestamp '2026-01-01 09:00:00' + n * interval '1 day',
  n % 9 <> 0, jsonb_build_object('newsletter',n % 2 = 0,'tier',CASE WHEN n % 5 = 0 THEN 'gold' ELSE 'standard' END)
FROM generate_series(1,200) n;
CREATE INDEX customers_region_idx ON crm.customers(region_id);
COMMENT ON TABLE crm.customers IS 'Synthetic customers. One row per customer; every tenth email is intentionally null.';
COMMENT ON COLUMN crm.customers.preferences IS 'Example JSON preferences for testing structured result values.';

CREATE TABLE sales.products (
  product_id integer PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,
  unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  description text
);
INSERT INTO sales.products
SELECT n, 'Sample Product ' || lpad(n::text,2,'0'),
  (ARRAY['Office','Electronics','Home','Outdoors'])[1 + n % 4],
  (5 + n * 3.75)::numeric(12,2),
  CASE WHEN n = 1 THEN E'Example with a comma, a "quote", and\na line break.' ELSE 'Synthetic product for testing.' END
FROM generate_series(1,30) n;

CREATE TABLE sales.orders (
  order_id integer PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES crm.customers,
  ordered_at timestamp NOT NULL,
  status text NOT NULL CHECK (status IN ('completed','pending','cancelled')),
  notes text
);
INSERT INTO sales.orders
SELECT n, 1 + (n - 1) % 200, timestamp '2026-06-01 08:00:00' + (n % 100) * interval '1 day' + (n % 12) * interval '1 hour',
  CASE WHEN n % 10 = 0 THEN 'cancelled' WHEN n % 5 = 0 THEN 'pending' ELSE 'completed' END,
  CASE WHEN n % 100 = 0 THEN 'Example note for order ' || n ELSE NULL END
FROM generate_series(1,1500) n;
CREATE INDEX orders_customer_date_idx ON sales.orders(customer_id, ordered_at);
COMMENT ON TABLE sales.orders IS 'Synthetic orders for June through September 2026. Join to order_items to calculate totals.';

CREATE TABLE sales.order_items (
  order_id integer NOT NULL REFERENCES sales.orders,
  line_number integer NOT NULL,
  product_id integer NOT NULL REFERENCES sales.products,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(12,2) NOT NULL,
  PRIMARY KEY (order_id,line_number)
);
INSERT INTO sales.order_items
SELECT o.order_id, line, p.product_id, 1 + (o.order_id + line) % 4, p.unit_price
FROM sales.orders o CROSS JOIN generate_series(1,3) line
JOIN sales.products p ON p.product_id = 1 + (o.order_id + line - 1) % 30;

CREATE TABLE sales.payments (
  payment_id integer PRIMARY KEY,
  order_id integer NOT NULL UNIQUE REFERENCES sales.orders,
  amount numeric(14,2) NOT NULL,
  paid_at timestamp NOT NULL,
  method text NOT NULL
);
INSERT INTO sales.payments
SELECT o.order_id, o.order_id, sum(i.quantity * i.unit_price), o.ordered_at + interval '1 day',
  CASE WHEN o.order_id % 2 = 0 THEN 'card' ELSE 'bank_transfer' END
FROM sales.orders o JOIN sales.order_items i USING (order_id)
WHERE o.status='completed'
GROUP BY o.order_id, o.ordered_at;

CREATE VIEW analytics.order_summary AS
SELECT o.order_id, o.ordered_at, o.status, c.customer_id, c.name AS customer_name,
  r.name AS region, sum(i.quantity * i.unit_price)::numeric(14,2) AS order_total
FROM sales.orders o JOIN crm.customers c USING (customer_id)
JOIN crm.regions r USING (region_id) JOIN sales.order_items i USING (order_id)
GROUP BY o.order_id, o.ordered_at, o.status, c.customer_id, c.name, r.name;

CREATE VIEW analytics.monthly_sales AS
SELECT date_trunc('month',ordered_at)::date AS month, region,
  count(*) AS completed_orders, sum(order_total)::numeric(16,2) AS revenue
FROM analytics.order_summary WHERE status='completed'
GROUP BY date_trunc('month',ordered_at)::date, region;

CREATE VIEW analytics.customer_summary AS
SELECT c.customer_id,c.name,c.email,count(o.order_id) AS order_count,
  coalesce(sum(o.order_total) FILTER (WHERE o.status='completed'),0)::numeric(16,2) AS lifetime_revenue
FROM crm.customers c LEFT JOIN analytics.order_summary o USING(customer_id)
GROUP BY c.customer_id,c.name,c.email;
COMMENT ON VIEW analytics.monthly_sales IS 'Revenue from completed orders only, grouped by calendar month and customer region.';

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA crm,sales,analytics TO explorer_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA crm,sales,analytics TO explorer_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA crm,sales,analytics GRANT SELECT ON TABLES TO explorer_reader;
COMMIT;
