import { createHash } from "node:crypto";
import path from "node:path";
import { ConnectionError, IntrospectionError } from "../core/errors.js";
import type {
  Column,
  DatabaseAdapter,
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

function mapSqliteAction(action: string | null | undefined): OnAction | undefined {
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

export function extractSqliteFilePath(url: string): string {
  let cleaned = url.trim();
  if (cleaned.startsWith("sqlite://")) {
    cleaned = cleaned.replace(/^sqlite:\/\//, "");
  } else if (cleaned.startsWith("sqlite:")) {
    cleaned = cleaned.replace(/^sqlite:/, "");
  }

  // Strip query parameters if any
  const queryIdx = cleaned.indexOf("?");
  if (queryIdx !== -1) {
    cleaned = cleaned.slice(0, queryIdx);
  }

  return cleaned;
}

export function parseSqliteCheckConstraints(sql: string | null): string[] {
  if (!sql) return [];

  const checks: string[] = [];
  // Matches CHECK\s*\((.*?)\)(?=[,\n\r]|\s*\))
  const regex = /CHECK\s*\((.+?)\)(?=\s*[,)]|\s*$)/gis;
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: regex exec iteration
  while ((match = regex.exec(sql)) !== null) {
    if (match[1]) {
      const expr = match[1].trim();
      checks.push(expr);
    }
  }

  return checks;
}

export class SqliteAdapter implements DatabaseAdapter {
  public readonly dialect = "sqlite" as const;
  private readonly filePath: string;
  // biome-ignore lint/suspicious/noExplicitAny: better-sqlite3 database instance
  private db: any = null;
  private databaseName = "main";

  constructor(connectionUrl: string) {
    this.filePath = extractSqliteFilePath(connectionUrl);
    const basename = path.basename(this.filePath);
    this.databaseName = basename.replace(/\.(sqlite|db|sqlite3)$/i, "") || "main";
  }

  public async connect(): Promise<void> {
    if (this.db) {
      return;
    }

    // Dynamic import of better-sqlite3
    // biome-ignore lint/suspicious/noExplicitAny: dynamic better-sqlite3 import
    let DatabaseModule: any;
    try {
      DatabaseModule = await import("better-sqlite3");
    } catch {
      throw new ConnectionError(
        "SQLite driver 'better-sqlite3' is not installed. Please run: npm i better-sqlite3",
      );
    }

    const Database = DatabaseModule.default || DatabaseModule;
    if (!Database) {
      throw new ConnectionError("Failed to load Database constructor from better-sqlite3.");
    }

    try {
      // Open in read-only mode per Section 6.1
      const db = new Database(this.filePath, { readonly: true, fileMustExist: true });
      this.db = db;
    } catch (err) {
      const safeMsg = redactCredentials(err instanceof Error ? err.message : String(err));
      throw new ConnectionError(`SQLite connection failed: ${safeMsg}`, undefined, { cause: err });
    }
  }

  public async introspect(opts: IntrospectOptions = {}): Promise<SchemaSnapshot> {
    await this.connect();
    const db = this.db;

    try {
      const schemaRows = db
        .prepare(
          `SELECT name, type, sql FROM sqlite_schema
           WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
           ORDER BY name;`,
        )
        .all() as { name: string; type: string; sql: string | null }[];

      // Check if sqlite_stat1 exists for row estimates
      let hasStat1 = false;
      try {
        const checkStat = db
          .prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='sqlite_stat1';")
          .get();
        hasStat1 = Boolean(checkStat);
      } catch {
        hasStat1 = false;
      }

      const tables: Table[] = [];

      for (const row of schemaRows) {
        const isView = row.type === "view";
        if (!opts.includeViews && isView) {
          continue;
        }

        // 1. Columns & Primary Keys via pragma_table_xinfo
        const colRows = db.prepare("SELECT * FROM pragma_table_xinfo(?);").all(row.name) as {
          cid: number;
          name: string;
          type: string;
          notnull: number;
          dflt_value: string | null;
          pk: number;
          hidden: number;
        }[];

        const pkCols: { name: string; order: number }[] = [];
        const columns: Column[] = [];

        for (const c of colRows) {
          const col: Column = {
            name: c.name,
            type: c.type || "text",
            nullable: c.notnull === 0,
          };

          if (c.dflt_value !== null && c.dflt_value !== undefined) {
            col.default = c.dflt_value;
          }
          if (c.hidden === 2) {
            col.isGenerated = true;
          }
          if (c.pk > 0) {
            pkCols.push({ name: c.name, order: c.pk });
          }

          columns.push(col);
        }

        pkCols.sort((a, b) => a.order - b.order);
        const primaryKey = pkCols.map((p) => p.name);

        // 2. Foreign Keys via pragma_foreign_key_list
        const fkRows = db.prepare("SELECT * FROM pragma_foreign_key_list(?);").all(row.name) as {
          id: number;
          seq: number;
          table: string;
          from: string;
          to: string;
          on_update: string;
          on_delete: string;
        }[];

        const fkMap = new Map<number, typeof fkRows>();
        for (const fk of fkRows) {
          const list = fkMap.get(fk.id) ?? [];
          list.push(fk);
          fkMap.set(fk.id, list);
        }

        const foreignKeys: ForeignKey[] = [];
        for (const [id, fks] of fkMap) {
          fks.sort((a, b) => a.seq - b.seq);
          const first = fks[0];
          if (!first) continue;

          const fkObj: ForeignKey = {
            name: `${row.name}_fk_${id}`,
            columns: fks.map((f) => f.from),
            refSchema: "main",
            refTable: first.table,
            refColumns: fks.map((f) => f.to),
          };

          const delAction = mapSqliteAction(first.on_delete);
          if (delAction) fkObj.onDelete = delAction;
          const updAction = mapSqliteAction(first.on_update);
          if (updAction) fkObj.onUpdate = updAction;

          foreignKeys.push(fkObj);
        }

        // 3. Indexes & Uniques via pragma_index_list & pragma_index_info
        const idxRows = db.prepare("SELECT * FROM pragma_index_list(?);").all(row.name) as {
          seq: number;
          name: string;
          unique: number;
          origin: string;
          partial: number;
        }[];

        const uniques: string[][] = [];
        const indexes: Index[] = [];

        for (const idx of idxRows) {
          if (idx.origin === "pk") {
            continue; // Skip primary key index
          }

          const infoRows = db.prepare("SELECT * FROM pragma_index_info(?);").all(idx.name) as {
            seqno: number;
            cid: number;
            name: string;
          }[];

          infoRows.sort((a, b) => a.seqno - b.seqno);
          const cols = infoRows.map((i) => i.name);

          if (idx.origin === "u") {
            uniques.push(cols);
          } else {
            const indexObj: Index = {
              name: idx.name,
              columns: cols,
              unique: idx.unique === 1,
            };
            indexes.push(indexObj);
          }
        }

        // 4. Checks parsed from DDL
        const checks = parseSqliteCheckConstraints(row.sql);

        // 5. Estimated rows from sqlite_stat1 if available
        let estimatedRows: number | undefined;
        if (hasStat1) {
          try {
            const stat = db
              .prepare("SELECT stat FROM sqlite_stat1 WHERE tbl = ? AND idx IS NULL LIMIT 1;")
              .get(row.name) as { stat: string } | undefined;
            if (stat?.stat) {
              const rowsNum = Number.parseInt(stat.stat.split(" ")[0] ?? "", 10);
              if (!Number.isNaN(rowsNum)) {
                estimatedRows = rowsNum;
              }
            }
          } catch {
            // stat1 read optional
          }
        }

        const table: Table = {
          schema: "main",
          name: row.name,
          kind: isView ? "view" : "table",
          columns,
          primaryKey,
          uniques,
          foreignKeys,
          indexes,
          checks,
        };

        if (estimatedRows !== undefined) {
          table.estimatedRows = estimatedRows;
        }

        tables.push(table);
      }

      const filteredTables = filterTables(tables, opts.includeTables, opts.excludeTables);

      const partialSnapshot: Omit<SchemaSnapshot, "hash" | "generatedAt"> = {
        version: 1,
        dialect: "sqlite",
        databaseName: this.databaseName,
        schemas: ["main"],
        tables: filteredTables,
        enums: [],
      };

      const hash = computeSnapshotHash(partialSnapshot);

      return {
        ...partialSnapshot,
        hash,
        generatedAt: new Date().toISOString(),
      };
    } catch (err) {
      const safeMsg = redactCredentials(err instanceof Error ? err.message : String(err));
      throw new IntrospectionError(`SQLite introspection failed: ${safeMsg}`, undefined, {
        cause: err,
      });
    }
  }

  public async fingerprint(_opts: IntrospectOptions = {}): Promise<string> {
    await this.connect();
    const db = this.db;

    try {
      // PRAGMA schema_version increments on every DDL change in SQLite
      const versionRow = db.prepare("PRAGMA schema_version;").get() as {
        schema_version: number;
      };

      const schemaSummary = db
        .prepare("SELECT COUNT(*) AS c, SUM(LENGTH(sql)) AS s FROM sqlite_schema;")
        .get();

      const combined = `${versionRow.schema_version}:${JSON.stringify(schemaSummary)}`;
      return createHash("sha256").update(combined).digest("hex");
    } catch (err) {
      const safeMsg = redactCredentials(err instanceof Error ? err.message : String(err));
      throw new IntrospectionError(`SQLite fingerprint check failed: ${safeMsg}`, undefined, {
        cause: err,
      });
    }
  }

  public async close(): Promise<void> {
    if (this.db) {
      try {
        this.db.close();
      } finally {
        this.db = null;
      }
    }
  }
}
