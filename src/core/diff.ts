import { formatTableName } from "../format/compact.js";
import type { Column, EnumType, ForeignKey, Index, SchemaSnapshot, Table } from "./types.js";

export interface ColumnDiff {
  name: string;
  oldType?: string | undefined;
  newType?: string | undefined;
  oldNullable?: boolean | undefined;
  newNullable?: boolean | undefined;
  oldDefault?: string | undefined;
  newDefault?: string | undefined;
}

export interface TableDiff {
  schema: string;
  name: string;
  kind: "added" | "removed" | "changed";
  addedColumns: Column[];
  removedColumns: Column[];
  changedColumns: ColumnDiff[];
  addedIndexes: Index[];
  removedIndexes: Index[];
  addedForeignKeys: ForeignKey[];
  removedForeignKeys: ForeignKey[];
  addedChecks: string[];
  removedChecks: string[];
  pkChanged?: { oldPk: string[]; newPk: string[] } | undefined;
}

export interface SchemaDiff {
  hasChanges: boolean;
  addedEnums: EnumType[];
  removedEnums: EnumType[];
  changedEnums: { schema: string; name: string; oldValues: string[]; newValues: string[] }[];
  tables: TableDiff[];
}

function compareColumns(oldCol: Column, newCol: Column): ColumnDiff | null {
  const changes: ColumnDiff = { name: oldCol.name };
  let hasDiff = false;

  if (oldCol.type !== newCol.type) {
    changes.oldType = oldCol.type;
    changes.newType = newCol.type;
    hasDiff = true;
  }
  if (oldCol.nullable !== newCol.nullable) {
    changes.oldNullable = oldCol.nullable;
    changes.newNullable = newCol.nullable;
    hasDiff = true;
  }
  if (oldCol.default !== newCol.default) {
    changes.oldDefault = oldCol.default;
    changes.newDefault = newCol.default;
    hasDiff = true;
  }

  return hasDiff ? changes : null;
}

