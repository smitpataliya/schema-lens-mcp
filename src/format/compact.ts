import type { ForeignKey, SchemaSnapshot, Table } from "../core/types.js";

/**
 * Returns schema-qualified table name if not in default schema ("public", "main", or target database name).
 */
export function formatTableName(schema: string, name: string, defaultSchema?: string): string {
  if (
    schema === "public" ||
    schema === "main" ||
    !schema ||
    (defaultSchema !== undefined && schema === defaultSchema)
  ) {
    return name;
  }
  return `${schema}.${name}`;
}

export function formatRefTableName(
  refSchema: string,
  refTable: string,
  currentSchema: string,
  defaultSchema?: string,
): string {
  if (
    refSchema === currentSchema ||
    refSchema === "public" ||
    refSchema === "main" ||
    !refSchema ||
    (defaultSchema !== undefined && refSchema === defaultSchema)
  ) {
    return refTable;
  }
  return `${refSchema}.${refTable}`;
}

export function formatApproxRows(rows?: number): string {
  if (rows === undefined || rows === null) {
    return "";
  }
  if (rows >= 1_000_000) {
    const val = (rows / 1_000_000).toFixed(1).replace(/\.0$/, "");
    return `~${val}M`;
  }
  if (rows >= 1_000) {
    const val = (rows / 1_000).toFixed(1).replace(/\.0$/, "");
    return `~${val}k`;
  }
  return `~${rows}`;
}

function renderTableBlock(table: Table, terse = false, defaultSchema?: string): string {
  const lines: string[] = [];
  const displayName = formatTableName(table.schema, table.name, defaultSchema);

  // Table header line
  let tableHeader = `table ${displayName}`;
  if (table.kind === "view") {
    tableHeader += " (view)";
  } else if (table.kind === "materialized_view") {
    tableHeader += " (materialized view)";
  } else if (table.estimatedRows !== undefined && table.estimatedRows !== null) {
    tableHeader += `  ~${table.estimatedRows} rows`;
  }

  if (table.comment) {
    tableHeader += `  -- ${table.comment}`;
  }
  lines.push(tableHeader);

  // Primary key mapping
  const isCompositePk = table.primaryKey.length > 1;
  const pkSet = new Set(table.primaryKey);

  // Single-column unique constraints mapping
  const singleColUniqs = new Set<string>();
  const compositeUniqs: string[][] = [];

  for (const u of table.uniques) {
    if (u.length === 1 && u[0]) {
      singleColUniqs.add(u[0]);
    } else if (u.length > 1) {
      compositeUniqs.push(u);
    }
  }

  // Foreign keys mapping: single-col vs composite
  const singleColFk = new Map<string, ForeignKey>();
  const compositeFks: ForeignKey[] = [];

  for (const fk of table.foreignKeys) {
    if (fk.columns.length === 1 && fk.refColumns.length === 1 && fk.columns[0]) {
      // If multiple single FKs on same column, save first or map
      if (!singleColFk.has(fk.columns[0])) {
        singleColFk.set(fk.columns[0], fk);
      } else {
        compositeFks.push(fk);
      }
    } else {
      compositeFks.push(fk);
    }
  }

  // Render columns
  for (const col of table.columns) {
    let colLine = `  ${col.name} ${col.type}`;
    if (col.nullable) {
      colLine += "?";
    }

    if (!isCompositePk && pkSet.has(col.name)) {
      colLine += " pk";
    }

    if (col.isIdentity) {
      colLine += " identity";
    }

    if (singleColUniqs.has(col.name) && !(pkSet.has(col.name) && !isCompositePk)) {
      colLine += " uniq";
    }

    const fk = singleColFk.get(col.name);
    if (fk?.refColumns[0]) {
      const refT = formatRefTableName(fk.refSchema, fk.refTable, table.schema, defaultSchema);
      colLine += ` fk->${refT}.${fk.refColumns[0]}`;
      if (fk.onDelete) {
        colLine += ` on delete ${fk.onDelete}`;
      }
      if (fk.onUpdate) {
        colLine += ` on update ${fk.onUpdate}`;
      }
    }

    if (col.default !== undefined && col.default !== null) {
      if (!terse || !col.default.includes("nextval")) {
        colLine += ` default ${col.default}`;
      }
    }

    if (col.comment) {
      colLine += `  -- ${col.comment}`;
    }

    lines.push(colLine);
  }

  // Composite PK
  if (isCompositePk) {
    lines.push(`  pk: (${table.primaryKey.join(", ")})`);
  }

  // Composite Uniques
  for (const u of compositeUniqs) {
    lines.push(`  uniq: (${u.join(", ")})`);
  }

  // Composite FKs
  for (const fk of compositeFks) {
    const refT = formatRefTableName(fk.refSchema, fk.refTable, table.schema, defaultSchema);
    let fkLine = `  fk: (${fk.columns.join(", ")}) -> ${refT}(${fk.refColumns.join(", ")})`;
    if (fk.onDelete) {
      fkLine += ` on delete ${fk.onDelete}`;
    }
    if (fk.onUpdate) {
      fkLine += ` on update ${fk.onUpdate}`;
    }
    lines.push(fkLine);
  }

  // Indexes
  if (table.indexes.length > 0) {
    const idxParts: string[] = [];
    for (const idx of table.indexes) {
      let part = `(${idx.columns.join(", ")})`;
      if (idx.unique) {
        part += " uniq";
      }
      if (idx.where) {
        part += ` where ${idx.where}`;
      }
      idxParts.push(part);
    }
    lines.push(`  idx: ${idxParts.join("; ")}`);
  }

  // Checks
  for (const chk of table.checks) {
    lines.push(`  check: ${chk}`);
  }

  return lines.join("\n");
}

