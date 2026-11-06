import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectDialect, loadConfig, loadConfigFile } from "../../src/core/config.js";
import { ConfigError } from "../../src/core/errors.js";

describe("detectDialect", () => {
  it("detects postgres dialects", () => {
    expect(detectDialect("postgres://user:pass@localhost:5432/db")).toBe("postgres");
    expect(detectDialect("postgresql://user:pass@localhost:5432/db")).toBe("postgres");
  });

  it("detects mysql and mariadb dialects", () => {
    expect(detectDialect("mysql://root:pass@127.0.0.1:3306/db")).toBe("mysql");
    expect(detectDialect("mariadb://root:pass@127.0.0.1:3306/db")).toBe("mysql");
  });

  it("detects sqlite dialects", () => {
    expect(detectDialect("sqlite:/path/to/db.sqlite")).toBe("sqlite");
    expect(detectDialect("./data/app.db")).toBe("sqlite");
    expect(detectDialect("/tmp/test.sqlite3")).toBe("sqlite");
  });

  it("throws ConfigError on unknown protocol", () => {
    expect(() => detectDialect("oracle://localhost:1521/xe")).toThrow(ConfigError);
  });
});

describe("loadConfig and loadConfigFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-lens-test-"));
    // biome-ignore lint/performance/noDelete: Node process.env deletion requires delete operator
    delete process.env.SCHEMA_LENS_URL;
    // biome-ignore lint/performance/noDelete: Node process.env deletion requires delete operator
    delete process.env.DATABASE_URL;
    // biome-ignore lint/performance/noDelete: Node process.env deletion requires delete operator
    delete process.env.CUSTOM_DB_URL;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads config with CLI flags taking highest precedence", () => {
    process.env.DATABASE_URL = "postgres://env:pass@localhost:5432/envdb";
    const config = loadConfig(
      {
        url: "postgres://cli:pass@localhost:5432/clidb",
        schema: ["custom_schema"],
        ttl: 600,
      },
      tmpDir,
    );

    expect(config.connectionUrl).toBe("postgres://cli:pass@localhost:5432/clidb");
    expect(config.schemas).toEqual(["custom_schema"]);
    expect(config.ttlSeconds).toBe(600);
  });

  it("falls back to envVar specified in schema-lens.config.json", () => {
    const configPath = path.join(tmpDir, "schema-lens.config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        envVar: "CUSTOM_DB_URL",
        ttlSeconds: 120,
      }),
    );

    process.env.CUSTOM_DB_URL = "postgres://custom:pass@localhost:5432/customdb";
    const config = loadConfig({}, tmpDir);

    expect(config.connectionUrl).toBe("postgres://custom:pass@localhost:5432/customdb");
    expect(config.ttlSeconds).toBe(120);
  });

  it("rejects connection strings directly inside schema-lens.config.json", () => {
    const configPath = path.join(tmpDir, "schema-lens.config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        url: "postgres://bad:secret@localhost:5432/db",
      }),
    );

    expect(() => loadConfigFile(tmpDir)).toThrow(ConfigError);
    expect(() => loadConfigFile(tmpDir)).toThrow(/Secrets and connection URLs are not allowed/);
  });

  it("throws ConfigError when required URL is missing", () => {
    expect(() => loadConfig({}, tmpDir, true)).toThrow(ConfigError);
  });
});
