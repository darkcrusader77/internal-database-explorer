-- Run one statement at a time using the extension's selection command.

-- Monthly revenue by region (view).
SELECT *
FROM analytics.monthly_sales
ORDER BY month, region;

-- Recent orders, with customer and calculated order totals.
SELECT order_id, ordered_at, customer_name, region, status, order_total
FROM analytics.order_summary
ORDER BY ordered_at DESC, order_id DESC
LIMIT 25;

-- Customers with the highest completed-order revenue.
SELECT name, email, order_count, lifetime_revenue
FROM analytics.customer_summary
ORDER BY lifetime_revenue DESC
LIMIT 10;

-- Nulls, booleans, and JSON result cells.
SELECT customer_id, name, email, active, preferences
FROM crm.customers
ORDER BY customer_id
LIMIT 20;

-- More than 1,000 rows: exercise result paging and the retained-row limit.
SELECT * FROM sales.orders ORDER BY order_id;

-- Start in two VS Code windows; cancel one and let the other finish.
SELECT pg_sleep(10), current_database();
