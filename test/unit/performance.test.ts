import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SqliteAdapter } from "../../src/adapters/sqlite.js";
import {
  computeCacheKey,
  getOrUpdateSnapshot,
  readSnapshot,
  saveSnapshotFiles,
} from "../../src/core/cache.js";
import type { ResolvedConfig } from "../../src/core/config.js";
import { computeSnapshotHash } from "../../src/util/hash.js";

describe("Performance Benchmark (300 tables)", () => {
  const tempDir = path.join(os.tmpdir(), `schema-lens-perf-${Date.now()}`);
  const dbPath = path.join(tempDir, "large.db");
  const cacheDir = path.join(tempDir, ".schema-lens");

  let adapter: SqliteAdapter;
  let config: ResolvedConfig;
  let cachedSnapshot: import("../../src/core/types.js").SchemaSnapshot;

  beforeAll(() => {
    fs.mkdirSync(tempDir, { recursive: true });
    const db = new Database(dbPath);

    // Speed up 300 table creation via single transaction and pragmas
    db.pragma("journal_mode = MEMORY");
    db.pragma("synchronous = OFF");

    const setupTx = db.transaction(() => {
      // Base table for foreign keys
      db.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT NOT NULL UNIQUE,
          name TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // 299 synthetic tables (total 300 tables)
      for (let i = 1; i <= 299; i++) {
        db.exec(`
          CREATE TABLE table_${i} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER REFERENCES users(id),
            col_str_1 TEXT NOT NULL,
            col_str_2 TEXT,
            col_str_3 TEXT DEFAULT 'active',
            col_int_1 INTEGER NOT NULL DEFAULT 0,
            col_int_2 INTEGER,
            col_int_3 INTEGER,
            col_real_1 REAL NOT NULL DEFAULT 0.0,
            col_real_2 REAL,
            col_blob_1 BLOB,
            col_date_1 TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            col_date_2 TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            notes TEXT
          );
          CREATE INDEX idx_table_${i}_user ON table_${i}(user_id);
          CREATE INDEX idx_table_${i}_status ON table_${i}(status);
        `);
      }
    });

    setupTx();
    db.close();

    const connectionUrl = `sqlite:${dbPath}`;
    adapter = new SqliteAdapter(connectionUrl);

    config = {
      connectionUrl,
      dialect: "sqlite",
      schemas: ["main"],
      exclude: [],
      includeViews: true,
      ttlSeconds: 300,
      outDir: cacheDir,
      terse: false,
    };
  });

  afterAll(async () => {
    await adapter.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // cleanup ignore
    }
  });

  it("completes cold introspection in < 2000 ms", async () => {
    const t0 = performance.now();
    const snapshot = await adapter.introspect();
    const elapsed = performance.now() - t0;
    cachedSnapshot = snapshot;

    expect(snapshot.tables.length).toBe(300);
    expect(elapsed).toBeLessThan(2000);

    // Save for subsequent cached tests
    saveSnapshotFiles(
      cacheDir,
      snapshot,
      config.connectionUrl,
      computeCacheKey(config),
      config.terse,
    );
  });

  it("calculates canonical snapshot hash in < 100 ms", () => {
    const t0 = performance.now();
    const hash = computeSnapshotHash(cachedSnapshot);
    const elapsed = performance.now() - t0;

    expect(typeof hash).toBe("string");
    expect(hash.length).toBe(64);
    expect(elapsed).toBeLessThan(100);
  });

  it("retrieves snapshot from cache in < 100 ms", async () => {
    // 1. Direct file read
    const t0 = performance.now();
    const snapshot = readSnapshot(cacheDir);
    const readElapsed = performance.now() - t0;

    expect(snapshot).not.toBeNull();
    expect(snapshot?.tables.length).toBe(300);
    expect(readElapsed).toBeLessThan(100);

    // 2. getOrUpdateSnapshot cached path
    const t1 = performance.now();
    const result = await getOrUpdateSnapshot(adapter, config);
    const cachedElapsed = performance.now() - t1;

    expect(result.fromCache).toBe(true);
    expect(result.snapshot.tables.length).toBe(300);
    expect(cachedElapsed).toBeLessThan(100);
  });
});
