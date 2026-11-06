export type Dialect = "postgres" | "mysql" | "sqlite";

export interface SchemaSnapshot {
  version: 1;
  dialect: Dialect;
  databaseName: string;
  generatedAt: string; // ISO timestamp
  hash: string; // sha256 of canonical content
  schemas: string[]; // included schemas
  tables: Table[];
  enums: EnumType[];
}

export interface Table {
  schema: string; // e.g. "public" ("main" for sqlite)
  name: string;
  kind: "table" | "view" | "materialized_view" | "partitioned";
  comment?: string;
  columns: Column[];
  primaryKey: string[]; // column names, ordered
  uniques: string[][]; // each unique constraint's column names
  foreignKeys: ForeignKey[];
  indexes: Index[];
  checks: string[]; // raw check expressions
  estimatedRows?: number; // from catalog stats only, never COUNT(*)
}

export interface Column {
  name: string;
  type: string; // e.g. "uuid", "varchar(255)", "numeric(10,2)"
  nullable: boolean;
  default?: string;
  isIdentity?: boolean;
  isGenerated?: boolean;
  enumRef?: string; // name of enum type, if any
  comment?: string;
}

export interface ForeignKey {
  name: string;
  columns: string[];
  refSchema: string;
  refTable: string;
  refColumns: string[];
  onDelete?: "cascade" | "set null" | "restrict" | "no action" | "set default";
  onUpdate?: "cascade" | "set null" | "restrict" | "no action" | "set default";
}

export interface Index {
  name: string;
  columns: string[];
  unique: boolean;
  method?: string; // btree, gin, ...
  where?: string; // partial index predicate
}

export interface EnumType {
  schema: string;
  name: string;
  values: string[];
}

export interface DatabaseAdapter {
  readonly dialect: Dialect;
  connect(): Promise<void>;
  introspect(opts: IntrospectOptions): Promise<SchemaSnapshot>;
  fingerprint(opts: IntrospectOptions): Promise<string>;
  close(): Promise<void>;
}

export interface IntrospectOptions {
  schemas?: string[] | undefined;
  includeViews?: boolean | undefined;
  includeTables?: string[] | undefined;
  excludeTables?: string[] | undefined;
}

export interface SchemaLensConfig {
  connectionUrl?: string;
  envVar?: string;
  schemas?: string[];
  exclude?: string[];
  includeTables?: string[];
  includeViews?: boolean;
  ttlSeconds?: number;
  outDir?: string;
  terse?: boolean;
}
