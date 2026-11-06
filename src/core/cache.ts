import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { renderMarkdown } from "../format/markdown.js";
import { createConnectionLabel } from "../util/redact.js";
import type { ResolvedConfig } from "./config.js";
import { getAdapter } from "./introspect.js";
import type { DatabaseAdapter, Dialect, IntrospectOptions, SchemaSnapshot } from "./types.js";

export interface SnapshotMeta {
  hash: string;
  cacheKey?: string | undefined;
  generatedAt: string;
  dialect: Dialect;
  connectionLabel: string;
  tableCount: number;
}

export function computeCacheKey(config: ResolvedConfig): string {
  const parts = {
    label: createConnectionLabel(config.connectionUrl),
    dialect: config.dialect,
    schemas: [...config.schemas].sort(),
    exclude: [...config.exclude].sort(),
    includeTables: config.includeTables ? [...config.includeTables].sort() : null,
    includeViews: config.includeViews,
    terse: config.terse,
  };
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}

export function writeAtomic(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tempPath, content, "utf-8");
  fs.renameSync(tempPath, filePath);
}

export function backupCurrentSnapshot(outDir: string): void {
  const snapshotPath = path.join(outDir, "snapshot.json");
  const prevPath = path.join(outDir, "snapshot.prev.json");
  if (fs.existsSync(snapshotPath)) {
    try {
      fs.copyFileSync(snapshotPath, prevPath);
    } catch {
      // non-critical backup failure
    }
  }
}

export function saveSnapshotFiles(
  outDir: string,
  snapshot: SchemaSnapshot,
  connectionUrl: string,
  cacheKey?: string,
  terse = false,
): void {
  const snapshotPath = path.join(outDir, "snapshot.json");
  const schemaMdPath = path.join(outDir, "schema.md");
  const metaPath = path.join(outDir, "meta.json");

  writeAtomic(snapshotPath, JSON.stringify(snapshot, null, 2));

  const markdown = renderMarkdown(snapshot, terse);
  writeAtomic(schemaMdPath, markdown);

  const meta: SnapshotMeta = {
    hash: snapshot.hash,
    cacheKey,
    generatedAt: snapshot.generatedAt,
    dialect: snapshot.dialect,
    connectionLabel: createConnectionLabel(connectionUrl),
    tableCount: snapshot.tables.length,
  };

  writeAtomic(metaPath, JSON.stringify(meta, null, 2));
}

export function readSnapshot(outDir: string): SchemaSnapshot | null {
  const snapshotPath = path.join(outDir, "snapshot.json");
  if (!fs.existsSync(snapshotPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(snapshotPath, "utf-8");
    return JSON.parse(raw) as SchemaSnapshot;
  } catch {
    return null;
  }
}

export function readPrevSnapshot(outDir: string): SchemaSnapshot | null {
  const prevPath = path.join(outDir, "snapshot.prev.json");
  if (!fs.existsSync(prevPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(prevPath, "utf-8");
    return JSON.parse(raw) as SchemaSnapshot;
  } catch {
    return null;
  }
}

export function readMeta(outDir: string): SnapshotMeta | null {
  const metaPath = path.join(outDir, "meta.json");
  if (!fs.existsSync(metaPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(metaPath, "utf-8");
    return JSON.parse(raw) as SnapshotMeta;
  } catch {
    return null;
  }
}

export function touchMetaTimestamp(outDir: string): void {
  const meta = readMeta(outDir);
  if (!meta) return;

  meta.generatedAt = new Date().toISOString();
  const metaPath = path.join(outDir, "meta.json");
  writeAtomic(metaPath, JSON.stringify(meta, null, 2));
}

// In-memory cache & single-flight handling
interface MemoryCacheEntry {
  snapshot: SchemaSnapshot;
  cachedAt: number;
}
const memoryCache = new Map<string, MemoryCacheEntry>();
const inFlightIntrospections = new Map<
  string,
  Promise<{ snapshot: SchemaSnapshot; fromCache: boolean }>
>();

export function clearMemoryCache(): void {
  memoryCache.clear();
  inFlightIntrospections.clear();
}

export async function getOrUpdateSnapshot(
  adapterOrConfig: DatabaseAdapter | ResolvedConfig,
  configOrOptions?: ResolvedConfig | { refresh?: boolean },
  maybeOptions: { refresh?: boolean } = {},
): Promise<{ snapshot: SchemaSnapshot; fromCache: boolean }> {
  let adapter: DatabaseAdapter | null = null;
  let config: ResolvedConfig;
  let options: { refresh?: boolean } = {};

  if ("introspect" in adapterOrConfig) {
    adapter = adapterOrConfig;
    config = configOrOptions as ResolvedConfig;
    options = maybeOptions;
  } else {
    config = adapterOrConfig;
    options = (configOrOptions as { refresh?: boolean }) ?? {};
  }

  const outDir = path.resolve(process.cwd(), config.outDir);
  const cacheKey = computeCacheKey(config);

  // 1. In-memory cache check (zero IO, zero DB connection)
  if (!options.refresh) {
    const mem = memoryCache.get(cacheKey);
    if (mem && Date.now() - mem.cachedAt < config.ttlSeconds * 1000) {
      return { snapshot: mem.snapshot, fromCache: true };
    }
  }

  // 2. Disk cache check (zero DB connection)
  if (!options.refresh) {
    const meta = readMeta(outDir);
    const cachedSnapshot = readSnapshot(outDir);

    if (cachedSnapshot && meta && meta.cacheKey === cacheKey) {
      const generatedMs = new Date(meta.generatedAt).getTime();
      const ageSeconds = (Date.now() - generatedMs) / 1000;

      if (ageSeconds < config.ttlSeconds) {
        memoryCache.set(cacheKey, { snapshot: cachedSnapshot, cachedAt: Date.now() });
        return { snapshot: cachedSnapshot, fromCache: true };
      }
    }
  }

  // 3. Single-flight: coalesce concurrent introspections for identical cacheKey
  const inFlight = inFlightIntrospections.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const executionPromise = (async () => {
    let localAdapter = adapter;
    const shouldClose = !localAdapter;

    if (!localAdapter) {
      localAdapter = getAdapter(config.dialect, config.connectionUrl);
      await localAdapter.connect();
    }

    try {
      const introspectOpts: IntrospectOptions = {
        schemas: config.schemas,
        includeViews: config.includeViews,
        excludeTables: config.exclude,
      };
      if (config.includeTables !== undefined) {
        introspectOpts.includeTables = config.includeTables;
      }

      const meta = readMeta(outDir);
      const cachedSnapshot = readSnapshot(outDir);

      const snapshot = await localAdapter.introspect(introspectOpts);

      // Check if hash matches previous snapshot on disk
      if (meta && cachedSnapshot && meta.cacheKey === cacheKey && meta.hash === snapshot.hash) {
        touchMetaTimestamp(outDir);
        memoryCache.set(cacheKey, { snapshot: cachedSnapshot, cachedAt: Date.now() });
        return { snapshot: cachedSnapshot, fromCache: true };
      }

      // Hash changed or initial write: backup previous and save new
      backupCurrentSnapshot(outDir);
      saveSnapshotFiles(outDir, snapshot, config.connectionUrl, cacheKey, config.terse);
      memoryCache.set(cacheKey, { snapshot, cachedAt: Date.now() });

      return { snapshot, fromCache: false };
    } finally {
      if (shouldClose && localAdapter) {
        await localAdapter.close();
      }
    }
  })();

  inFlightIntrospections.set(cacheKey, executionPromise);

  try {
    return await executionPromise;
  } finally {
    inFlightIntrospections.delete(cacheKey);
  }
}
