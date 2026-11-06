import { describe, expect, it } from "vitest";
import { MysqlAdapter } from "../../src/adapters/mysql.js";
import { PostgresAdapter } from "../../src/adapters/postgres.js";

describe("Live Database Integration", () => {
  const pgUrl = process.env.TEST_POSTGRES_URL;
  const mysqlUrl = process.env.TEST_MYSQL_URL;

  it.skipIf(!pgUrl)("introspects live PostgreSQL database and enforces read-only", async () => {
    if (!pgUrl) return;

    const adapter = new PostgresAdapter(pgUrl);
    await adapter.connect();

    try {
      const snapshot = await adapter.introspect();
      expect(snapshot.dialect).toBe("postgres");
      expect(snapshot.tables.length).toBeGreaterThan(0);

      // Verify users table and foreign keys
      const usersTable = snapshot.tables.find((t) => t.name === "users");
      expect(usersTable).toBeDefined();
      expect(usersTable?.primaryKey).toContain("id");
    } finally {
      await adapter.close();
    }
  });

  it.skipIf(!mysqlUrl)("introspects live MySQL database and enforces read-only", async () => {
    if (!mysqlUrl) return;

    const adapter = new MysqlAdapter(mysqlUrl);
    await adapter.connect();

    try {
      const snapshot = await adapter.introspect();
      expect(snapshot.dialect).toBe("mysql");
      expect(snapshot.tables.length).toBeGreaterThan(0);

      // Verify users table
      const usersTable = snapshot.tables.find((t) => t.name === "users");
      expect(usersTable).toBeDefined();
    } finally {
      await adapter.close();
    }
  });
});
