import path from "node:path";
import { z } from "zod";
import { getOrUpdateSnapshot, readMeta, readPrevSnapshot, readSnapshot } from "../core/cache.js";
import type { ResolvedConfig } from "../core/config.js";
import { diffSnapshots, formatDiff } from "../core/diff.js";
import { getUserMessage } from "../core/errors.js";
import { SchemaGraph, findJoinPath } from "../core/graph.js";
import type { SchemaSnapshot } from "../core/types.js";
import { renderDetail, renderOverview } from "../format/compact.js";

export const MAX_RESPONSE_LENGTH = 8000;

export function capResponse(text: string, truncationHint: string): string {
  if (text.length <= MAX_RESPONSE_LENGTH) {
    return text;
  }
  const truncated = text.slice(0, MAX_RESPONSE_LENGTH);
  return `${truncated}\n\n[TRUNCATED: Output exceeded ${MAX_RESPONSE_LENGTH} characters. ${truncationHint}]`;
}

// Zod schemas for input validation
export const SchemaOverviewInputSchema = z
  .object({
    schemas: z.array(z.string()).optional(),
    offset: z.number().int().min(0).optional(),
    limit: z.number().int().positive().max(500).optional(),
    refresh: z.boolean().optional(),
  })
  .strict();

export const TableDetailsInputSchema = z
  .object({
    tables: z.array(z.string()).min(1).max(20),
    refresh: z.boolean().optional(),
  })
  .strict();

export const FindJoinPathInputSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    maxHops: z.number().int().positive().max(10).optional(),
  })
  .strict();

export const SchemaChangesInputSchema = z.object({}).strict();

export interface ToolExecutionResult {
  content: string;
  isError: boolean;
}

export async function resolveSnapshot(
  config: ResolvedConfig,
  refresh = false,
): Promise<SchemaSnapshot> {
  const outDir = path.resolve(process.cwd(), config.outDir);

  // If no connection URL provided, attempt reading from cached disk snapshot
  if (!config.connectionUrl) {
    const cached = readSnapshot(outDir);
    if (!cached) {
      throw new Error(
        "No cached snapshot found in .schema-lens/ and no database connection URL provided. Set DATABASE_URL or run sync first.",
      );
    }
    return cached;
  }

  // Uses memory cache, disk cache, single-flight, and connects DB lazily only on miss/refresh
  const { snapshot } = await getOrUpdateSnapshot(config, { refresh });
  return snapshot;
}

export async function handleSchemaOverview(
  rawArgs: unknown,
  config: ResolvedConfig,
): Promise<ToolExecutionResult> {
  const parseResult = SchemaOverviewInputSchema.safeParse(rawArgs ?? {});
  if (!parseResult.success) {
    return {
      content: `Invalid input: ${parseResult.error.issues.map((i) => i.message).join(", ")}`,
      isError: true,
    };
  }

  try {
    const { schemas, offset, limit, refresh } = parseResult.data;
    const snapshot = await resolveSnapshot(config, refresh);

    let targetSnapshot = snapshot;
    if (schemas && schemas.length > 0) {
      const allowed = new Set(schemas);
      targetSnapshot = {
        ...snapshot,
        schemas: snapshot.schemas.filter((s) => allowed.has(s)),
        enums: snapshot.enums.filter((e) => allowed.has(e.schema)),
        tables: snapshot.tables.filter((t) => allowed.has(t.schema)),
      };
    }

    const outDir = path.resolve(process.cwd(), config.outDir);
    const meta = readMeta(outDir);
    const ageSeconds = meta
      ? Math.max(0, Math.round((Date.now() - new Date(meta.generatedAt).getTime()) / 1000))
      : 0;

    const fullText = renderOverview(targetSnapshot, {
      hash: snapshot.hash,
      ageSeconds,
      offset,
      limit,
    });

    return {
      content: capResponse(
        fullText,
        "Use offset/limit or schemas parameter to narrow results, or call table_details directly.",
      ),
      isError: false,
    };
  } catch (err) {
    return {
      content: getUserMessage(err),
      isError: true,
    };
  }
}

export async function handleTableDetails(
  rawArgs: unknown,
  config: ResolvedConfig,
): Promise<ToolExecutionResult> {
  const parseResult = TableDetailsInputSchema.safeParse(rawArgs ?? {});
  if (!parseResult.success) {
    return {
      content: `Invalid input: ${parseResult.error.issues.map((i) => i.message).join(", ")}`,
      isError: true,
    };
  }

  try {
    const { tables, refresh } = parseResult.data;
    const snapshot = await resolveSnapshot(config, refresh);
    const graph = new SchemaGraph(snapshot);

    const blocks: string[] = [];

    for (const requestedTable of tables) {
      // Validates existence and resolves exact table name or throws TableNotFoundError with fuzzy suggestions
      const resolvedName = graph.resolveTableName(requestedTable);
      const detailBlock = renderDetail(snapshot, [resolvedName], config.terse);

      const neighbors = graph.getDirectNeighbors(resolvedName);
      const neighborLines: string[] = [];
      if (neighbors.outgoing.length > 0) {
        neighborLines.push(`  references: ${neighbors.outgoing.join(", ")}`);
      }
      if (neighbors.incoming.length > 0) {
        neighborLines.push(`  referenced by: ${neighbors.incoming.join(", ")}`);
      }

      const combined =
        neighborLines.length > 0 ? `${detailBlock}\n${neighborLines.join("\n")}` : detailBlock;

      blocks.push(combined);
    }

    const text = blocks.join("\n\n");
    return {
      content: capResponse(text, "Call table_details with fewer tables at once."),
      isError: false,
    };
  } catch (err) {
    return {
      content: getUserMessage(err),
      isError: true,
    };
  }
}

export async function handleFindJoinPath(
  rawArgs: unknown,
  config: ResolvedConfig,
): Promise<ToolExecutionResult> {
  const parseResult = FindJoinPathInputSchema.safeParse(rawArgs ?? {});
  if (!parseResult.success) {
    return {
      content: `Invalid input: ${parseResult.error.issues.map((i) => i.message).join(", ")}`,
      isError: true,
    };
  }

  try {
    const { from, to, maxHops } = parseResult.data;
    const snapshot = await resolveSnapshot(config, false);

    const result = findJoinPath(snapshot, from, to, maxHops ?? 4);
    return {
      content: result.formatted,
      isError: false,
    };
  } catch (err) {
    return {
      content: getUserMessage(err),
      isError: true,
    };
  }
}

export async function handleSchemaChanges(
  rawArgs: unknown,
  config: ResolvedConfig,
): Promise<ToolExecutionResult> {
  const parseResult = SchemaChangesInputSchema.safeParse(rawArgs ?? {});
  if (!parseResult.success) {
    return {
      content: `Invalid input: ${parseResult.error.issues.map((i) => i.message).join(", ")}`,
      isError: true,
    };
  }

  try {
    const outDir = path.resolve(process.cwd(), config.outDir);
    const current = readSnapshot(outDir);
    if (!current) {
      return {
        content: "No current snapshot found. Run schema_overview or sync first.",
        isError: true,
      };
    }

    const prev = readPrevSnapshot(outDir);
    if (!prev) {
      return {
        content: "No previous snapshot to compare against. Run sync after making schema changes.",
        isError: false,
      };
    }

    const diff = diffSnapshots(prev, current);
    const text = formatDiff(diff);

    return {
      content: capResponse(text, "Schema diff is very large. Check schema.md for full details."),
      isError: false,
    };
  } catch (err) {
    return {
      content: getUserMessage(err),
      isError: true,
    };
  }
}
