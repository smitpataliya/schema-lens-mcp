import { describe, expect, it } from "vitest";
import {
  type MysqlIntrospectionRawData,
  parseMysqlCatalogData,
  parseMysqlEnumValues,
} from "../../src/adapters/mysql.js";
import { renderCompact } from "../../src/format/compact.js";

describe("MySQL parser", () => {
  it("parses enum values correctly from column type definition", () => {
    const raw = "enum('pending','in_progress','done')";
    const values = parseMysqlEnumValues(raw);
    expect(values).toEqual(["pending", "in_progress", "done"]);

    const withQuotes = "enum('foo\\'bar','baz\\\\')";
    const parsedQuotes = parseMysqlEnumValues(withQuotes);
    expect(parsedQuotes).toEqual(["foo'bar", "baz\\"]);

    expect(parseMysqlEnumValues("varchar(255)")).toBeNull();
  });

  it("normalizes MySQL information_schema data into SchemaSnapshot", () => {
    const rawData: MysqlIntrospectionRawData = {
      tables: [
        {
          schema: "shop_db",
          name: "users",
          type: "BASE TABLE",
          comment: "registered customers",
          estimated_rows: "1000",
        },
        {
          schema: "shop_db",
          name: "orders",
          type: "BASE TABLE",
          comment: null,
          estimated_rows: "5000",
        },
        {
          schema: "shop_db",
          name: "user_view",
          type: "VIEW",
          comment: null,
          estimated_rows: null,
        },
      ],
      columns: [
        {
          schema: "shop_db",
          table: "users",
          attnum: 1,
          name: "id",
          type: "bigint",
          nullable: "NO",
          default: null,
          extra: "auto_increment",
          comment: null,
        },
        {
          schema: "shop_db",
          table: "users",
          attnum: 2,
          name: "email",
          type: "varchar(255)",
          nullable: "NO",
          default: null,
          extra: null,
          comment: null,
        },
        {
          schema: "shop_db",
          table: "orders",
          attnum: 1,
          name: "id",
          type: "bigint",
          nullable: "NO",
          default: null,
          extra: "auto_increment",
          comment: null,
        },
        {
          schema: "shop_db",
          table: "orders",
          attnum: 2,
          name: "user_id",
          type: "bigint",
          nullable: "NO",
          default: null,
          extra: null,
          comment: null,
        },
        {
          schema: "shop_db",
          table: "orders",
          attnum: 3,
          name: "status",
          type: "enum('pending','shipped','cancelled')",
          nullable: "NO",
          default: "'pending'",
          extra: null,
          comment: null,
        },
      ],
      constraints: [
        {
          schema: "shop_db",
          table: "users",
          name: "PRIMARY",
          type: "PRIMARY KEY",
          column: "id",
          ord: 1,
          ref_schema: null,
          ref_table: null,
          ref_column: null,
          on_delete: null,
          on_update: null,
        },
        {
          schema: "shop_db",
          table: "users",
          name: "uq_users_email",
          type: "UNIQUE",
          column: "email",
          ord: 1,
          ref_schema: null,
          ref_table: null,
          ref_column: null,
          on_delete: null,
          on_update: null,
        },
        {
          schema: "shop_db",
          table: "orders",
          name: "PRIMARY",
          type: "PRIMARY KEY",
          column: "id",
          ord: 1,
          ref_schema: null,
          ref_table: null,
          ref_column: null,
          on_delete: null,
          on_update: null,
        },
        {
          schema: "shop_db",
          table: "orders",
          name: "fk_orders_user",
          type: "FOREIGN KEY",
          column: "user_id",
          ord: 1,
          ref_schema: "shop_db",
          ref_table: "users",
          ref_column: "id",
          on_delete: "CASCADE",
          on_update: "RESTRICT",
        },
      ],
      indexes: [
        {
          schema: "shop_db",
          table: "orders",
          name: "idx_orders_status",
          non_unique: 1,
          method: "BTREE",
          column: "status",
          seq: 1,
        },
      ],
      checks: [
        {
          schema: "shop_db",
          table: "orders",
          name: "chk_orders_status",
          clause: "(`status` in ('pending','shipped','cancelled'))",
        },
      ],
    };

    const snapshot = parseMysqlCatalogData("shop_db", rawData, { includeViews: true });

    expect(snapshot.dialect).toBe("mysql");
    expect(snapshot.databaseName).toBe("shop_db");
    expect(snapshot.tables.length).toBe(3);

    const users = snapshot.tables.find((t) => t.name === "users");
    expect(users?.primaryKey).toEqual(["id"]);
    expect(users?.uniques).toEqual([["email"]]);
    expect(users?.columns[0]?.isIdentity).toBe(true);

    const orders = snapshot.tables.find((t) => t.name === "orders");
    expect(orders?.foreignKeys.length).toBe(1);
    expect(orders?.foreignKeys[0]?.refTable).toBe("users");
    expect(orders?.foreignKeys[0]?.onDelete).toBe("cascade");
    expect(orders?.foreignKeys[0]?.onUpdate).toBe("restrict");
    expect(orders?.checks[0]).toContain("status");

    expect(snapshot.enums.length).toBe(1);
    expect(snapshot.enums[0]?.values).toEqual(["pending", "shipped", "cancelled"]);

    const compact = renderCompact(snapshot, "full");
    expect(compact).toContain("table users  ~1000 rows");
    expect(compact).toContain("table orders  ~5000 rows");
    expect(compact).toContain("  user_id bigint fk->users.id on delete cascade on update restrict");
  });
});
