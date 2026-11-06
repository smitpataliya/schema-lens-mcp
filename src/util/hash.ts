import { createHash } from "node:crypto";
import type { SchemaSnapshot, Table } from "../core/types.js";

function sortObjectKeys<T>(val: T): T {
  if (val === null || typeof val !== "object") {
    return val;
  }

  if (Array.isArray(val)) {
    return val.map((item) => sortObjectKeys(item)) as unknown as T;
  }

  const sortedObj: Record<string, unknown> = {};
  const keys = Object.keys(val as Record<string, unknown>).sort();
  for (const key of keys) {
    sortedObj[key] = sortObjectKeys((val as Record<string, unknown>)[key]);
  }
  return sortedObj as T;
}

function normalizeSnapshotForHashing(
  snapshot: Omit<SchemaSnapshot, "hash" | "generatedAt"> | SchemaSnapshot,
): Record<string, unknown> {
  const schemas = [...(snapshot.schemas || [])].sort();

  const enums = [...(snapshot.enums || [])]
    .map((e) => ({
      name: e.name,
      schema: e.schema,
      values: [...e.values],
    }))
    .sort((a, b) => `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`));

  const tables = [...(snapshot.tables || [])]
    .map((t): Table => {
      const primaryKey = [...(t.primaryKey || [])];
      const uniques = [...(t.uniques || [])]
        .map((cols) => [...cols].sort())
        .sort((a, b) => a.join(",").localeCompare(b.join(",")));

      const foreignKeys = [...(t.foreignKeys || [])].sort((a, b) =>
        `${a.name}:${a.columns.join(",")}`.localeCompare(`${b.name}:${b.columns.join(",")}`),
      );

      const indexes = [...(t.indexes || [])].sort((a, b) => a.name.localeCompare(b.name));

      const checks = [...(t.checks || [])].sort();

      const columns = [...(t.columns || [])];

      const res: Table = {
        schema: t.schema,
        name: t.name,
        kind: t.kind,
        columns,
        primaryKey,
        uniques,
        foreignKeys,
        indexes,
        checks,
      };

      if (t.comment !== undefined) {
        res.comment = t.comment;
      }

      return res;
    })
    .sort((a, b) => `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`));

  return {
    version: snapshot.version,
    dialect: snapshot.dialect,
    databaseName: snapshot.databaseName,
    schemas,
    enums,
    tables,
  };
}

export function canonicalJsonStringify(obj: unknown): string {
  const sorted = sortObjectKeys(obj);
  return JSON.stringify(sorted);
}

export function computeSnapshotHash(
  snapshot: Omit<SchemaSnapshot, "hash" | "generatedAt"> | SchemaSnapshot,
): string {
  const canonicalObj = normalizeSnapshotForHashing(snapshot);
  const json = canonicalJsonStringify(canonicalObj);
  return createHash("sha256").update(json).digest("hex");
}
