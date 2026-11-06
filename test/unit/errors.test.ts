import { describe, expect, it } from "vitest";
import {
  ConfigError,
  ConnectionError,
  IntrospectionError,
  SnapshotMissingError,
  TableNotFoundError,
  getExitCode,
  getUserMessage,
} from "../../src/core/errors.js";

describe("errors", () => {
  it("maps exit codes correctly", () => {
    expect(getExitCode(new ConfigError("bad config"))).toBe(2);
    expect(getExitCode(new ConnectionError("conn failed"))).toBe(3);
    expect(getExitCode(new IntrospectionError("query failed"))).toBe(1);
    expect(getExitCode(new TableNotFoundError("users"))).toBe(1);
    expect(getExitCode(new SnapshotMissingError())).toBe(1);
    expect(getExitCode(new Error("generic"))).toBe(1);
  });

  it("formats TableNotFoundError with suggestions", () => {
    const err = new TableNotFoundError("usr", ["users", "user_roles"]);
    expect(err.userMessage).toBe('Table "usr" not found. Did you mean: users, user_roles?');
    expect(getUserMessage(err)).toBe('Table "usr" not found. Did you mean: users, user_roles?');
  });

  it("handles standard error fallback in getUserMessage", () => {
    expect(getUserMessage(new Error("something went wrong"))).toBe("something went wrong");
    expect(getUserMessage("raw string error")).toBe("raw string error");
  });

  it("preserves error cause", () => {
    const rootErr = new Error("connection timeout");
    const err = new ConnectionError("Failed to connect", undefined, { cause: rootErr });
    expect(err.cause).toBe(rootErr);
  });
});
