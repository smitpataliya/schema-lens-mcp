import { describe, expect, it } from "vitest";
import { filterTables, globToRegExp } from "../../src/adapters/adapter.js";
import type { Table } from "../../src/core/types.js";

describe("globToRegExp", () => {
  it("converts wildcard patterns correctly", () => {
    const rx = globToRegExp("_prisma_*");
    expect(rx.test("_prisma_migrations")).toBe(true);
    expect(rx.test("users")).toBe(false);
  });

  it("handles single-character wildcards", () => {
    const rx = globToRegExp("order?");
    expect(rx.test("orders")).toBe(true);
    expect(rx.test("order")).toBe(false);
  });
});

describe("filterTables", () => {
  const tables: Table[] = [
    {
      schema: "public",
      name: "users",
      kind: "table",
      columns: [],
      primaryKey: [],
      uniques: [],
      foreignKeys: [],
      indexes: [],
      checks: [],
    },
    {
      schema: "public",
      name: "orders",
      kind: "table",
      columns: [],
      primaryKey: [],
      uniques: [],
      foreignKeys: [],
      indexes: [],
      checks: [],
    },
    {
      schema: "public",
      name: "_prisma_migrations",
      kind: "table",
      columns: [],
      primaryKey: [],
      uniques: [],
      foreignKeys: [],
      indexes: [],
      checks: [],
    },
    {
      schema: "billing",
      name: "invoices",
      kind: "table",
      columns: [],
      primaryKey: [],
      uniques: [],
      foreignKeys: [],
      indexes: [],
      checks: [],
    },
  ];

  it("excludes tables matching exclude globs", () => {
    const result = filterTables(tables, undefined, ["_prisma_*"]);
    expect(result.map((t) => t.name)).toEqual(["users", "orders", "invoices"]);
  });

  it("includes only tables matching include patterns", () => {
    const result = filterTables(tables, ["users", "billing.*"]);
    expect(result.map((t) => `${t.schema}.${t.name}`)).toEqual([
      "public.users",
      "billing.invoices",
    ]);
  });
});
