/**
 * Computes Levenshtein distance between two strings using O(min(m, n)) space.
 */
export function levenshtein(a: string, b: string): number {
  const an = a.length;
  const bn = b.length;
  if (an === 0) return bn;
  if (bn === 0) return an;

  let prev = Array.from({ length: bn + 1 }, (_, i) => i);
  const curr = new Array<number>(bn + 1).fill(0);

  for (let i = 1; i <= an; i++) {
    curr[0] = i;
    for (let j = 1; j <= bn; j++) {
      if (a.charAt(i - 1) === b.charAt(j - 1)) {
        curr[j] = prev[j - 1] ?? 0;
      } else {
        const sub = (prev[j - 1] ?? 0) + 1;
        const ins = (curr[j - 1] ?? 0) + 1;
        const del = (prev[j] ?? 0) + 1;
        curr[j] = Math.min(sub, ins, del);
      }
    }
    prev = [...curr];
  }

  return prev[bn] ?? 0;
}

/**
 * Finds table names with Levenshtein distance <= maxDistance.
 */
export function findSimilarTableNames(
  input: string,
  allTables: string[],
  maxDistance = 2,
): string[] {
  const normalizedInput = input.toLowerCase();
  const matches: { name: string; dist: number }[] = [];

  for (const table of allTables) {
    const dist = levenshtein(normalizedInput, table.toLowerCase());
    if (dist <= maxDistance) {
      matches.push({ name: table, dist });
    }
  }

  matches.sort((a, b) => a.dist - b.dist);
  return matches.map((m) => m.name);
}
