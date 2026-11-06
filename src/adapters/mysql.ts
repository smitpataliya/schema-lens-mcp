import { createHash } from "node:crypto";
import { ConfigError, ConnectionError, IntrospectionError } from "../core/errors.js";
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
import { redactCredentials } from "../util/redact.js";
import { filterTables } from "./adapter.js";

type OnAction = "cascade" | "set null" | "restrict" | "no action" | "set default";

function mapMysqlAction(action: string | null | undefined): OnAction | undefined {
  if (!action) return undefined;
  const upper = action.toUpperCase();
  switch (upper) {
    case "CASCADE":
      return "cascade";
    case "SET NULL":
      return "set null";
    case "RESTRICT":
      return "restrict";
    case "NO ACTION":
      return "no action";
    case "SET DEFAULT":
      return "set default";
    default:
      return undefined;
  }
}

export function parseMysqlEnumValues(columnType: string): string[] | null {
  const match = columnType.match(/^enum\s*\((.+)\)$/i);
  if (!match || !match[1]) {
    return null;
  }

  // Parses 'val1','val2','val\'3' safely
  const values: string[] = [];
  const regex = /'((?:\\.|[^'])*)'/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: regex exec iteration
  while ((m = regex.exec(match[1])) !== null) {
    if (m[1] !== undefined) {
      values.push(m[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\"));
    }
  }

  return values.length > 0 ? values : null;
}

export interface MysqlRawTable {
  schema: string;
  name: string;
  type: string;
  comment: string | null;
  estimated_rows: number | string | null;
}

export interface MysqlRawColumn {
  schema: string;
  table: string;
  attnum: number;
  name: string;
  type: string;
  nullable: string;
  default: string | null;
  extra: string | null;
  comment: string | null;
}

export interface MysqlRawConstraint {
  schema: string;
  table: string;
  name: string;
  type: string;
  column: string;
  ord: number;
  ref_schema: string | null;
  ref_table: string | null;
  ref_column: string | null;
  on_delete: string | null;
  on_update: string | null;
}

export interface MysqlRawIndex {
  schema: string;
  table: string;
  name: string;
  non_unique: number;
  method: string | null;
  column: string;
  seq: number;
}

export interface MysqlRawCheck {
  schema: string;
  table: string;
  name: string;
  clause: string;
}

export interface MysqlIntrospectionRawData {
  tables: MysqlRawTable[];
  columns: MysqlRawColumn[];
  constraints: MysqlRawConstraint[];
  indexes: MysqlRawIndex[];
  checks: MysqlRawCheck[];
}

export function parseMysqlCatalogData(
  databaseName: string,
  rawData: MysqlIntrospectionRawData,
  opts: IntrospectOptions = {},
): SchemaSnapshot {
  const tableMap = new Map<string, Table>();
  const enumMap = new Map<string, EnumType>();

  for (const t of rawData.tables) {
    const isView = t.type.toUpperCase() === "VIEW";
    if (!opts.includeViews && isView) {
      continue;
    }

    const key = `${t.schema}.${t.name}`;
    const table: Table = {
      schema: t.schema,
      name: t.name,
      kind: isView ? "view" : "table",
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

    const isNullable = c.nullable.toUpperCase() === "YES";
    const extra = (c.extra || "").toLowerCase();
    const isIdentity = extra.includes("auto_increment");
    const isGenerated = extra.includes("virtual") || extra.includes("stored");

    let colType = c.type;
    const enumValues = parseMysqlEnumValues(c.type);

    let enumRefName: string | undefined;
    if (enumValues) {
      enumRefName = `${c.table}_${c.name}_enum`;
      colType = enumRefName;
      enumMap.set(`${c.schema}.${enumRefName}`, {
        schema: c.schema,
        name: enumRefName,
        values: enumValues,
      });
    }

    const col: Column = {
      name: c.name,
      type: colType,
      nullable: isNullable,
    };

    if (c.default !== null && c.default !== undefined) {
      col.default = c.default;
    }
    if (isIdentity) {
      col.isIdentity = true;
    }
    if (isGenerated) {
      col.isGenerated = true;
    }
    if (enumRefName) {
      col.enumRef = enumRefName;
    }
    if (c.comment) {
      col.comment = c.comment;
    }

    table.columns.push(col);
  }

  // Group constraints
  const constraintGroups = new Map<string, MysqlRawConstraint[]>();
  for (const con of rawData.constraints) {
    const groupKey = `${con.schema}.${con.table}.${con.name}`;
    const list = constraintGroups.get(groupKey) ?? [];
    list.push(con);
    constraintGroups.set(groupKey, list);
  }

  for (const group of constraintGroups.values()) {
    const first = group[0];
    if (!first) continue;

    const table = tableMap.get(`${first.schema}.${first.table}`);
    if (!table) continue;

    group.sort((a, b) => a.ord - b.ord);
    const cols = group.map((g) => g.column);
    const typeUpper = first.type.toUpperCase();

    if (typeUpper === "PRIMARY KEY") {
      table.primaryKey = cols;
    } else if (typeUpper === "UNIQUE") {
      table.uniques.push(cols);
    } else if (typeUpper === "FOREIGN KEY") {
      const refCols = group.map((g) => g.ref_column ?? "").filter(Boolean);
      const fk: ForeignKey = {
        name: first.name,
        columns: cols,
        refSchema: first.ref_schema ?? table.schema,
        refTable: first.ref_table ?? "",
        refColumns: refCols,
      };
      const delAction = mapMysqlAction(first.on_delete);
      if (delAction) fk.onDelete = delAction;
      const updAction = mapMysqlAction(first.on_update);
      if (updAction) fk.onUpdate = updAction;
      table.foreignKeys.push(fk);
    }
  }

  // Group indexes
  const indexGroups = new Map<string, MysqlRawIndex[]>();
  for (const idx of rawData.indexes) {
    if (idx.name.toUpperCase() === "PRIMARY") {
      continue; // Skip primary key index
    }
    const groupKey = `${idx.schema}.${idx.table}.${idx.name}`;
    const list = indexGroups.get(groupKey) ?? [];
    list.push(idx);
    indexGroups.set(groupKey, list);
  }

  for (const group of indexGroups.values()) {
    const first = group[0];
    if (!first) continue;

    const table = tableMap.get(`${first.schema}.${first.table}`);
    if (!table) continue;

    group.sort((a, b) => a.seq - b.seq);
    const cols = group.map((g) => g.column);

    const indexObj: Index = {
      name: first.name,
      columns: cols,
      unique: Number(first.non_unique) === 0,
    };
    if (first.method && first.method.toUpperCase() !== "BTREE") {
      indexObj.method = first.method.toLowerCase();
    }
    table.indexes.push(indexObj);
  }

  // Group checks
  for (const chk of rawData.checks) {
    const table = tableMap.get(`${chk.schema}.${chk.table}`);
    if (!table) continue;

    const cleanClause = chk.clause
      .replace(/^\s*\(\s*/, "")
      .replace(/\s*\)\s*$/, "")
      .trim();
    table.checks.push(cleanClause || chk.clause);
  }

  let tables = Array.from(tableMap.values());
  tables = filterTables(tables, opts.includeTables, opts.excludeTables);

  const enums = Array.from(enumMap.values());

  const partialSnapshot: Omit<SchemaSnapshot, "hash" | "generatedAt"> = {
    version: 1,
    dialect: "mysql",
    databaseName,
    schemas: [databaseName],
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

export class MysqlAdapter implements DatabaseAdapter {
  public readonly dialect = "mysql" as const;
  private readonly connectionUrl: string;
  private pool: unknown = null;
  private databaseName = "";

  constructor(connectionUrl: string) {
    this.connectionUrl = connectionUrl;
    try {
      const parsed = new URL(connectionUrl);
      this.databaseName = parsed.pathname.replace(/^\//, "");
    } catch {
      this.databaseName = "";
    }
  }

  public async connect(): Promise<void> {
    if (this.pool) {
      return;
    }

    // Dynamic import of mysql2/promise
    // biome-ignore lint/suspicious/noExplicitAny: dynamic mysql2 import
    let mysql2Module: any;
    try {
      mysql2Module = await import("mysql2/promise");
    } catch {
      throw new ConnectionError("MySQL driver 'mysql2' is not installed. Please run: npm i mysql2");
    }

    try {
      const pool = mysql2Module.createPool({
        uri: this.connectionUrl,
        waitForConnections: true,
        connectionLimit: 4,
        connectTimeout: 5000,
      });

      // Verify connection and verify read-only session enforcement (fail-closed)
      const conn = await pool.getConnection();
      try {
        await conn.query("SET SESSION TRANSACTION READ ONLY;");
        const [rows] = (await conn.query(
          "SELECT @@session.transaction_read_only AS ro;",
        )) as unknown as [Array<{ ro: number | string | boolean }>];
        const roVal = rows?.[0]?.ro;
        if (roVal !== 1 && roVal !== "1" && roVal !== true) {
          throw new ConnectionError("Failed to enforce read-only transaction on MySQL connection.");
        }
      } finally {
        conn.release();
      }

      this.pool = pool;
    } catch (err) {
      const safeMsg = redactCredentials(err instanceof Error ? err.message : String(err));
      throw new ConnectionError(`MySQL connection failed: ${safeMsg}`, undefined, { cause: err });
    }
  }

  public async introspect(opts: IntrospectOptions = {}): Promise<SchemaSnapshot> {
    await this.connect();
    // biome-ignore lint/suspicious/noExplicitAny: mysql pool
    const pool = this.pool as any;

    let targetSchemas = opts.schemas;
    if (!targetSchemas || targetSchemas.length === 0) {
      if (this.databaseName) {
        targetSchemas = [this.databaseName];
      } else {
        throw new ConfigError(
          "MySQL connection URL does not specify a database name, and no schemas were provided via --schema.",
        );
      }
    }

    const conn = await pool.getConnection();
    try {
      await conn.query("SET SESSION TRANSACTION READ ONLY;");

      const qTables = conn.query(
        `
        SELECT TABLE_SCHEMA AS \`schema\`, TABLE_NAME AS \`name\`, TABLE_TYPE AS \`type\`,
               TABLE_COMMENT AS \`comment\`, TABLE_ROWS AS \`estimated_rows\`
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA IN (?)
        ORDER BY TABLE_NAME;
        `,
        [targetSchemas],
      );

      const qColumns = conn.query(
        `
        SELECT TABLE_SCHEMA AS \`schema\`, TABLE_NAME AS \`table\`, ORDINAL_POSITION AS \`attnum\`,
               COLUMN_NAME AS \`name\`, COLUMN_TYPE AS \`type\`, IS_NULLABLE AS \`nullable\`,
               COLUMN_DEFAULT AS \`default\`, EXTRA AS \`extra\`, COLUMN_COMMENT AS \`comment\`
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA IN (?)
        ORDER BY TABLE_NAME, ORDINAL_POSITION;
        `,
        [targetSchemas],
      );

      const qConstraints = conn.query(
        `
        SELECT tc.TABLE_SCHEMA AS \`schema\`, tc.TABLE_NAME AS \`table\`, tc.CONSTRAINT_NAME AS \`name\`,
               tc.CONSTRAINT_TYPE AS \`type\`, kcu.COLUMN_NAME AS \`column\`, kcu.ORDINAL_POSITION AS \`ord\`,
               kcu.REFERENCED_TABLE_SCHEMA AS \`ref_schema\`, kcu.REFERENCED_TABLE_NAME AS \`ref_table\`,
               kcu.REFERENCED_COLUMN_NAME AS \`ref_column\`,
               rc.DELETE_RULE AS \`on_delete\`, rc.UPDATE_RULE AS \`on_update\`
        FROM information_schema.TABLE_CONSTRAINTS tc
        JOIN information_schema.KEY_COLUMN_USAGE kcu
          ON tc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
         AND tc.TABLE_NAME = kcu.TABLE_NAME
         AND tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
        LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
          ON tc.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
         AND tc.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
        WHERE tc.TABLE_SCHEMA IN (?)
        ORDER BY tc.TABLE_NAME, tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION;
        `,
        [targetSchemas],
      );

      const qIndexes = conn.query(
        `
        SELECT TABLE_SCHEMA AS \`schema\`, TABLE_NAME AS \`table\`, INDEX_NAME AS \`name\`,
               NON_UNIQUE AS \`non_unique\`, INDEX_TYPE AS \`method\`, COLUMN_NAME AS \`column\`,
               SEQ_IN_INDEX AS \`seq\`
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA IN (?)
        ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;
        `,
        [targetSchemas],
      );

      // MySQL 8+ checks support (graceful fallback if older version)
      const qChecks = conn
        .query(
          `
        SELECT tc.TABLE_SCHEMA AS \`schema\`, tc.TABLE_NAME AS \`table\`, tc.CONSTRAINT_NAME AS \`name\`,
               cc.CHECK_CLAUSE AS \`clause\`
        FROM information_schema.TABLE_CONSTRAINTS tc
        JOIN information_schema.CHECK_CONSTRAINTS cc
          ON tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA
         AND tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
        WHERE tc.TABLE_SCHEMA IN (?) AND tc.CONSTRAINT_TYPE = 'CHECK'
        ORDER BY tc.TABLE_NAME, tc.CONSTRAINT_NAME;
        `,
          [targetSchemas],
        )
        // biome-ignore lint/suspicious/noExplicitAny: fallback for MySQL < 8.0
        .catch(() => [[] as any[]]);

      const [resTables, resColumns, resConstraints, resIndexes, resChecks] = await Promise.all([
        qTables,
        qColumns,
        qConstraints,
        qIndexes,
        qChecks,
      ]);

      const rawData: MysqlIntrospectionRawData = {
        tables: ((resTables as unknown as [unknown[]])[0] ?? []) as MysqlRawTable[],
        columns: ((resColumns as unknown as [unknown[]])[0] ?? []) as MysqlRawColumn[],
        constraints: ((resConstraints as unknown as [unknown[]])[0] ?? []) as MysqlRawConstraint[],
        indexes: ((resIndexes as unknown as [unknown[]])[0] ?? []) as MysqlRawIndex[],
        checks: ((resChecks as unknown as [unknown[]])[0] ?? []) as MysqlRawCheck[],
      };

      const primaryDbName = targetSchemas[0] || this.databaseName || "mysql";
      return parseMysqlCatalogData(primaryDbName, rawData, opts);
    } catch (err) {
      if (err instanceof ConfigError) {
        throw err;
      }
      const safeMsg = redactCredentials(err instanceof Error ? err.message : String(err));
      throw new IntrospectionError(`MySQL introspection failed: ${safeMsg}`, undefined, {
        cause: err,
      });
    } finally {
      conn.release();
    }
  }

  public async fingerprint(_opts: IntrospectOptions = {}): Promise<string> {
    await this.connect();
    // biome-ignore lint/suspicious/noExplicitAny: mysql pool
    const pool = this.pool as any;

    try {
      const [rows] = await pool.query(
        `
        SELECT COUNT(*) AS table_count, COALESCE(MAX(UPDATE_TIME), '0') AS max_update,
               COUNT(TABLE_ROWS) AS row_sum
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ?;
        `,
        [this.databaseName],
      );

      const summary = JSON.stringify(rows);
      return createHash("sha256").update(summary).digest("hex");
    } catch (err) {
      const safeMsg = redactCredentials(err instanceof Error ? err.message : String(err));
      throw new IntrospectionError(`MySQL fingerprint check failed: ${safeMsg}`, undefined, {
        cause: err,
      });
    }
  }

  public async close(): Promise<void> {
    if (this.pool) {
      // biome-ignore lint/suspicious/noExplicitAny: mysql pool
      const pool = this.pool as any;
      this.pool = null;
      await pool.end();
    }
  }
}
