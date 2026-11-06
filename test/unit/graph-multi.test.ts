import { describe, expect, it } from "vitest";
import { AmbiguousTableError } from "../../src/core/errors.js";
import { SchemaGraph } from "../../src/core/graph.js";
import type { SchemaSnapshot } from "../../src/core/types.js";

describe("SchemaGraph Multi-Edge & Ambiguity Fixes", () => {
  it("throws AmbiguousTableError when bare name matches multiple schemas", () => {
    const snapshot: SchemaSnapshot = {
      version: 1,
      dialect: "postgres",
      databaseName: "shop",
      generatedAt: new Date().toISOString(),
      hash: "abc",
      schemas: ["public", "audit"],
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
          schema: "audit",
          name: "users",
          kind: "table",
          columns: [{ name: "id", type: "uuid", nullable: false }],
          primaryKey: ["id"],
          uniques: [],
          foreignKeys: [],
          indexes: [],
          checks: [],
        },
      ],
    };

    const graph = new SchemaGraph(snapshot);

    // Bare "users" must throw AmbiguousTableError listing both
    expect(() => graph.resolveTableName("users")).toThrow(AmbiguousTableError);
    expect(() => graph.resolveTableName("users")).toThrow(
      /Table name "users" is ambiguous.*public\.users.*audit\.users/,
    );

    // Qualified names must resolve cleanly
    expect(graph.resolveTableName("public.users")).toBe("users");
    expect(graph.resolveTableName("audit.users")).toBe("audit.users");
  });

  it("returns all alternative join paths when multiple foreign keys exist between tables", () => {
    const snapshot: SchemaSnapshot = {
      version: 1,
      dialect: "postgres",
      databaseName: "shop",
      generatedAt: new Date().toISOString(),
      hash: "abc",
      schemas: ["public"],
      enums: [],
      tables: [
        {
          schema: "public",
          name: "addresses",
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
          name: "orders",
          kind: "table",
          columns: [
            { name: "id", type: "int", nullable: false },
            { name: "billing_address_id", type: "int", nullable: false },
            { name: "shipping_address_id", type: "int", nullable: false },
          ],
          primaryKey: ["id"],
          uniques: [],
          foreignKeys: [
            {
              name: "fk_orders_billing",
              columns: ["billing_address_id"],
              refSchema: "public",
              refTable: "addresses",
              refColumns: ["id"],
            },
            {
              name: "fk_orders_shipping",
              columns: ["shipping_address_id"],
              refSchema: "public",
              refTable: "addresses",
              refColumns: ["id"],
            },
          ],
          indexes: [],
          checks: [],
        },
      ],
    };

    const graph = new SchemaGraph(snapshot);
    const result = graph.findJoinPath("orders", "addresses");

    expect(result.found).toBe(true);
    expect(result.hops).toBe(1);
    expect(result.allPaths?.length).toBe(2);
    expect(result.formatted).toContain("Option 1");
    expect(result.formatted).toContain("Option 2");
    expect(result.formatted).toContain("billing_address_id = addresses.id");
    expect(result.formatted).toContain("shipping_address_id = addresses.id");
  });

  it("formats MySQL table names consistently without database prefix", () => {
    const snapshot: SchemaSnapshot = {
      version: 1,
      dialect: "mysql",
      databaseName: "shop_db",
      generatedAt: new Date().toISOString(),
      hash: "abc",
      schemas: ["shop_db"],
      enums: [],
      tables: [
        {
          schema: "shop_db",
          name: "users",
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

    const graph = new SchemaGraph(snapshot);
    expect(graph.resolveTableName("users")).toBe("users");
  });
});