export interface OverviewMeta {
  hash?: string | undefined;
  ageSeconds?: number | undefined;
  offset?: number | undefined;
  limit?: number | undefined;
}

export function renderOverview(snapshot: SchemaSnapshot, meta?: OverviewMeta): string {
  const lines: string[] = [];
  const defaultSchema = snapshot.dialect === "mysql" ? snapshot.databaseName : "public";

  let header = `# ${snapshot.dialect} ${snapshot.databaseName} | ${snapshot.tables.length} tables`;
  if (meta?.hash) {
    header += ` | hash: ${meta.hash.slice(0, 8)}`;
  }
  if (meta?.ageSeconds !== undefined) {
    header += ` | age: ${meta.ageSeconds}s`;
  }
  lines.push(header);

  const sortedTables = [...snapshot.tables].sort((a, b) => {
    const nameA = formatTableName(a.schema, a.name, defaultSchema);
    const nameB = formatTableName(b.schema, b.name, defaultSchema);
    return nameA.localeCompare(nameB);
  });

  const total = sortedTables.length;
  const offset = meta?.offset ?? 0;
  const limit = meta?.limit;

  const paginatedTables =
    limit !== undefined || offset > 0
      ? sortedTables.slice(offset, offset + (limit ?? sortedTables.length))
      : sortedTables;

  for (const table of paginatedTables) {
    const displayName = formatTableName(table.schema, table.name, defaultSchema);
    const colCount = `${table.columns.length} cols`;

    let info = colCount;
    if (table.kind === "view") {
      info += ", view";
    } else if (table.kind === "materialized_view") {
      info += ", mat_view";
    } else if (table.estimatedRows !== undefined && table.estimatedRows !== null) {
      info += `, ${formatApproxRows(table.estimatedRows)}`;
    }

    let line = `${displayName}(${info})`;

    // FK edges to referenced tables
    const refTables = new Set<string>();
    for (const fk of table.foreignKeys) {
      if (fk.refTable) {
        refTables.add(formatRefTableName(fk.refSchema, fk.refTable, table.schema, defaultSchema));
      }
    }

    if (refTables.size > 0) {
      line += ` -> ${Array.from(refTables).sort().join(", ")}`;
    }

    lines.push(line);
  }

  if (paginatedTables.length < total) {
    const nextOffset = offset + paginatedTables.length;
    lines.push("");
    lines.push(
      `[Showing tables ${offset + 1}-${nextOffset} of ${total}. Use offset=${nextOffset} to view next page]`,
    );
  }

  return lines.join("\n");
}

export function renderDetail(
  snapshot: SchemaSnapshot,
  tableNames: string[],
  terse = false,
): string {
  const defaultSchema = snapshot.dialect === "mysql" ? snapshot.databaseName : "public";
  const lookup = new Map<string, Table>();
  for (const t of snapshot.tables) {
    lookup.set(t.name.toLowerCase(), t);
    lookup.set(`${t.schema}.${t.name}`.toLowerCase(), t);
  }

  const renderedBlocks: string[] = [];
  for (const rawName of tableNames) {
    const table = lookup.get(rawName.toLowerCase());
    if (table) {
      renderedBlocks.push(renderTableBlock(table, terse, defaultSchema));
    }
  }

  return renderedBlocks.join("\n\n");
}

export function renderFull(snapshot: SchemaSnapshot, terse = false): string {
  const lines: string[] = [];
  const defaultSchema = snapshot.dialect === "mysql" ? snapshot.databaseName : "public";
  const hash8 = snapshot.hash.slice(0, 8);
  lines.push(
    `# ${snapshot.dialect} ${snapshot.databaseName} | ${snapshot.tables.length} tables | ${hash8} | ${snapshot.generatedAt}`,
  );
  lines.push("");

  // Enums
  if (snapshot.enums.length > 0) {
    const sortedEnums = [...snapshot.enums].sort((a, b) =>
      `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`),
    );
    for (const e of sortedEnums) {
      const enumName = formatTableName(e.schema, e.name, defaultSchema);
      lines.push(`[enum] ${enumName}: ${e.values.join("|")}`);
    }
    lines.push("");
  }

  // Tables
  const sortedTables = [...snapshot.tables].sort((a, b) => {
    const nameA = formatTableName(a.schema, a.name, defaultSchema);
    const nameB = formatTableName(b.schema, b.name, defaultSchema);
    return nameA.localeCompare(nameB);
  });

  const tableBlocks = sortedTables.map((t) => renderTableBlock(t, terse, defaultSchema));
  lines.push(tableBlocks.join("\n\n"));

  return lines.join("\n").trim();
}

export function renderCompact(
  snapshot: SchemaSnapshot,
  level: "overview" | "detail" | "full" = "full",
  options: { tables?: string[]; terse?: boolean } = {},
): string {
  switch (level) {
    case "overview":
      return renderOverview(snapshot);
    case "detail":
      return renderDetail(snapshot, options.tables ?? [], options.terse ?? false);
    case "full":
      return renderFull(snapshot, options.terse ?? false);
  }
}
