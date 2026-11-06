import { describe, expect, it } from "vitest";
import { diffSnapshots, formatDiff } from "../../src/core/diff.js";
import type { SchemaSnapshot } from "../../src/core/types.js";

describe("diff", () => {
  const baseSnapshot: SchemaSnapshot = {
    version: 1,
    dialect: "postgres",
    databaseName: "shop",
    generatedAt: "2026-11-05T12:00:00.000Z",
    hash: "hash_v1",
    schemas: ["public"],
    enums: [
      {
        schema: "public",
        name: "status",
        values: ["pending", "paid"],
      },
    ],
    tables: [
      {
        schema: "public",
        name: "users",
        kind: "table",
        columns: [
          { name: "id", type: "uuid", nullable: false },
          { name: "email", type: "text", nullable: false },
        ],
        primaryKey: ["id"],
        uniques: [],
        foreignKeys: [],
        indexes: [],
        checks: [],
      },
      {
        schema: "public",
        name: "orders",
        kind: "table",
        columns: [
          { name: "id", type: "bigint", nullable: false },
          { name: "amount", type: "numeric(8,2)", nullable: false },
        ],
        primaryKey: ["id"],
        uniques: [],
        foreignKeys: [],
        indexes: [{ name: "idx_orders_amount", columns: ["amount"], unique: false }],
        checks: ["amount > 0"],
      },
    ],
  };

  it("returns 'no changes' when hashes are identical", () => {
    const diff = diffSnapshots(baseSnapshot, { ...baseSnapshot });
    expect(diff.hasChanges).toBe(false);
    expect(formatDiff(diff)).toBe("no changes");
  });

  it("detects added, removed, and modified tables and columns", () => {
    const updatedSnapshot: SchemaSnapshot = {
      version: 1,
      dialect: "postgres",
      databaseName: "shop",
      generatedAt: "2026-11-05T13:00:00.000Z",
      hash: "hash_v2",
      schemas: ["public"],
      enums: [
        {
          schema: "public",
          name: "status",
          values: ["pending", "paid", "shipped"],
        },
      ],
      tables: [
        // users modified: added name, removed email
        {
          schema: "public",
          name: "users",
          kind: "table",
          columns: [
            { name: "id", type: "uuid", nullable: false },
            { name: "name", type: "text", nullable: true },
          ],
          primaryKey: ["id"],
          uniques: [],
          foreignKeys: [],
          indexes: [],
          checks: [],
        },
        // orders modified: changed amount type, added foreign key
        {
          schema: "public",
          name: "orders",
          kind: "table",
          columns: [
            { name: "id", type: "bigint", nullable: false },
            { name: "amount", type: "numeric(10,2)", nullable: true },
            { name: "user_id", type: "uuid", nullable: false },
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
            },
          ],
          indexes: [],
          checks: ["amount >= 0"],
        },
        // new table categories added
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
      ],
    };

    const diff = diffSnapshots(baseSnapshot, updatedSnapshot);
    expect(diff.hasChanges).toBe(true);

    const formatted = formatDiff(diff);
    expect(formatted).toContain("~ enum status");
    expect(formatted).toContain("+ table categories (1 cols)");
    expect(formatted).toContain("~ table users");
    expect(formatted).toContain("  + col name text?");
    expect(formatted).toContain("  - col email");
    expect(formatted).toContain("~ table orders");
    expect(formatted).toContain(
      "  ~ col amount: type: numeric(8,2) -> numeric(10,2), nullable: false -> true",
    );
    expect(formatted).toContain("  + fk (user_id) -> users(id)");
    expect(formatted).toContain("  - idx idx_orders_amount");
  });

  it("handles null previous snapshot as initial addition", () => {
    const diff = diffSnapshots(null, baseSnapshot);
    expect(diff.hasChanges).toBe(true);
    const formatted = formatDiff(diff);
    expect(formatted).toContain("+ table users (2 cols)");
    expect(formatted).toContain("+ table orders (2 cols)");
  });
});
