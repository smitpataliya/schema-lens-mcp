import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveSnapshotFiles } from "../../src/core/cache.js";
import type { ResolvedConfig } from "../../src/core/config.js";
import type { SchemaSnapshot } from "../../src/core/types.js";
import {
  capResponse,
  handleFindJoinPath,
  handleSchemaChanges,
  handleSchemaOverview,
  handleTableDetails,
} from "../../src/mcp/tools.js";

describe("MCP tool handlers", () => {
  let tmpDir: string;
  let config: ResolvedConfig;

  const mockSnapshot: SchemaSnapshot = {
    version: 1,
    dialect: "postgres",
    databaseName: "shop",
    generatedAt: "2026-11-05T12:00:00.000Z",
    hash: "test_hash_123456",
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
    ],
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-lens-mcp-tools-"));
    config = {
      connectionUrl: "",
      dialect: "postgres",
      schemas: ["public"],
      exclude: [],
      includeViews: true,
      ttlSeconds: 300,
      outDir: tmpDir,
      terse: false,
    };
    saveSnapshotFiles(tmpDir, mockSnapshot, "postgres://localhost/shop");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("handles schema_overview with hash and age", async () => {
    const res = await handleSchemaOverview({}, config);
    expect(res.isError).toBe(false);
    expect(res.content).toContain("# postgres shop | 2 tables");
    expect(res.content).toContain("hash: test_has");
    expect(res.content).toContain("orders(2 cols) -> users");
    expect(res.content).toContain("users(2 cols)");
  });

  it("handles table_details with direct neighbors", async () => {
    const res = await handleTableDetails({ tables: ["users"] }, config);
    expect(res.isError).toBe(false);
    expect(res.content).toContain("table users");
    expect(res.content).toContain("referenced by: orders");
  });

  it("returns fuzzy suggestions for unknown table in table_details", async () => {
    const res = await handleTableDetails({ tables: ["usr"] }, config);
    expect(res.isError).toBe(true);
    expect(res.content).toContain('Table "usr" not found. Did you mean: users?');
  });

  it("handles find_join_path correctly", async () => {
    const res = await handleFindJoinPath({ from: "orders", to: "users" }, config);
    expect(res.isError).toBe(false);
    expect(res.content).toBe("orders -> users: orders.user_id = users.id");
  });

  it("handles schema_changes when no previous snapshot exists", async () => {
    const res = await handleSchemaChanges({}, config);
    expect(res.isError).toBe(false);
    expect(res.content).toContain("No previous snapshot to compare against");
  });

  it("caps response when output exceeds limit", () => {
    const longString = "A".repeat(8500);
    const capped = capResponse(longString, "Narrow your request.");
    expect(capped.length).toBeLessThan(8600);
    expect(capped).toContain("[TRUNCATED: Output exceeded 8000 characters. Narrow your request.]");
  });
});
