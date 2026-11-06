import { formatTableName } from "../format/compact.js";
import { findSimilarTableNames } from "../util/fuzzy.js";
import { AmbiguousTableError, TableNotFoundError } from "./errors.js";
import type { SchemaSnapshot, Table } from "./types.js";

export interface JoinStep {
  fromTable: string;
  toTable: string;
  condition: string;
}

export interface JoinPathResult {
  found: boolean;
  from: string;
  to: string;
  hops: number;
  steps: JoinStep[];
  allPaths?: JoinStep[][];
  formatted: string;
}

interface Edge {
  targetTable: string;
  condition: string;
}

export class SchemaGraph {
  private tables = new Map<string, Table>();
  private displayNames = new Map<string, string>();
  private simpleNameToDisplays = new Map<string, Set<string>>();
  private adjacency = new Map<string, Edge[]>();
  private defaultSchema?: string;

  constructor(snapshot: SchemaSnapshot) {
    this.defaultSchema = snapshot.dialect === "mysql" ? snapshot.databaseName : "public";
    this.build(snapshot);
  }

  private build(snapshot: SchemaSnapshot): void {
    for (const table of snapshot.tables) {
      const displayName = formatTableName(table.schema, table.name, this.defaultSchema);
      const fullName = `${table.schema}.${table.name}`;
      const lowerDisplay = displayName.toLowerCase();
      const lowerFull = fullName.toLowerCase();
      const lowerSimple = table.name.toLowerCase();

      this.tables.set(lowerDisplay, table);
      this.tables.set(lowerFull, table);
      this.displayNames.set(lowerDisplay, displayName);
      this.displayNames.set(lowerFull, displayName);

      const simpleSet = this.simpleNameToDisplays.get(lowerSimple) ?? new Set<string>();
      simpleSet.add(fullName);
      this.simpleNameToDisplays.set(lowerSimple, simpleSet);

      if (!this.adjacency.has(displayName)) {
        this.adjacency.set(displayName, []);
      }
    }

    // Build undirected edges from foreign keys
    for (const table of snapshot.tables) {
      const childName = formatTableName(table.schema, table.name, this.defaultSchema);

      for (const fk of table.foreignKeys) {
        const parentName = formatTableName(fk.refSchema, fk.refTable, this.defaultSchema);
        if (!this.adjacency.has(parentName)) {
          this.adjacency.set(parentName, []);
        }

        const conditions: string[] = [];
        for (let i = 0; i < fk.columns.length; i++) {
          const childCol = fk.columns[i];
          const parentCol = fk.refColumns[i];
          if (childCol && parentCol) {
            conditions.push(`${childName}.${childCol} = ${parentName}.${parentCol}`);
          }
        }

        const conditionStr = conditions.join(" AND ");

        // Child -> Parent edge
        this.adjacency.get(childName)?.push({
          targetTable: parentName,
          condition: conditionStr,
        });

        // Parent -> Child edge (undirected)
        this.adjacency.get(parentName)?.push({
          targetTable: childName,
          condition: conditionStr,
        });
      }
    }
  }

  public resolveTableName(name: string): string {
    const lower = name.toLowerCase();

    // 1. Check if name is an unqualified simple name matching multiple tables
    const simpleMatches = this.simpleNameToDisplays.get(lower);
    if (simpleMatches && simpleMatches.size > 1) {
      throw new AmbiguousTableError(
        `Table name "${name}" is ambiguous. Matching candidates: ${Array.from(simpleMatches).join(", ")}. Specify schema-qualified name (e.g. "schema.table").`,
      );
    }

    // 2. Direct qualified or display name match
    const exact = this.displayNames.get(lower);
    if (exact) {
      return exact;
    }

    // 3. Single simple name match
    if (simpleMatches && simpleMatches.size === 1) {
      const resolved = Array.from(simpleMatches)[0];
      if (resolved) {
        return this.displayNames.get(resolved.toLowerCase()) ?? resolved;
      }
    }

    // 4. Not found -> fuzzy search
    const allNames = Array.from(new Set(this.displayNames.values()));
    const suggestions = findSimilarTableNames(name, allNames, 2);
    throw new TableNotFoundError(name, suggestions);
  }

