import { createHash } from "node:crypto";
import { ConnectionError, IntrospectionError } from "../core/errors.js";
import type {
  Column,
  DatabaseAdapter,
  EnumType,
  ForeignKey,
  Index,
  IntrospectOptions,
  SchemaSnapshot,
  Table,
} from "../core/types.js";
import { computeSnapshotHash } from "../util/hash.js";
import { logError } from "../util/logger.js";
import { redactCredentials } from "../util/redact.js";
import { filterTables } from "./adapter.js";

type OnAction = "cascade" | "set null" | "restrict" | "no action" | "set default";

function mapPostgresAction(code: string | null | undefined): OnAction | undefined {
  switch (code) {
    case "c":
      return "cascade";
    case "n":
      return "set null";
    case "r":
      return "restrict";
    case "a":
      return "no action";
    case "d":
      return "set default";
    default:
      return undefined;
  }
}

export interface PgRawTable {
  schema: string;
  name: string;
  kind: "r" | "p" | "v" | "m";
  comment: string | null;
  estimated_rows: string | number | null;
}

export interface PgRawColumn {
  schema: string;
  table: string;
  attnum: number;
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  is_identity: boolean;
  is_generated: boolean;
  is_enum: boolean;
  enum_name: string | null;
  comment: string | null;
}

export interface PgRawConstraint {
  schema: string;
  table: string;
  name: string;
  type: "p" | "u" | "f" | "c";
  columns: string[] | null;
  ref_schema: string | null;
  ref_table: string | null;
  ref_columns: string[] | null;
  on_delete: string | null;
  on_update: string | null;
  definition: string | null;
}

export interface PgRawIndex {
  schema: string;
  table: string;
  name: string;
  method: string;
  is_unique: boolean;
  columns: string[] | null;
  predicate: string | null;
}

export interface PgRawEnum {
  schema: string;
  name: string;
  values: string[] | null;
}

export interface PgIntrospectionRawData {
  tables: PgRawTable[];
  columns: PgRawColumn[];
  constraints: PgRawConstraint[];
  indexes: PgRawIndex[];
  enums: PgRawEnum[];
}

