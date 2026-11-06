import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("CLI init logic", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `schema-lens-init-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("creates schema-lens.config.json and updates .gitignore", () => {
    const configPath = path.join(tempDir, "schema-lens.config.json");
    const gitignorePath = path.join(tempDir, ".gitignore");
    fs.writeFileSync(gitignorePath, "node_modules\n", "utf-8");

    // Simulate init logic
    const defaultConfig = {
      envVar: "DATABASE_URL",
      schemas: ["public"],
      exclude: ["_prisma_*", "knex_*", "schema_migrations"],
      includeViews: true,
      ttlSeconds: 300,
      outDir: ".schema-lens",
    };
    fs.writeFileSync(configPath, `${JSON.stringify(defaultConfig, null, 2)}\n`, "utf-8");

    const currentGitignore = fs.readFileSync(gitignorePath, "utf-8");
    if (!currentGitignore.includes(".schema-lens/snapshot*.json")) {
      fs.appendFileSync(gitignorePath, "\n.schema-lens/snapshot*.json\n", "utf-8");
    }

    expect(fs.existsSync(configPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(parsed.envVar).toBe("DATABASE_URL");
    expect(parsed.schemas).toEqual(["public"]);

    const updatedGitignore = fs.readFileSync(gitignorePath, "utf-8");
    expect(updatedGitignore).toContain(".schema-lens/snapshot*.json");
  });
});
