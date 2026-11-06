/**
 * Strips passwords and sensitive credentials from strings, URLs, and error messages.
 */

const URL_PASSWORD_REGEX = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^:/@\s]+):([^@\s]+)@/g;
const URL_NO_USER_PASSWORD_REGEX = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/):([^@\s]+)@/g;
const QUERY_PASSWORD_REGEX = /([?&](?:password|pwd|secret)=)[^&#\s]*/gi;
const KV_PASSWORD_REGEX = /\b(password|pwd|secret)\s*=\s*['"]?[^'";\s&?#]+['"]?/gi;

export function redactCredentials(input: string): string {
  if (!input) {
    return input;
  }

  return input
    .replace(URL_PASSWORD_REGEX, "$1$2:***@")
    .replace(URL_NO_USER_PASSWORD_REGEX, "$1:***@")
    .replace(QUERY_PASSWORD_REGEX, "$1***")
    .replace(KV_PASSWORD_REGEX, "$1=***");
}

/**
 * Creates a safe, non-sensitive connection label for metadata display (e.g. "postgres://localhost/shop").
 */
export function createConnectionLabel(rawUrl: string): string {
  if (!rawUrl) {
    return "unknown";
  }

  // Handle SQLite file paths directly
  if (rawUrl.startsWith("sqlite:")) {
    return rawUrl;
  }

  try {
    const parsed = new URL(rawUrl);
    const host = parsed.host;
    const pathname = parsed.pathname;
    const protocol = parsed.protocol;
    return `${protocol}//${host}${pathname}`;
  } catch {
    // If URL parsing fails, redact any passwords in text
    return redactCredentials(rawUrl);
  }
}