  public findJoinPath(fromInput: string, toInput: string, maxHops = 4): JoinPathResult {
    const from = this.resolveTableName(fromInput);
    const to = this.resolveTableName(toInput);

    if (from === to) {
      return {
        found: true,
        from,
        to,
        hops: 0,
        steps: [],
        formatted: `Source and target tables are the same: ${from}`,
      };
    }

    // BFS queue: current table, accumulated steps, set of visited tables in this path
    const queue: { current: string; steps: JoinStep[]; pathVisited: Set<string> }[] = [
      { current: from, steps: [], pathVisited: new Set<string>([from]) },
    ];

    let minFoundHops: number | null = null;
    const foundPaths: JoinStep[][] = [];

    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;

      const { current, steps, pathVisited } = item;

      // Do not explore beyond minimal found distance
      if (minFoundHops !== null && steps.length >= minFoundHops) {
        continue;
      }

      if (steps.length >= maxHops) {
        continue;
      }

      const neighbors = this.adjacency.get(current) ?? [];

      for (const edge of neighbors) {
        // Prevent cycle within the same path
        if (pathVisited.has(edge.targetTable)) {
          continue;
        }

        const newStep: JoinStep = {
          fromTable: current,
          toTable: edge.targetTable,
          condition: edge.condition,
        };

        const newSteps = [...steps, newStep];

        if (edge.targetTable === to) {
          if (minFoundHops === null) {
            minFoundHops = newSteps.length;
          }
          if (newSteps.length === minFoundHops) {
            foundPaths.push(newSteps);
          }
        } else {
          const nextVisited = new Set(pathVisited);
          nextVisited.add(edge.targetTable);
          queue.push({
            current: edge.targetTable,
            steps: newSteps,
            pathVisited: nextVisited,
          });
        }
      }
    }

    if (foundPaths.length === 1 && foundPaths[0]) {
      const firstPath = foundPaths[0];
      const formatted = firstPath
        .map((s) => `${s.fromTable} -> ${s.toTable}: ${s.condition}`)
        .join("\n");

      return {
        found: true,
        from,
        to,
        hops: firstPath.length,
        steps: firstPath,
        allPaths: foundPaths,
        formatted,
      };
    }

    if (foundPaths.length > 1) {
      const pathBlocks = foundPaths.map((p, idx) => {
        const stepLines = p
          .map((s) => `  ${s.fromTable} -> ${s.toTable}: ${s.condition}`)
          .join("\n");
        return `Option ${idx + 1} (${p.length} hop${p.length > 1 ? "s" : ""}):\n${stepLines}`;
      });

      return {
        found: true,
        from,
        to,
        hops: foundPaths[0]?.length ?? 1,
        steps: foundPaths[0] ?? [],
        allPaths: foundPaths,
        formatted: pathBlocks.join("\n\n"),
      };
    }

    return {
      found: false,
      from,
      to,
      hops: 0,
      steps: [],
      formatted: `No join path found between "${from}" and "${to}" within ${maxHops} hops.`,
    };
  }

  public getDirectNeighbors(tableInput: string): { incoming: string[]; outgoing: string[] } {
    const tableName = this.resolveTableName(tableInput);
    const targetTable = this.tables.get(tableName.toLowerCase());
    if (!targetTable) {
      return { incoming: [], outgoing: [] };
    }

    const outgoing = new Set<string>();
    for (const fk of targetTable.foreignKeys) {
      outgoing.add(formatTableName(fk.refSchema, fk.refTable, this.defaultSchema));
    }

    const incoming = new Set<string>();
    for (const other of this.tables.values()) {
      const otherName = formatTableName(other.schema, other.name, this.defaultSchema);
      if (otherName === tableName) continue;
      for (const fk of other.foreignKeys) {
        const parentName = formatTableName(fk.refSchema, fk.refTable, this.defaultSchema);
        if (parentName === tableName) {
          incoming.add(otherName);
        }
      }
    }

    return {
      incoming: Array.from(incoming).sort(),
      outgoing: Array.from(outgoing).sort(),
    };
  }
}

export function findJoinPath(
  snapshot: SchemaSnapshot,
  from: string,
  to: string,
  maxHops = 4,
): JoinPathResult {
  const graph = new SchemaGraph(snapshot);
  return graph.findJoinPath(from, to, maxHops);
}
