import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";
import { ConfigError } from "./errors.js";
import type { Dialect } from "./types.js";

export const FileConfigSchema = z
  .object({
    envVar: z.string().optional(),
    schemas: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
    includeTables: z.array(z.string()).optional(),
    includeViews: z.boolean().optional(),
    ttlSeconds: z.number().int().positive().optional(),
    outDir: z.string().optional(),
    terse: z.boolean().optional(),
  })
  .strict();

export type FileConfig = z.infer<typeof FileConfigSchema>;

export interface CliConfigFlags {
  url?: string;
  env?: string;
  schema?: string[];
  exclude?: string[];
  includeTables?: string[];
  includeViews?: boolean;
  ttl?: number;
  out?: string;
  terse?: boolean;
}

export interface ResolvedConfig {
  connectionUrl: string;
  dialect: Dialect;
  schemas: string[];
  exclude: string[];
  includeTables?: string[];
  includeViews: boolean;
  ttlSeconds: number;
  outDir: string;
  terse: boolean;
}

export const DEFAULT_CONFIG = {
  schemas: [] as string[],
  exclude: ["_prisma_*", "knex_*", "schema_migrations"],
  includeViews: true,
  ttlSeconds: 300,
  outDir: ".schema-lens",
  terse: false,
};

export function detectDialect(url: string): Dialect {
  const trimmed = url.trim();
  if (trimmed.startsWith("postgres://") || trimmed.startsWith("postgresql://")) {
    return "postgres";
  }
  if (trimmed.startsWith("mysql://") || trimmed.startsWith("mariadb://")) {
    return "mysql";
  }
  if (
    trimmed.startsWith("sqlite:") ||
    trimmed.endsWith(".sqlite") ||
    trimmed.endsWith(".db") ||
    trimmed.endsWith(".sqlite3")
  ) {
    return "sqlite";
  }
  throw new ConfigError(
    `Unsupported database URL protocol: "${url.slice(0, 15)}...". Supported: postgres://, postgresql://, mysql://, mariadb://, sqlite:`,
  );
}

export function loadConfigFile(cwd = process.cwd()): FileConfig | null {
  const configPath = path.join(cwd, "schema-lens.config.json");
  if (!fs.existsSync(configPath)) {
    return null;
  }

  let raw: unknown;
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    raw = JSON.parse(content);
  } catch (err) {
    throw new ConfigError(
      `Failed to parse schema-lens.config.json: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (typeof raw === "object" && raw !== null) {
    const rawRecord = raw as Record<string, unknown>;
    if (
      "url" in rawRecord ||
      "connectionUrl" in rawRecord ||
      "connectionString" in rawRecord ||
      "password" in rawRecord
    ) {
      throw new ConfigError(
        "Secrets and connection URLs are not allowed in schema-lens.config.json. Use the 'envVar' field instead.",
      );
    }
  }

  const result = FileConfigSchema.safeParse(raw);
  if (!result.success) {
    const issueMessages = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join(", ");
    throw new ConfigError(`Invalid schema-lens.config.json: ${issueMessages}`);
  }

  return result.data;
}

export function loadConfig(
  cliFlags: CliConfigFlags = {},
  cwd = process.cwd(),
  requireUrl = true,
): ResolvedConfig {
  const envPath = path.join(cwd, ".env");
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }

  const fileConfig = loadConfigFile(cwd);

  const envVarName = cliFlags.env || fileConfig?.envVar;
  let connectionUrl = cliFlags.url;

  if (!connectionUrl && envVarName) {
    connectionUrl = process.env[envVarName];
  }

  if (!connectionUrl) {
    connectionUrl = process.env.SCHEMA_LENS_URL || process.env.DATABASE_URL;
  }

  if (requireUrl && !connectionUrl) {
    throw new ConfigError(
      "Database connection URL is required. Provide via --url flag, SCHEMA_LENS_URL / DATABASE_URL environment variable, or configure 'envVar' in schema-lens.config.json.",
    );
  }

  const safeUrl = connectionUrl || "";
  const dialect = safeUrl ? detectDialect(safeUrl) : "postgres";

  const schemas =
    cliFlags.schema && cliFlags.schema.length > 0
      ? cliFlags.schema
      : (fileConfig?.schemas ?? DEFAULT_CONFIG.schemas);

  const exclude =
    cliFlags.exclude && cliFlags.exclude.length > 0
      ? cliFlags.exclude
      : (fileConfig?.exclude ?? DEFAULT_CONFIG.exclude);

  const includeTables = cliFlags.includeTables ?? fileConfig?.includeTables;

  const includeViews =
    cliFlags.includeViews ?? fileConfig?.includeViews ?? DEFAULT_CONFIG.includeViews;

  const ttlSeconds = cliFlags.ttl ?? fileConfig?.ttlSeconds ?? DEFAULT_CONFIG.ttlSeconds;

  const outDir = cliFlags.out ?? fileConfig?.outDir ?? DEFAULT_CONFIG.outDir;

  const terse = cliFlags.terse ?? fileConfig?.terse ?? DEFAULT_CONFIG.terse;

  const resolved: ResolvedConfig = {
    connectionUrl: safeUrl,
    dialect,
    schemas,
    exclude,
    includeViews,
    ttlSeconds,
    outDir,
    terse,
  };

  if (includeTables !== undefined) {
    resolved.includeTables = includeTables;
  }

  return resolved;
}