export function parsePostgresCatalogData(
  databaseName: string,
  schemas: string[],
  rawData: PgIntrospectionRawData,
  opts: IntrospectOptions = {},
): SchemaSnapshot {
  const tableMap = new Map<string, Table>();

  for (const t of rawData.tables) {
    let kind: Table["kind"] = "table";
    if (t.kind === "p") {
      kind = "partitioned";
    } else if (t.kind === "v") {
      kind = "view";
    } else if (t.kind === "m") {
      kind = "materialized_view";
    }

    if (!opts.includeViews && (kind === "view" || kind === "materialized_view")) {
      continue;
    }

    const key = `${t.schema}.${t.name}`;
    const table: Table = {
      schema: t.schema,
      name: t.name,
      kind,
      columns: [],
      primaryKey: [],
      uniques: [],
      foreignKeys: [],
      indexes: [],
      checks: [],
    };

    if (t.comment) {
      table.comment = t.comment;
    }

    if (t.estimated_rows !== null && t.estimated_rows !== undefined) {
      const parsedRows = Number(t.estimated_rows);
      if (!Number.isNaN(parsedRows) && parsedRows >= 0) {
        table.estimatedRows = parsedRows;
      }
    }

    tableMap.set(key, table);
  }

  // Group columns
  for (const c of rawData.columns) {
    const table = tableMap.get(`${c.schema}.${c.table}`);
    if (!table) {
      continue;
    }

    const col: Column = {
      name: c.name,
      type: c.type,
      nullable: c.nullable,
    };

    if (c.default !== null && c.default !== undefined) {
      col.default = c.default;
    }
    if (c.is_identity) {
      col.isIdentity = true;
    }
    if (c.is_generated) {
      col.isGenerated = true;
    }
    if (c.is_enum && c.enum_name) {
      col.enumRef = c.enum_name;
    }
    if (c.comment) {
      col.comment = c.comment;
    }

    table.columns.push(col);
  }

  // Group constraints
  for (const con of rawData.constraints) {
    const table = tableMap.get(`${con.schema}.${con.table}`);
    if (!table) {
      continue;
    }

    const cols = con.columns ?? [];

    if (con.type === "p") {
      table.primaryKey = cols;
    } else if (con.type === "u") {
      if (cols.length > 0) {
        table.uniques.push(cols);
      }
    } else if (con.type === "f") {
      const fk: ForeignKey = {
        name: con.name,
        columns: cols,
        refSchema: con.ref_schema ?? table.schema,
        refTable: con.ref_table ?? "",
        refColumns: con.ref_columns ?? [],
      };
      const delAction = mapPostgresAction(con.on_delete);
      if (delAction) {
        fk.onDelete = delAction;
      }
      const updAction = mapPostgresAction(con.on_update);
      if (updAction) {
        fk.onUpdate = updAction;
      }
      table.foreignKeys.push(fk);
    } else if (con.type === "c") {
      if (con.definition) {
        // Strip out "CHECK (" and trailing ")" if present to keep format clean
        const def = con.definition
          .replace(/^CHECK\s*\(/i, "")
          .replace(/\)$/, "")
          .trim();
        table.checks.push(def || con.definition);
      }
    }
  }

  // Group indexes
  for (const idx of rawData.indexes) {
    const table = tableMap.get(`${idx.schema}.${idx.table}`);
    if (!table) {
      continue;
    }

    const indexObj: Index = {
      name: idx.name,
      columns: idx.columns ?? [],
      unique: idx.is_unique,
    };

    if (idx.method && idx.method !== "btree") {
      indexObj.method = idx.method;
    }
    if (idx.predicate) {
      indexObj.where = idx.predicate;
    }

    table.indexes.push(indexObj);
  }

  // Filter tables by glob
  let tables = Array.from(tableMap.values());
  tables = filterTables(tables, opts.includeTables, opts.excludeTables);

  // Group enums
  const enums: EnumType[] = rawData.enums.map((e) => ({
    schema: e.schema,
    name: e.name,
    values: e.values ?? [],
  }));

  const partialSnapshot: Omit<SchemaSnapshot, "hash" | "generatedAt"> = {
    version: 1,
    dialect: "postgres",
    databaseName,
    schemas,
    tables,
    enums,
  };

  const hash = computeSnapshotHash(partialSnapshot);

  return {
    ...partialSnapshot,
    hash,
    generatedAt: new Date().toISOString(),
  };
}

export class PostgresAdapter implements DatabaseAdapter {
  public readonly dialect = "postgres" as const;
  private readonly connectionUrl: string;
  private pool: unknown = null;
  private databaseName = "postgres";

