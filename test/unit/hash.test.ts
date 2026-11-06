import { describe, expect, it } from "vitest";
import type { SchemaSnapshot } from "../../src/core/types.js";
import { computeSnapshotHash } from "../../src/util/hash.js";

describe("computeSnapshotHash", () => {
  const baseSnapshot: SchemaSnapshot = {
    version: 1,
    dialect: "postgres",
    databaseName: "shop",
    generatedAt: "2026-11-05T12:00:00.000Z",
    hash: "initial-dummy-hash",
    schemas: ["public"],
    enums: [
      {
        schema: "public",
        name: "order_status",
        values: ["pending", "shipped", "delivered"],
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
        uniques: [["email"]],
        foreignKeys: [],
        indexes: [{ name: "users_email_idx", columns: ["email"], unique: true }],
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
            name: "orders_user_id_fkey",
            columns: ["user_id"],
            refSchema: "public",
            refTable: "users",
            refColumns: ["id"],
          },
        ],
        indexes: [],
        checks: [],
      },
    ],
  };

  it("produces deterministic hash regardless of generatedAt or hash field", () => {
    const snap1 = { ...baseSnapshot, generatedAt: "2026-01-01T00:00:00.000Z", hash: "abc" };
    const snap2 = { ...baseSnapshot, generatedAt: "2026-12-31T23:59:59.000Z", hash: "xyz" };

    const hash1 = computeSnapshotHash(snap1);
    const hash2 = computeSnapshotHash(snap2);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces identical hash when tables array order changes", () => {
    const snapReordered: SchemaSnapshot = {
      ...baseSnapshot,
      tables: [baseSnapshot.tables[1], baseSnapshot.tables[0]],
    };

    const hashOriginal = computeSnapshotHash(baseSnapshot);
    const hashReordered = computeSnapshotHash(snapReordered);

    expect(hashOriginal).toBe(hashReordered);
  });

  it("produces identical hash when only estimatedRows changes", () => {
    const snapRows1: SchemaSnapshot = {
      ...baseSnapshot,
      tables: [
        { ...baseSnapshot.tables[0], estimatedRows: 100 },
        { ...baseSnapshot.tables[1], estimatedRows: 5000 },
      ],
    };
    const snapRows2: SchemaSnapshot = {
      ...baseSnapshot,
      tables: [
        { ...baseSnapshot.tables[0], estimatedRows: 99999 },
        { ...baseSnapshot.tables[1], estimatedRows: 0 },
      ],
    };

    expect(computeSnapshotHash(snapRows1)).toBe(computeSnapshotHash(snapRows2));
  });

  it("produces different hash when schema changes", () => {
    const modified: SchemaSnapshot = {
      ...baseSnapshot,
      tables: [
        baseSnapshot.tables[0],
        {
          ...baseSnapshot.tables[1],
          columns: [
            ...baseSnapshot.tables[1].columns,
            { name: "total", type: "numeric(10,2)", nullable: false },
          ],
        },
      ],
    };

    const hash1 = computeSnapshotHash(baseSnapshot);
    const hash2 = computeSnapshotHash(modified);

    expect(hash1).not.toBe(hash2);
  });
});
