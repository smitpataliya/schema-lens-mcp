import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveSnapshotFiles } from "../../src/core/cache.js";
import type { ResolvedConfig } from "../../src/core/config.js";
import type { SchemaSnapshot } from "../../src/core/types.js";
import { createMcpServer } from "../../src/mcp/server.js";

describe("MCP server end-to-end", () => {
  let tmpDir: string;
  let config: ResolvedConfig;
  let client: Client;

  const mockSnapshot: SchemaSnapshot = {
    version: 1,
    dialect: "postgres",
    databaseName: "shop",
    generatedAt: "2026-11-05T12:00:00.000Z",
    hash: "test_mcp_hash",
    schemas: ["public"],
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

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-lens-mcp-e2e-"));
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

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer(config);
    await server.connect(serverTransport);

    client = new Client(
      {
        name: "test-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      },
    );
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("lists all 4 registered tools with readOnlyHint", async () => {
    const res = await client.listTools();
    expect(res.tools.length).toBe(4);

    const names = res.tools.map((t) => t.name);
    expect(names).toEqual(["schema_overview", "table_details", "find_join_path", "schema_changes"]);

    for (const tool of res.tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }
  });

  it("calls schema_overview tool successfully", async () => {
    const res = await client.callTool({
      name: "schema_overview",
      arguments: {},
    });

    expect(res.isError).toBeFalsy();
    const content = res.content as Array<{ type: string; text: string }>;
    const text = content[0]?.text ?? "";
    expect(text).toContain("# postgres shop | 2 tables");
    expect(text).toContain("orders(2 cols) -> users");
  });

  it("calls table_details tool successfully", async () => {
    const res = await client.callTool({
      name: "table_details",
      arguments: { tables: ["users", "orders"] },
    });

    expect(res.isError).toBeFalsy();
    const content = res.content as Array<{ type: string; text: string }>;
    const text = content[0]?.text ?? "";
    expect(text).toContain("table users");
    expect(text).toContain("table orders");
  });

  it("calls find_join_path tool successfully", async () => {
    const res = await client.callTool({
      name: "find_join_path",
      arguments: { from: "orders", to: "users" },
    });

    expect(res.isError).toBeFalsy();
    const content = res.content as Array<{ type: string; text: string }>;
    const text = content[0]?.text ?? "";
    expect(text).toBe("orders -> users: orders.user_id = users.id");
  });

  it("calls schema_changes tool successfully", async () => {
    const res = await client.callTool({
      name: "schema_changes",
      arguments: {},
    });

    expect(res.isError).toBeFalsy();
    const content = res.content as Array<{ type: string; text: string }>;
    const text = content[0]?.text ?? "";
    expect(text).toContain("No previous snapshot to compare against");
  });

  it("returns error on unknown tool call", async () => {
    const res = await client.callTool({
      name: "unknown_tool",
      arguments: {},
    });

    expect(res.isError).toBe(true);
    const content = res.content as Array<{ type: string; text: string }>;
    const text = content[0]?.text ?? "";
    expect(text).toContain('Unknown tool: "unknown_tool"');
  });
});