export function diffSnapshots(prev: SchemaSnapshot | null, current: SchemaSnapshot): SchemaDiff {
  if (!prev) {
    // Treat everything as added
    const tables: TableDiff[] = current.tables.map((t) => ({
      schema: t.schema,
      name: t.name,
      kind: "added",
      addedColumns: t.columns,
      removedColumns: [],
      changedColumns: [],
      addedIndexes: t.indexes,
      removedIndexes: [],
      addedForeignKeys: t.foreignKeys,
      removedForeignKeys: [],
      addedChecks: t.checks,
      removedChecks: [],
    }));

    return {
      hasChanges: tables.length > 0 || current.enums.length > 0,
      addedEnums: current.enums,
      removedEnums: [],
      changedEnums: [],
      tables,
    };
  }

  if (prev.hash === current.hash) {
    return {
      hasChanges: false,
      addedEnums: [],
      removedEnums: [],
      changedEnums: [],
      tables: [],
    };
  }

  // Compare Enums
  const prevEnumMap = new Map<string, EnumType>();
  for (const e of prev.enums) {
    prevEnumMap.set(`${e.schema}.${e.name}`, e);
  }

  const currentEnumMap = new Map<string, EnumType>();
  for (const e of current.enums) {
    currentEnumMap.set(`${e.schema}.${e.name}`, e);
  }

  const addedEnums: EnumType[] = [];
  const removedEnums: EnumType[] = [];
  const changedEnums: SchemaDiff["changedEnums"] = [];

  for (const [key, curE] of currentEnumMap) {
    const prevE = prevEnumMap.get(key);
    if (!prevE) {
      addedEnums.push(curE);
    } else {
      const prevVals = prevE.values.join(",");
      const curVals = curE.values.join(",");
      if (prevVals !== curVals) {
        changedEnums.push({
          schema: curE.schema,
          name: curE.name,
          oldValues: prevE.values,
          newValues: curE.values,
        });
      }
    }
  }

  for (const [key, prevE] of prevEnumMap) {
    if (!currentEnumMap.has(key)) {
      removedEnums.push(prevE);
    }
  }

  // Compare Tables
  const prevTableMap = new Map<string, Table>();
  for (const t of prev.tables) {
    prevTableMap.set(`${t.schema}.${t.name}`, t);
  }

  const curTableMap = new Map<string, Table>();
  for (const t of current.tables) {
    curTableMap.set(`${t.schema}.${t.name}`, t);
  }

  const tables: TableDiff[] = [];

  // Check added & changed
  for (const [key, curT] of curTableMap) {
    const prevT = prevTableMap.get(key);
    if (!prevT) {
      tables.push({
        schema: curT.schema,
        name: curT.name,
        kind: "added",
        addedColumns: curT.columns,
        removedColumns: [],
        changedColumns: [],
        addedIndexes: curT.indexes,
        removedIndexes: [],
        addedForeignKeys: curT.foreignKeys,
        removedForeignKeys: [],
        addedChecks: curT.checks,
        removedChecks: [],
      });
      continue;
    }

    // Compare columns
    const prevColMap = new Map(prevT.columns.map((c) => [c.name, c]));
    const curColMap = new Map(curT.columns.map((c) => [c.name, c]));

    const addedColumns = curT.columns.filter((c) => !prevColMap.has(c.name));
    const removedColumns = prevT.columns.filter((c) => !curColMap.has(c.name));
    const changedColumns: ColumnDiff[] = [];

    for (const [colName, curCol] of curColMap) {
      const prevCol = prevColMap.get(colName);
      if (prevCol) {
        const diff = compareColumns(prevCol, curCol);
        if (diff) {
          changedColumns.push(diff);
        }
      }
    }

    // Compare Primary Key
    let pkChanged: { oldPk: string[]; newPk: string[] } | undefined;
    if (prevT.primaryKey.join(",") !== curT.primaryKey.join(",")) {
      pkChanged = { oldPk: prevT.primaryKey, newPk: curT.primaryKey };
    }

    // Compare Foreign Keys
    const prevFkMap = new Map(prevT.foreignKeys.map((fk) => [fk.name, fk]));
    const curFkMap = new Map(curT.foreignKeys.map((fk) => [fk.name, fk]));

    const addedForeignKeys = curT.foreignKeys.filter((fk) => !prevFkMap.has(fk.name));
    const removedForeignKeys = prevT.foreignKeys.filter((fk) => !curFkMap.has(fk.name));

    // Compare Indexes
    const prevIdxMap = new Map(prevT.indexes.map((i) => [i.name, i]));
    const curIdxMap = new Map(curT.indexes.map((i) => [i.name, i]));

    const addedIndexes = curT.indexes.filter((i) => !prevIdxMap.has(i.name));
    const removedIndexes = prevT.indexes.filter((i) => !curIdxMap.has(i.name));

    // Compare Checks
    const prevCheckSet = new Set(prevT.checks);
    const curCheckSet = new Set(curT.checks);

    const addedChecks = curT.checks.filter((c) => !prevCheckSet.has(c));
    const removedChecks = prevT.checks.filter((c) => !curCheckSet.has(c));

    const isChanged =
      addedColumns.length > 0 ||
      removedColumns.length > 0 ||
      changedColumns.length > 0 ||
      pkChanged !== undefined ||
      addedForeignKeys.length > 0 ||
      removedForeignKeys.length > 0 ||
      addedIndexes.length > 0 ||
      removedIndexes.length > 0 ||
      addedChecks.length > 0 ||
      removedChecks.length > 0;

    if (isChanged) {
      tables.push({
        schema: curT.schema,
        name: curT.name,
        kind: "changed",
        addedColumns,
        removedColumns,
        changedColumns,
        addedIndexes,
        removedIndexes,
        addedForeignKeys,
        removedForeignKeys,
        addedChecks,
        removedChecks,
        pkChanged,
      });
    }
  }

  // Check removed tables
  for (const [key, prevT] of prevTableMap) {
    if (!curTableMap.has(key)) {
      tables.push({
        schema: prevT.schema,
        name: prevT.name,
        kind: "removed",
        addedColumns: [],
        removedColumns: prevT.columns,
        changedColumns: [],
        addedIndexes: [],
        removedIndexes: prevT.indexes,
        addedForeignKeys: [],
        removedForeignKeys: prevT.foreignKeys,
        addedChecks: [],
        removedChecks: prevT.checks,
      });
    }
  }

  const hasChanges =
    tables.length > 0 ||
    addedEnums.length > 0 ||
    removedEnums.length > 0 ||
    changedEnums.length > 0;

  return {
    hasChanges,
    addedEnums,
    removedEnums,
    changedEnums,
    tables,
  };
}

