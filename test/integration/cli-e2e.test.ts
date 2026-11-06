import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("CLI End-to-End Integration", () => {
  const cliPath = path.resolve(process.cwd(), "dist/cli.js");
  let tempDir: string;
  let dbPath: string;
  let connectionUrl: string;

  beforeAll(() => {
    tempDir = path.join(os.tmpdir(), `schema-lens-e2e-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    dbPath = path.join(tempDir, "test.db");
    const db = new Database(dbPath);

    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        name TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        total REAL NOT NULL DEFAULT 0.0,
        status TEXT NOT NULL DEFAULT 'pending'
      );

      CREATE INDEX idx_orders_user ON orders(user_id);
    `);

    db.close();
    connectionUrl = `sqlite:${dbPath}`;
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("runs init command to scaffold config and update gitignore", async () => {
    const gitignorePath = path.join(tempDir, ".gitignore");
    fs.writeFileSync(gitignorePath, "node_modules\n", "utf-8");

    const { stderr } = await execFileAsync(
      process.execPath,
      [cliPath, "init", "--env", "TEST_DB_URL"],
      { cwd: tempDir },
    );

    const configPath = path.join(tempDir, "schema-lens.config.json");
    expect(fs.existsSync(configPath)).toBe(true);

    const configContent = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(configContent.envVar).toBe("TEST_DB_URL");

    const gitignore = fs.readFileSync(gitignorePath, "utf-8");
    expect(gitignore).toContain(".schema-lens/snapshot*.json");
    expect(stderr).toContain("Configuration complete!");
  });

  it("runs check command and outputs connection status", async () => {
    const { stderr } = await execFileAsync(
      process.execPath,
      [cliPath, "check", "--url", connectionUrl],
      { cwd: tempDir },
    );

    expect(stderr).toContain("Connection OK");
    expect(stderr).toContain("Dialect: sqlite");
    expect(stderr).toContain("Tables: 2");
  });

  it("runs sync command and creates schema.md and snapshot.json", async () => {
    const { stderr } = await execFileAsync(
      process.execPath,
      [cliPath, "sync", "--url", connectionUrl, "--out", ".schema-lens"],
      { cwd: tempDir },
    );

    expect(stderr).toContain("Synced 2 tables");

    const schemaMdPath = path.join(tempDir, ".schema-lens", "schema.md");
    const snapshotPath = path.join(tempDir, ".schema-lens", "snapshot.json");
    const metaPath = path.join(tempDir, ".schema-lens", "meta.json");

    expect(fs.existsSync(schemaMdPath)).toBe(true);
    expect(fs.existsSync(snapshotPath)).toBe(true);
    expect(fs.existsSync(metaPath)).toBe(true);

    const schemaMd = fs.readFileSync(schemaMdPath, "utf-8");
    expect(schemaMd).toContain("users");
    expect(schemaMd).toContain("orders");
    expect(schemaMd).toContain("fk->users.id");
  });

  it("runs print command with overview and detail levels", async () => {
    // Overview level
    const { stdout: overviewOut } = await execFileAsync(
      process.execPath,
      [cliPath, "print", "--url", connectionUrl, "--level", "overview"],
      { cwd: tempDir },
    );

    expect(overviewOut).toContain("# sqlite");
    expect(overviewOut).toContain("orders");
    expect(overviewOut).toContain("-> users");

    // Detail level for users table
    const { stdout: detailOut } = await execFileAsync(
      process.execPath,
      [cliPath, "print", "users", "--url", connectionUrl],
      { cwd: tempDir },
    );

    expect(detailOut).toContain("users");
    expect(detailOut).toContain("email TEXT uniq");
    expect(detailOut).toContain("name TEXT?");
  });

  it("detects schema drift with diff command after DDL change", async () => {
    // Add column to database
    const db = new Database(dbPath);
    db.exec("ALTER TABLE users ADD COLUMN phone TEXT;");
    db.close();

    // Re-sync
    await execFileAsync(
      process.execPath,
      [cliPath, "sync", "--url", connectionUrl, "--out", ".schema-lens"],
      { cwd: tempDir },
    );

    // Diff
    const { stdout: diffOut } = await execFileAsync(
      process.execPath,
      [cliPath, "diff", "--out", ".schema-lens"],
      { cwd: tempDir },
    );

    expect(diffOut).toContain("users");
    expect(diffOut).toContain("+ col phone");
  });
});
