import type { DatabaseAdapter, Dialect, IntrospectOptions, Table } from "../core/types.js";

export type { DatabaseAdapter, Dialect, IntrospectOptions };

/**
 * Converts a glob pattern like "_prisma_*" or "audit.*" into a RegExp.
 */
export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

/**
 * Filters tables using include and exclude glob patterns.
 * Matches against both table name (e.g. "users") and schema-qualified name (e.g. "public.users").
 */
export function filterTables(tables: Table[], include?: string[], exclude?: string[]): Table[] {
  let result = tables;

  if (include && include.length > 0) {
    const includeRegexes = include.map(globToRegExp);
    result = result.filter((table) => {
      const qualified = `${table.schema}.${table.name}`;
      return includeRegexes.some((rx) => rx.test(table.name) || rx.test(qualified));
    });
  }

  if (exclude && exclude.length > 0) {
    const excludeRegexes = exclude.map(globToRegExp);
    result = result.filter((table) => {
      const qualified = `${table.schema}.${table.name}`;
      return !excludeRegexes.some((rx) => rx.test(table.name) || rx.test(qualified));
    });
  }

  return result;
}