  constructor(connectionUrl: string) {
    this.connectionUrl = connectionUrl;
    try {
      const parsed = new URL(connectionUrl);
      this.databaseName = parsed.pathname.replace(/^\//, "") || "postgres";
    } catch {
      this.databaseName = "postgres";
    }
  }

  public async connect(): Promise<void> {
    if (this.pool) {
      return;
    }

    // Dynamic import of pg
    // biome-ignore lint/suspicious/noExplicitAny: dynamic pg import
    let pgModule: any;
    try {
      pgModule = await import("pg");
    } catch {
      throw new ConnectionError("Postgres driver 'pg' is not installed. Please run: npm i pg");
    }

    const Pool = pgModule.Pool || pgModule.default?.Pool;
    if (!Pool) {
      throw new ConnectionError("Failed to load Pool from pg driver.");
    }

    try {
      const pool = new Pool({
        connectionString: this.connectionUrl,
        connectionTimeoutMillis: 5000,
        statement_timeout: 10000,
        max: 4,
        options: "-c default_transaction_read_only=on",
      });

      // Handle background pool errors to prevent process crash on DB restart
      pool.on("error", (err: Error) => {
        const safeMsg = redactCredentials(err ? err.message : "Unknown pool error");
        logError(`Postgres pool error: ${safeMsg}`);
      });

      // Test query and verify read-only enforcement (fail-closed)
      const client = await pool.connect();
      try {
        const res = await client.query("SHOW default_transaction_read_only;");
        const val = res.rows[0]?.default_transaction_read_only;
        if (val !== "on") {
          throw new ConnectionError(
            `Failed to enforce read-only transaction on Postgres (expected 'on', got '${val}').`,
          );
        }
      } finally {
        client.release();
      }

      this.pool = pool;
    } catch (err) {
      const safeMsg = redactCredentials(err instanceof Error ? err.message : String(err));
      throw new ConnectionError(`Postgres connection failed: ${safeMsg}`, undefined, {
        cause: err,
      });
    }
  }

  public async introspect(opts: IntrospectOptions = {}): Promise<SchemaSnapshot> {
    await this.connect();
    // biome-ignore lint/suspicious/noExplicitAny: pool instance
    const pool = this.pool as any;

    try {
      let schemas = opts.schemas;
      if (!schemas || schemas.length === 0) {
        const schemaRes = await pool.query(`
          SELECT nspname FROM pg_namespace
          WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
            AND nspname NOT LIKE 'pg_temp%'
            AND nspname NOT LIKE 'pg_toast_temp%'
          ORDER BY nspname;
        `);
        schemas = schemaRes.rows.map((r: { nspname: string }) => r.nspname);
      }

      if (!schemas || schemas.length === 0) {
        schemas = ["public"];
      }

      const qTables = pool.query(
        `
        SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind,
               obj_description(c.oid, 'pg_class') AS comment,
               c.reltuples::bigint AS estimated_rows
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r','p','v','m')
          AND n.nspname = ANY($1)
          AND NOT c.relispartition
        ORDER BY n.nspname, c.relname;
        `,
        [schemas],
      );

      const qColumns = pool.query(
        `
        SELECT n.nspname AS schema, c.relname AS table, a.attnum,
               a.attname AS name,
               format_type(a.atttypid, a.atttypmod) AS type,
               NOT a.attnotnull AS nullable,
               pg_get_expr(d.adbin, d.adrelid) AS default,
               (a.attidentity <> '') AS is_identity,
               (a.attgenerated <> '') AS is_generated,
               t.typtype = 'e' AS is_enum,
               t.typname AS enum_name,
               col_description(c.oid, a.attnum) AS comment
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_type t ON t.oid = a.atttypid
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attnum > 0 AND NOT a.attisdropped
          AND c.relkind IN ('r','p','v','m')
          AND n.nspname = ANY($1)
        ORDER BY n.nspname, c.relname, a.attnum;
        `,
        [schemas],
      );

      const qConstraints = pool.query(
        `
        SELECT
          n.nspname AS schema,
          c.relname AS table,
          con.conname AS name,
          con.contype AS type,
          (
            SELECT array_agg(att.attname ORDER BY u.ord)
            FROM unnest(con.conkey) WITH ORDINALITY AS u(attnum, ord)
            JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = u.attnum
          ) AS columns,
          fn.nspname AS ref_schema,
          fc.relname AS ref_table,
          (
            SELECT array_agg(fatt.attname ORDER BY fu.ord)
            FROM unnest(con.confkey) WITH ORDINALITY AS fu(attnum, ord)
            JOIN pg_attribute fatt ON fatt.attrelid = con.confrelid AND fatt.attnum = fu.attnum
          ) AS ref_columns,
          con.confdeltype AS on_delete,
          con.confupdtype AS on_update,
          pg_get_constraintdef(con.oid) AS definition
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_class fc ON fc.oid = con.confrelid
        LEFT JOIN pg_namespace fn ON fn.oid = fc.relnamespace
        WHERE con.contype IN ('p', 'u', 'f', 'c')
          AND c.relkind IN ('r', 'p', 'v', 'm')
          AND n.nspname = ANY($1)
        ORDER BY n.nspname, c.relname, con.conname;
        `,
        [schemas],
      );

      const qIndexes = pool.query(
        `
        SELECT
          n.nspname AS schema,
          c.relname AS table,
          ic.relname AS name,
          am.amname AS method,
          i.indisunique AS is_unique,
          (
            SELECT array_agg(
              COALESCE(att.attname, pg_get_indexdef(i.indexrelid, u.ord::int, true))
              ORDER BY u.ord
            )
            FROM unnest(i.indkey) WITH ORDINALITY AS u(attnum, ord)
            LEFT JOIN pg_attribute att ON att.attrelid = c.oid AND att.attnum = u.attnum
          ) AS columns,
          pg_get_expr(i.indpred, i.indrelid) AS predicate
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indrelid
        JOIN pg_class ic ON ic.oid = i.indexrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_am am ON am.oid = ic.relam
        WHERE c.relkind IN ('r', 'p', 'v', 'm')
          AND n.nspname = ANY($1)
          AND NOT i.indisprimary
        ORDER BY n.nspname, c.relname, ic.relname;
        `,
        [schemas],
      );

      const qEnums = pool.query(
        `
        SELECT n.nspname AS schema, t.typname AS name,
               array_agg(e.enumlabel ORDER BY e.enumsortorder) AS values
        FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = ANY($1)
        GROUP BY n.nspname, t.typname
        ORDER BY n.nspname, t.typname;
        `,
        [schemas],
      );

      const [resTables, resColumns, resConstraints, resIndexes, resEnums] = await Promise.all([
        qTables,
        qColumns,
        qConstraints,
        qIndexes,
        qEnums,
      ]);

      const rawData: PgIntrospectionRawData = {
        tables: resTables.rows,
        columns: resColumns.rows,
        constraints: resConstraints.rows,
        indexes: resIndexes.rows,
        enums: resEnums.rows,
      };

      return parsePostgresCatalogData(this.databaseName, schemas, rawData, opts);
    } catch (err) {
      const safeMsg = redactCredentials(err instanceof Error ? err.message : String(err));
      throw new IntrospectionError(`Postgres introspection failed: ${safeMsg}`, undefined, {
        cause: err,
      });
    }
  }

  public async fingerprint(opts: IntrospectOptions = {}): Promise<string> {
    await this.connect();
    // biome-ignore lint/suspicious/noExplicitAny: pool instance
    const pool = this.pool as any;

    try {
      let schemas = opts.schemas;
      if (!schemas || schemas.length === 0) {
        const schemaRes = await pool.query(`
          SELECT nspname FROM pg_namespace
          WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
            AND nspname NOT LIKE 'pg_temp%'
            AND nspname NOT LIKE 'pg_toast_temp%'
          ORDER BY nspname;
        `);
        schemas = schemaRes.rows.map((r: { nspname: string }) => r.nspname);
      }

      if (!schemas || schemas.length === 0) {
        schemas = ["public"];
      }

      const res = await pool.query(
        `
        SELECT
          COUNT(c.oid)::text AS table_count,
          COALESCE(MAX(c.oid)::text, '0') AS max_table_oid,
          COUNT(a.attnum)::text AS col_count,
          COALESCE(SUM(a.attnum)::text, '0') AS attnum_sum,
          (
            SELECT COUNT(*) FROM pg_constraint con
            JOIN pg_class cc ON cc.oid = con.conrelid
            JOIN pg_namespace nn ON nn.oid = cc.relnamespace
            WHERE nn.nspname = ANY($1)
          )::text AS constraint_count,
          (
            SELECT COUNT(*) FROM pg_index i
            JOIN pg_class ci ON ci.oid = i.indrelid
            JOIN pg_namespace ni ON ni.oid = ci.relnamespace
            WHERE ni.nspname = ANY($1)
          )::text AS index_count
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
        WHERE c.relkind IN ('r', 'p', 'v', 'm')
          AND n.nspname = ANY($1)
          AND NOT c.relispartition;
        `,
        [schemas],
      );

      const row = res.rows[0];
      const summary = JSON.stringify(row);
      return createHash("sha256").update(summary).digest("hex");
    } catch (err) {
      const safeMsg = redactCredentials(err instanceof Error ? err.message : String(err));
      throw new IntrospectionError(`Postgres fingerprint check failed: ${safeMsg}`, undefined, {
        cause: err,
      });
    }
  }

  public async close(): Promise<void> {
    if (this.pool) {
      // biome-ignore lint/suspicious/noExplicitAny: pool instance
      const pool = this.pool as any;
      this.pool = null;
      await pool.end();
    }
  }
}
