import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/core/config.js";

describe("CLI Flags & Config Precedence Fixes", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `schema-lens-flags-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("treats print --schema public users as schema 'public' and table 'users' (non-variadic)", () => {
    const cmd = new Command();
    let parsedSchema: string[] | undefined;
    let parsedTables: string[] | undefined;

    cmd
      .command("print [tables...]")
      .option(
        "-s, --schema <name>",
        "Included schema name(s)",
        (val: string, prev: string[] = []) => prev.concat(val),
      )
      .action((tables: string[], options: { schema?: string[] }) => {
        parsedTables = tables;
        parsedSchema = options.schema;
      });

    cmd.parse(["node", "cli.js", "print", "--schema", "public", "users"]);

    expect(parsedSchema).toEqual(["public"]);
    expect(parsedTables).toEqual(["users"]);
  });

  it("respects --no-views and sets includeViews to false", () => {
    const cmd = new Command();
    cmd.option("--include-views", "Include views").option("--no-views", "Exclude views");

    cmd.parse(["node", "cli.js", "--no-views"]);
    const opts = cmd.opts();

    let includeViews: boolean | undefined;
    if (opts.views === false || opts.includeViews === false) {
      includeViews = false;
    } else if (opts.views === true || opts.includeViews === true) {
      includeViews = true;
    }

    expect(includeViews).toBe(false);
  });

  it("does not override config file values when flags are omitted", () => {
    // Write config with terse: true and includeViews: false
    const configPath = path.join(tempDir, "schema-lens.config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        envVar: "DATABASE_URL",
        includeViews: false,
        terse: true,
        includeTables: ["orders", "users"],
      }),
      "utf-8",
    );

    // Parse empty CLI flags (user did not pass --terse or --no-views on CLI)
    const emptyFlags = {};
    const resolved = loadConfig(emptyFlags, tempDir, false);

    expect(resolved.includeViews).toBe(false);
    expect(resolved.terse).toBe(true);
    expect(resolved.includeTables).toEqual(["orders", "users"]);
  });
});