export function formatDiff(diff: SchemaDiff): string {
  if (!diff.hasChanges) {
    return "no changes";
  }

  const lines: string[] = [];

  // Enums
  for (const e of diff.addedEnums) {
    const name = formatTableName(e.schema, e.name);
    lines.push(`+ enum ${name}: ${e.values.join("|")}`);
  }
  for (const e of diff.removedEnums) {
    const name = formatTableName(e.schema, e.name);
    lines.push(`- enum ${name}`);
  }
  for (const e of diff.changedEnums) {
    const name = formatTableName(e.schema, e.name);
    lines.push(`~ enum ${name}: [${e.oldValues.join("|")}] -> [${e.newValues.join("|")}]`);
  }

  // Tables
  for (const t of diff.tables) {
    const tableName = formatTableName(t.schema, t.name);

    if (t.kind === "added") {
      lines.push(`+ table ${tableName} (${t.addedColumns.length} cols)`);
      continue;
    }

    if (t.kind === "removed") {
      lines.push(`- table ${tableName}`);
      continue;
    }

    // Changed table
    lines.push(`~ table ${tableName}`);

    for (const c of t.addedColumns) {
      lines.push(`  + col ${c.name} ${c.type}${c.nullable ? "?" : ""}`);
    }
    for (const c of t.removedColumns) {
      lines.push(`  - col ${c.name}`);
    }
    for (const c of t.changedColumns) {
      const parts: string[] = [];
      if (c.oldType !== undefined && c.newType !== undefined) {
        parts.push(`type: ${c.oldType} -> ${c.newType}`);
      }
      if (c.oldNullable !== undefined && c.newNullable !== undefined) {
        parts.push(`nullable: ${c.oldNullable} -> ${c.newNullable}`);
      }
      if (c.oldDefault !== undefined || c.newDefault !== undefined) {
        parts.push(`default: ${c.oldDefault ?? "none"} -> ${c.newDefault ?? "none"}`);
      }
      lines.push(`  ~ col ${c.name}: ${parts.join(", ")}`);
    }

    if (t.pkChanged) {
      lines.push(`  ~ pk: (${t.pkChanged.oldPk.join(", ")}) -> (${t.pkChanged.newPk.join(", ")})`);
    }

    for (const fk of t.addedForeignKeys) {
      const ref = formatTableName(fk.refSchema, fk.refTable);
      lines.push(`  + fk (${fk.columns.join(", ")}) -> ${ref}(${fk.refColumns.join(", ")})`);
    }
    for (const fk of t.removedForeignKeys) {
      lines.push(`  - fk ${fk.name}`);
    }

    for (const idx of t.addedIndexes) {
      lines.push(`  + idx (${idx.columns.join(", ")})${idx.unique ? " uniq" : ""}`);
    }
    for (const idx of t.removedIndexes) {
      lines.push(`  - idx ${idx.name}`);
    }

    for (const chk of t.addedChecks) {
      lines.push(`  + check: ${chk}`);
    }
    for (const chk of t.removedChecks) {
      lines.push(`  - check: ${chk}`);
    }
  }

  return lines.join("\n");
}
