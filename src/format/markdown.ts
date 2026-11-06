import type { SchemaSnapshot } from "../core/types.js";
import { renderFull } from "./compact.js";

/**
 * Renders the complete schema into schema.md format.
 */
export function renderMarkdown(snapshot: SchemaSnapshot, terse = false): string {
  return `${renderFull(snapshot, terse)}\n`;
}
