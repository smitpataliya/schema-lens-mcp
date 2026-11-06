import { redactCredentials } from "./redact.js";

/**
 * Standard log function that always writes to stderr and redacts any credentials.
 * Preserves stdout for MCP stdio protocol and clean CLI output.
 */
export function log(...args: unknown[]): void {
  const formatted = args
    .map((arg) => (typeof arg === "string" ? redactCredentials(arg) : arg))
    .map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg)))
    .join(" ");
  process.stderr.write(`${formatted}\n`);
}

export function logError(...args: unknown[]): void {
  const formatted = args
    .map((arg) => (typeof arg === "string" ? redactCredentials(arg) : arg))
    .map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg)))
    .join(" ");
  process.stderr.write(`[ERROR] ${formatted}\n`);
}
