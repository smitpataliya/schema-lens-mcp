import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runTokenBenchmark } from "../../scripts/benchmark.js";

describe("Token Count Benchmark", () => {
  it("achieves at least 4x token reduction over raw JSON snapshot", () => {
    const { results, ratio, markdown } = runTokenBenchmark();

    // Persist benchmark report
    const reportPath = path.resolve(process.cwd(), "benchmarks.md");
    fs.writeFileSync(reportPath, markdown, "utf-8");

    expect(ratio).toBeGreaterThanOrEqual(4.0);
    expect(results.length).toBe(3);

    const json = results[0];
    const compact = results[1];
    const overview = results[2];

    expect(json).toBeDefined();
    expect(compact).toBeDefined();
    expect(overview).toBeDefined();

    if (json && compact && overview) {
      expect(compact.tokens).toBeLessThan(json.tokens / 4.0);
      expect(overview.tokens).toBeLessThan(compact.tokens);
    }

    expect(markdown).toContain("Schema Lens Token Benchmark");
    expect(markdown).toContain("Reduction Ratio");
  });
});
