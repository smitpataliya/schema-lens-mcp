import { describe, expect, it } from "vitest";
import { findSimilarTableNames, levenshtein } from "../../src/util/fuzzy.js";

describe("fuzzy matching", () => {
  it("calculates accurate Levenshtein distances", () => {
    expect(levenshtein("user", "users")).toBe(1);
    expect(levenshtein("ordr", "order")).toBe(1);
    expect(levenshtein("orders", "order_items")).toBe(5);
    expect(levenshtein("test", "test")).toBe(0);
  });

  it("suggests closest table names within max distance", () => {
    const allTables = ["users", "user_roles", "orders", "order_items", "categories"];

    const suggestions1 = findSimilarTableNames("user", allTables, 2);
    expect(suggestions1).toContain("users");

    const suggestions2 = findSimilarTableNames("ordres", allTables, 2);
    expect(suggestions2).toContain("orders");

    const suggestions3 = findSimilarTableNames("completely_different", allTables, 2);
    expect(suggestions3).toEqual([]);
  });
});
