import { describe, expect, it } from "vitest";
import { TableNotFoundError } from "../../src/core/errors.js";
import { SchemaGraph, findJoinPath } from "../../src/core/graph.js";
import type { SchemaSnapshot } from "../../src/core/types.js";

describe("graph join-path finder", () => {
  const shopSnapshot: SchemaSnapshot = {
    version: 1,
    dialect: "postgres",
    databaseName: "shop",
    generatedAt: "2026-11-05T12:00:00.000Z",
    hash: "graphhash123",
    schemas: ["public", "billing"],
    enums: [],
    tables: [
      {
        schema: "public",
        name: "users",
        kind: "table",
        columns: [{ name: "id", type: "uuid", nullable: false }],
        primaryKey: ["id"],
        uniques: [],
        foreignKeys: [],
        indexes: [],
        checks: [],
      },
      {
        schema: "public",
        name: "categories",
        kind: "table",
        columns: [{ name: "id", type: "int", nullable: false }],
        primaryKey: ["id"],
        uniques: [],
        foreignKeys: [],
        indexes: [],
        checks: [],
      },
      {
        schema: "public",
        name: "products",
        kind: "table",
        columns: [
          { name: "id", type: "int", nullable: false },
          { name: "category_id", type: "int", nullable: false },
        ],
        primaryKey: ["id"],
        uniques: [],
        foreignKeys: [
          {
            name: "products_category_fk",
            columns: ["category_id"],
            refSchema: "public",
            refTable: "categories",
            refColumns: ["id"],
          },
        ],
        indexes: [],
        checks: [],
      },
      {
        schema: "public",
        name: "orders",
        kind: "table",
        columns: [
          { name: "id", type: "bigint", nullable: false },
          { name: "user_id", type: "uuid", nullable: false },
        ],
        primaryKey: ["id"],
        uniques: [],
        foreignKeys: [
          {
            name: "orders_user_fk",
            columns: ["user_id"],
            refSchema: "public",
            refTable: "users",
            refColumns: ["id"],
          },
        ],
        indexes: [],
        checks: [],
      },
      {
        schema: "public",
        name: "order_items",
        kind: "table",
        columns: [
          { name: "order_id", type: "bigint", nullable: false },
          { name: "product_id", type: "int", nullable: false },
        ],
        primaryKey: ["order_id", "product_id"],
        uniques: [],
        foreignKeys: [
          {
            name: "order_items_order_fk",
            columns: ["order_id"],
            refSchema: "public",
            refTable: "orders",
            refColumns: ["id"],
          },
          {
            name: "order_items_product_fk",
            columns: ["product_id"],
            refSchema: "public",
            refTable: "products",
            refColumns: ["id"],
          },
        ],
        indexes: [],
        checks: [],
      },
      {
        schema: "public",
        name: "isolated_audit",
        kind: "table",
        columns: [{ name: "id", type: "int", nullable: false }],
        primaryKey: ["id"],
        uniques: [],
        foreignKeys: [],
        indexes: [],
        checks: [],
      },
      {
        schema: "billing",
        name: "invoices",
        kind: "table",
        columns: [
          { name: "id", type: "int", nullable: false },
          { name: "order_id", type: "bigint", nullable: false },
        ],
        primaryKey: ["id"],
        uniques: [],
        foreignKeys: [
          {
            name: "invoices_order_fk",
            columns: ["order_id"],
            refSchema: "public",
            refTable: "orders",
            refColumns: ["id"],
          },
        ],
        indexes: [],
        checks: [],
      },
    ],
  };

  it("finds direct single-hop join path (orders -> users)", () => {
    const result = findJoinPath(shopSnapshot, "orders", "users");
    expect(result.found).toBe(true);
    expect(result.hops).toBe(1);
    expect(result.formatted).toBe("orders -> users: orders.user_id = users.id");
  });

  it("finds reverse single-hop join path (users -> orders)", () => {
    const result = findJoinPath(shopSnapshot, "users", "orders");
    expect(result.found).toBe(true);
    expect(result.hops).toBe(1);
    expect(result.formatted).toBe("users -> orders: orders.user_id = users.id");
  });

  it("finds multi-hop join path (orders -> products)", () => {
    const result = findJoinPath(shopSnapshot, "orders", "products");
    expect(result.found).toBe(true);
    expect(result.hops).toBe(2);
    expect(result.steps[0]?.fromTable).toBe("orders");
    expect(result.steps[0]?.toTable).toBe("order_items");
    expect(result.steps[1]?.fromTable).toBe("order_items");
    expect(result.steps[1]?.toTable).toBe("products");
    expect(result.formatted).toContain("orders -> order_items: order_items.order_id = orders.id");
    expect(result.formatted).toContain(
      "order_items -> products: order_items.product_id = products.id",
    );
  });

  it("finds cross-schema multi-hop path (billing.invoices -> categories)", () => {
    const result = findJoinPath(shopSnapshot, "billing.invoices", "categories");
    expect(result.found).toBe(true);
    expect(result.hops).toBe(4);
    expect(result.steps[0]?.fromTable).toBe("billing.invoices");
    expect(result.steps[0]?.toTable).toBe("orders");
  });

  it("returns found false when tables are disconnected", () => {
    const result = findJoinPath(shopSnapshot, "users", "isolated_audit");
    expect(result.found).toBe(false);
    expect(result.formatted).toContain('No join path found between "users" and "isolated_audit"');
  });

  it("returns found false when path exceeds maxHops", () => {
    const result = findJoinPath(shopSnapshot, "billing.invoices", "categories", 2);
    expect(result.found).toBe(false);
  });

  it("throws TableNotFoundError with suggestions on unknown table", () => {
    expect(() => findJoinPath(shopSnapshot, "usr", "orders")).toThrow(TableNotFoundError);
    try {
      findJoinPath(shopSnapshot, "usr", "orders");
    } catch (err) {
      expect((err as TableNotFoundError).suggestions).toContain("users");
    }
  });

  it("returns direct incoming and outgoing neighbors", () => {
    const graph = new SchemaGraph(shopSnapshot);
    const neighbors = graph.getDirectNeighbors("orders");

    expect(neighbors.outgoing).toContain("users");
    expect(neighbors.incoming).toContain("order_items");
    expect(neighbors.incoming).toContain("billing.invoices");
  });
});
