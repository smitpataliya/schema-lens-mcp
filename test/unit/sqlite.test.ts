import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteAdapter, extractSqliteFilePath } from "../../src/adapters/sqlite.js";
import { renderCompact } from "../../src/format/compact.js";

describe("SqliteAdapter integration", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-lens-sqlite-"));
    dbPath = path.join(tmpDir, "test.db");

    const db = new Database(dbPath);

    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT
      );

      CREATE TABLE products (
        id INTEGER PRIMARY KEY,
        sku TEXT NOT NULL,
        price REAL NOT NULL,
        CONSTRAINT uq_sku UNIQUE (sku)
      );

      CREATE TABLE orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        total REAL NOT NULL DEFAULT 0.0,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT chk_total CHECK (total >= 0)
      );

      CREATE TABLE order_items (
        order_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (order_id, product_id),
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
      );

      CREATE INDEX idx_orders_user ON orders (user_id);

      CREATE VIEW active_users_view AS
        SELECT id, email FROM users WHERE name IS NOT NULL;
    `);

    db.close();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("extracts SQLite file paths from various URL patterns", () => {
    expect(extractSqliteFilePath("sqlite:/tmp/test.db")).toBe("/tmp/test.db");
    expect(extractSqliteFilePath("sqlite:///var/data.sqlite3?mode=ro")).toBe("/var/data.sqlite3");
    expect(extractSqliteFilePath("./local.db")).toBe("./local.db");
  });

  it("introspects tables, columns, keys, and foreign keys correctly", async () => {
    const adapter = new SqliteAdapter(dbPath);
    await adapter.connect();

    try {
      const snapshot = await adapter.introspect({ includeViews: true });

      expect(snapshot.dialect).toBe("sqlite");
      expect(snapshot.tables.length).toBe(5);

      const users = snapshot.tables.find((t) => t.name === "users");
      expect(users).toBeDefined();
      expect(users?.primaryKey).toEqual(["id"]);
      expect(users?.uniques).toEqual([["email"]]);

      const orders = snapshot.tables.find((t) => t.name === "orders");
      expect(orders).toBeDefined();
      expect(orders?.foreignKeys.length).toBe(1);
      expect(orders?.foreignKeys[0]?.refTable).toBe("users");
      expect(orders?.foreignKeys[0]?.onDelete).toBe("cascade");
      expect(orders?.checks).toContain("total >= 0");

      const items = snapshot.tables.find((t) => t.name === "order_items");
      expect(items).toBeDefined();
      expect(items?.primaryKey).toEqual(["order_id", "product_id"]);
      expect(items?.foreignKeys.length).toBe(2);

      const compact = renderCompact(snapshot, "full");
      expect(compact).toContain("table users");
      expect(compact).toContain("table orders");
      expect(compact).toContain("  pk: (order_id, product_id)");
      expect(compact).toContain("table active_users_view (view)");
    } finally {
      await adapter.close();
    }
  });

  it("filters views when includeViews is false", async () => {
    const adapter = new SqliteAdapter(dbPath);
    await adapter.connect();

    try {
      const snapshot = await adapter.introspect({ includeViews: false });
      const view = snapshot.tables.find((t) => t.name === "active_users_view");
      expect(view).toBeUndefined();
      expect(snapshot.tables.length).toBe(4);
    } finally {
      await adapter.close();
    }
  });

  it("updates fingerprint when schema is modified", async () => {
    const adapter = new SqliteAdapter(dbPath);
    await adapter.connect();

    let fp1: string;
    try {
      fp1 = await adapter.fingerprint({ includeViews: true });
    } finally {
      await adapter.close();
    }

    // Mutate SQLite schema
    const db = new Database(dbPath);
    db.exec("CREATE TABLE new_audit_log (id INTEGER PRIMARY KEY);");
    db.close();

    const adapter2 = new SqliteAdapter(dbPath);
    await adapter2.connect();
    let fp2: string;
    try {
      fp2 = await adapter2.fingerprint({ includeViews: true });
    } finally {
      await adapter2.close();
    }

    expect(fp1).not.toBe(fp2);
  });
});
