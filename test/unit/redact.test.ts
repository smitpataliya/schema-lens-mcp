import { describe, expect, it } from "vitest";
import { createConnectionLabel, redactCredentials } from "../../src/util/redact.js";

describe("redactCredentials", () => {
  it("redacts passwords in standard connection URLs", () => {
    const input = "postgres://admin:superSecret123@localhost:5432/mydb";
    const result = redactCredentials(input);
    expect(result).toBe("postgres://admin:***@localhost:5432/mydb");
    expect(result).not.toContain("superSecret123");
  });

  it("redacts passwords in URLs without username", () => {
    const input = "postgres://:mySecretPassword@localhost:5432/mydb";
    const result = redactCredentials(input);
    expect(result).toBe("postgres://:***@localhost:5432/mydb");
    expect(result).not.toContain("mySecretPassword");
  });

  it("redacts query parameter credentials", () => {
    const input = "sqlite:/data.db?password=classified&mode=ro";
    const result = redactCredentials(input);
    expect(result).toBe("sqlite:/data.db?password=***&mode=ro");
    expect(result).not.toContain("classified");
  });

  it("redacts key-value connection string passwords", () => {
    const input = "Host=localhost;Database=shop;Username=app;Password=secretPass;";
    const result = redactCredentials(input);
    expect(result).toContain("Password=***");
    expect(result).not.toContain("secretPass");
  });

  it("redacts connection URL within error text", () => {
    const errorMsg =
      'Failed connecting to "postgresql://user:pass123@db.domain.com:5432/analytics": connection refused';
    const result = redactCredentials(errorMsg);
    expect(result).toBe(
      'Failed connecting to "postgresql://user:***@db.domain.com:5432/analytics": connection refused',
    );
  });
});

describe("createConnectionLabel", () => {
  it("removes user credentials and keeps protocol, host and database", () => {
    const input = "postgres://db_user:my_secret@db.internal:5432/production_db";
    const result = createConnectionLabel(input);
    expect(result).toBe("postgres://db.internal:5432/production_db");
    expect(result).not.toContain("db_user");
    expect(result).not.toContain("my_secret");
  });

  it("handles sqlite file paths directly", () => {
    const input = "sqlite:/path/to/test.db";
    const result = createConnectionLabel(input);
    expect(result).toBe("sqlite:/path/to/test.db");
  });
});
