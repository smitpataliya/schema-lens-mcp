import { MysqlAdapter } from "../adapters/mysql.js";
import { PostgresAdapter } from "../adapters/postgres.js";
import { SqliteAdapter } from "../adapters/sqlite.js";
import { ConfigError } from "./errors.js";
import type { DatabaseAdapter, Dialect, IntrospectOptions, SchemaSnapshot } from "./types.js";

export function getAdapter(dialect: Dialect, connectionUrl: string): DatabaseAdapter {
  switch (dialect) {
    case "postgres":
      return new PostgresAdapter(connectionUrl);
    case "mysql":
      return new MysqlAdapter(connectionUrl);
    case "sqlite":
      return new SqliteAdapter(connectionUrl);
    default:
      throw new ConfigError(`Unsupported dialect: ${dialect}`);
  }
}

export async function introspectDatabase(
  dialect: Dialect,
  connectionUrl: string,
  options: IntrospectOptions,
): Promise<SchemaSnapshot> {
  const adapter = getAdapter(dialect, connectionUrl);
  try {
    await adapter.connect();
    return await adapter.introspect(options);
  } finally {
    await adapter.close();
  }
}
