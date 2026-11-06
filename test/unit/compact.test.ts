import { describe, expect, it } from "vitest";
import type { SchemaSnapshot } from "../../src/core/types.js";
import { renderCompact, renderOverview } from "../../src/format/compact.js";

describe("renderCompact", () => {
  const sampleSnapshot: SchemaSnapshot = {
    version: 1,
    dialect: "postgres",
    databaseName: "shop",
    generatedAt: "2026-11-05T12:00:00.000Z",
    hash: "a1b2c3d4e5f67890",
    schemas: ["public", "billing"],
    enums: [
      {
        schema: "public",
        name: "status",
        values: ["pending", "paid", "shipped", "cancelled"],
      },
    ],
    tables: [
      {
        schema: "public",
        name: "users",
        kind: "table",
        comment: "registered customers",
        estimatedRows: 12400,
        columns: [
          {
            name: "id",
            type: "uuid",
            nullable: false,
            default: "gen_random_uuid()",
          },
          { name: "email", type: "text", nullable: false },
          { name: "name", type: "text", nullable: true },
          {
            name: "created_at",
            type: "timestamptz",
            nullable: false,
            default: "now()",
          },
        ],
        primaryKey: ["id"],
        uniques: [["email"]],
        foreignKeys: [],
        indexes: [
          { name: "users_email_idx", columns: ["email"], unique: true },
          { name: "users_created_at_idx", columns: ["created_at"], unique: false },
        ],
        checks: [],
      },
      {
        schema: "public",
        name: "orders",
        kind: "table",
        estimatedRows: 98000,
        columns: [
          {
            name: "id",
            type: "bigint",
            nullable: false,
            isIdentity: true,
          },
          {
            name: "user_id",
            type: "uuid",
            nullable: false,
          },
          {
            name: "status",
            type: "status",
            nullable: false,
            default: "'pending'",
          },
          {
            name: "total",
            type: "numeric(10,2)",
            nullable: false,
          },
        ],
        primaryKey: ["id"],
        uniques: [],
        foreignKeys: [
          {
            name: "orders_user_id_fkey",
            columns: ["user_id"],
            refSchema: "public",
            refTable: "users",
            refColumns: ["id"],
            onDelete: "cascade",
          },
        ],
        indexes: [
          {
            name: "idx_user_status",
            columns: ["user_id", "status"],
            unique: false,
          },
          {
            name: "idx_orders_created",
            columns: ["created_at"],
            unique: false,
            where: "status<>'cancelled'",
          },
        ],
        checks: ["total >= 0"],
      },
      {
        schema: "billing",
        name: "invoices",
        kind: "table",
        columns: [
          { name: "id", type: "serial", nullable: false },
          { name: "order_id", type: "bigint", nullable: false },
        ],
        primaryKey: ["id"],
        uniques: [],
        foreignKeys: [
          {
            name: "invoices_order_fkey",
            columns: ["order_id"],
            refSchema: "public",
            refTable: "orders",
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
        estimatedRows: 310000,
        columns: [
          { name: "order_id", type: "bigint", nullable: false },
          { name: "product_id", type: "int", nullable: false },
        ],
        primaryKey: ["order_id", "product_id"],
        uniques: [],
        foreignKeys: [],
        indexes: [],
        checks: [],
      },
    ],
  };

  it("renders full grammar according to Section 7.1 specification", () => {
    const full = renderCompact(sampleSnapshot, "full");

    expect(full).toContain("# postgres shop | 4 tables | a1b2c3d4 | 2026-11-05T12:00:00.000Z");
    expect(full).toContain("[enum] status: pending|paid|shipped|cancelled");

    // users table check
    expect(full).toContain("table users  ~12400 rows  -- registered customers");
    expect(full).toContain("  id uuid pk default gen_random_uuid()");
    expect(full).toContain("  email text uniq");
    expect(full).toContain("  name text?");
    expect(full).toContain("  created_at timestamptz default now()");
    expect(full).toContain("  idx: (email) uniq; (created_at)");

    // orders table check
    expect(full).toContain("table orders  ~98000 rows");
    expect(full).toContain("  id bigint pk identity");
    expect(full).toContain("  user_id uuid fk->users.id on delete cascade");
    expect(full).toContain("  status status default 'pending'");
    expect(full).toContain("  total numeric(10,2)");
    expect(full).toContain("  idx: (user_id, status); (created_at) where status<>'cancelled'");
    expect(full).toContain("  check: total >= 0");

    // billing.invoices prefix check
    expect(full).toContain("table billing.invoices");
    expect(full).toContain("  order_id bigint fk->orders.id");

    // composite pk check
    expect(full).toContain("table order_items  ~310000 rows");
    expect(full).toContain("  pk: (order_id, product_id)");
  });

  it("renders overview according to Section 7.3 specification", () => {
    const overview = renderOverview(sampleSnapshot);

    expect(overview).toContain("# postgres shop | 4 tables");
    expect(overview).toContain("orders(4 cols, ~98k) -> users");
    expect(overview).toContain("users(4 cols, ~12.4k)");
    expect(overview).toContain("billing.invoices(2 cols) -> orders");
    expect(overview).toContain("order_items(2 cols, ~310k)");
  });

  it("renders detail for specific requested tables", () => {
    const detail = renderCompact(sampleSnapshot, "detail", {
      tables: ["users"],
    });

    expect(detail).toContain("table users  ~12400 rows");
    expect(detail).not.toContain("table orders");
  });
});
