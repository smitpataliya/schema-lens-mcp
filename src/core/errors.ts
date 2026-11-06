export abstract class SchemaLensError extends Error {
  public abstract readonly exitCode: number;
  public readonly userMessage: string;

  constructor(message: string, userMessage?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.userMessage = userMessage ?? message;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ConfigError extends SchemaLensError {
  public readonly exitCode = 2;
}

export class ConnectionError extends SchemaLensError {
  public readonly exitCode = 3;
}

export class IntrospectionError extends SchemaLensError {
  public readonly exitCode = 1;
}

export class TableNotFoundError extends SchemaLensError {
  public readonly exitCode = 1;
  public readonly tableName: string;
  public readonly suggestions: string[];

  constructor(tableName: string, suggestions: string[] = []) {
    const suggestionText =
      suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}?` : "";
    const msg = `Table "${tableName}" not found.${suggestionText}`;
    super(msg, msg);
    this.tableName = tableName;
    this.suggestions = suggestions;
  }
}

export class AmbiguousTableError extends SchemaLensError {
  public readonly exitCode = 2;
  constructor(message: string) {
    super(message, message);
  }
}

export class SnapshotMissingError extends SchemaLensError {
  public readonly exitCode = 1;
  constructor(
    message = "Snapshot not found. Run sync first or enable refresh.",
    userMessage?: string,
  ) {
    super(message, userMessage ?? message);
  }
}

export function getExitCode(error: unknown): number {
  if (error instanceof SchemaLensError) {
    return error.exitCode;
  }
  return 1;
}

export function getUserMessage(error: unknown): string {
  if (error instanceof SchemaLensError) {
    return error.userMessage;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
