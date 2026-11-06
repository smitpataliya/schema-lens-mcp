import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  backupCurrentSnapshot,
  readMeta,
  readPrevSnapshot,
  readSnapshot,
  saveSnapshotFiles,
  touchMetaTimestamp,
  writeAtomic,
} from "../../src/core/cache.js";
import type { SchemaSnapshot } from "../../src/core/types.js";

describe("cache", () => {
  let tmpDir: string;

  const mockSnapshot: SchemaSnapshot = {
    version: 1,
    dialect: "postgres",
    databaseName: "shop",
    generatedAt: "2026-11-05T10:00:00.000Z",
    hash: "mockhash123456",
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
    ],
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-lens-cache-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes files atomically without leaving temporary files", () => {
    const testFile = path.join(tmpDir, "test.txt");
    writeAtomic(testFile, "hello atomic");

    expect(fs.readFileSync(testFile, "utf-8")).toBe("hello atomic");
    const files = fs.readdirSync(tmpDir);
    expect(files).toEqual(["test.txt"]);
  });

  it("saves snapshot, schema.md and meta.json properly", () => {
    saveSnapshotFiles(
      tmpDir,
      mockSnapshot,
      "postgres://user:secret@localhost:5432/shop",
      "cacheKey123",
    );

    const snapshot = readSnapshot(tmpDir);
    expect(snapshot).toBeDefined();
    expect(snapshot?.databaseName).toBe("shop");

    const meta = readMeta(tmpDir);
    expect(meta).toBeDefined();
    expect(meta?.hash).toBe("mockhash123456");
    expect(meta?.cacheKey).toBe("cacheKey123");
    expect(meta?.connectionLabel).toBe("postgres://localhost:5432/shop");
    expect(meta?.connectionLabel).not.toContain("secret");

    const schemaMdPath = path.join(tmpDir, "schema.md");
    expect(fs.existsSync(schemaMdPath)).toBe(true);
    expect(fs.readFileSync(schemaMdPath, "utf-8")).toContain("table users");
  });

  it("creates snapshot.prev.json when backing up current snapshot", () => {
    saveSnapshotFiles(tmpDir, mockSnapshot, "postgres://localhost:5432/shop");

    backupCurrentSnapshot(tmpDir);

    const prev = readPrevSnapshot(tmpDir);
    expect(prev).toBeDefined();
    expect(prev?.hash).toBe("mockhash123456");
  });

  it("updates timestamp in meta.json on touchMetaTimestamp", () => {
    saveSnapshotFiles(tmpDir, mockSnapshot, "postgres://localhost:5432/shop");

    const originalMeta = readMeta(tmpDir);
    expect(originalMeta).toBeDefined();
    if (!originalMeta) return;
    expect(originalMeta.generatedAt).toBe("2026-11-05T10:00:00.000Z");

    touchMetaTimestamp(tmpDir);

    const updatedMeta = readMeta(tmpDir);
    expect(updatedMeta).toBeDefined();
    if (!updatedMeta) return;
    expect(updatedMeta.generatedAt).not.toBe("2026-11-05T10:00:00.000Z");
  });
});
