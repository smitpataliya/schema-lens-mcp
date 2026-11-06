-- Fixture shop.sql for PostgreSQL
CREATE SCHEMA IF NOT EXISTS billing;

CREATE TYPE order_status AS ENUM ('pending', 'paid', 'shipped', 'cancelled');
CREATE TYPE payment_method AS ENUM ('credit_card', 'paypal', 'bank_transfer');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  name text,
  manager_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_unique UNIQUE (email)
);
COMMENT ON TABLE users IS 'registered customers';

CREATE TABLE categories (
  id serial PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  title text NOT NULL
);

CREATE TABLE products (
  id serial PRIMARY KEY,
  category_id int REFERENCES categories(id) ON DELETE RESTRICT,
  sku text NOT NULL UNIQUE,
  title text NOT NULL,
  price numeric(10,2) NOT NULL,
  stock int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT chk_price_positive CHECK (price >= 0)
);

CREATE TABLE orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status order_status NOT NULL DEFAULT 'pending',
  total numeric(10,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_orders_total CHECK (total >= 0)
);

CREATE TABLE order_items (
  order_id bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id int NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity int NOT NULL DEFAULT 1,
  unit_price numeric(10,2) NOT NULL,
  PRIMARY KEY (order_id, product_id)
);

CREATE TABLE addresses (
  id serial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  line1 text NOT NULL,
  city text NOT NULL,
  country text NOT NULL
);

CREATE TABLE coupons (
  code text PRIMARY KEY,
  discount_percent int NOT NULL,
  valid_until timestamptz
);

CREATE TABLE billing.invoices (
  id serial PRIMARY KEY,
  order_id bigint NOT NULL,
  amount numeric(10,2) NOT NULL,
  paid boolean NOT NULL DEFAULT false
);

CREATE INDEX idx_orders_user_status ON orders (user_id, status);
CREATE INDEX idx_orders_active ON orders (created_at) WHERE status <> 'cancelled';
CREATE INDEX idx_products_category ON products (category_id);

CREATE VIEW active_products_view AS
  SELECT id, sku, title, price FROM products WHERE is_active = true;

