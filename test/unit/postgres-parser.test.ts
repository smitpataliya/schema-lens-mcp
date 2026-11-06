import { describe, expect, it } from "vitest";
import {
  type PgIntrospectionRawData,
  parsePostgresCatalogData,
} from "../../src/adapters/postgres.js";

describe("parsePostgresCatalogData", () => {
  const mockRawData: PgIntrospectionRawData = {
    tables: [
      {
        schema: "public",
        name: "users",
        kind: "r",
        comment: "registered customers",
        estimated_rows: "12400",
      },
      {
        schema: "public",
        name: "orders",
        kind: "r",
        comment: null,
        estimated_rows: "98000",
      },
      {
        schema: "public",
        name: "active_orders_view",
        kind: "v",
        comment: null,
        estimated_rows: null,
      },
      {
        schema: "billing",
        name: "invoices",
        kind: "r",
        comment: null,
        estimated_rows: "500",
      },
    ],
    columns: [
      {
        schema: "public",
        table: "users",
        attnum: 1,
        name: "id",
        type: "uuid",
        nullable: false,
        default: "gen_random_uuid()",
        is_identity: false,
        is_generated: false,
        is_enum: false,
        enum_name: null,
        comment: null,
      },
      {
        schema: "public",
        table: "users",
        attnum: 2,
        name: "email",
        type: "text",
        nullable: false,
        default: null,
        is_identity: false,
        is_generated: false,
        is_enum: false,
        enum_name: null,
        comment: null,
      },
      {
        schema: "public",
        table: "orders",
        attnum: 1,
        name: "id",
        type: "bigint",
        nullable: false,
        default: null,
        is_identity: true,
        is_generated: false,
        is_enum: false,
        enum_name: null,
        comment: null,
      },
      {
        schema: "public",
        table: "orders",
        attnum: 2,
        name: "user_id",
        type: "uuid",
        nullable: false,
        default: null,
        is_identity: false,
        is_generated: false,
        is_enum: false,
        enum_name: null,
        comment: null,
      },
      {
        schema: "public",
        table: "orders",
        attnum: 3,
        name: "status",
        type: "order_status",
        nullable: false,
        default: "'pending'::order_status",
        is_identity: false,
        is_generated: false,
        is_enum: true,
        enum_name: "order_status",
        comment: null,
      },
    ],
    constraints: [
      {
        schema: "public",
        table: "users",
        name: "users_pkey",
        type: "p",
        columns: ["id"],
        ref_schema: null,
        ref_table: null,
        ref_columns: null,
        on_delete: null,
        on_update: null,
        definition: null,
      },
      {
        schema: "public",
        table: "users",
        name: "users_email_key",
        type: "u",
        columns: ["email"],
        ref_schema: null,
        ref_table: null,
        ref_columns: null,
        on_delete: null,
        on_update: null,
        definition: null,
      },
      {
        schema: "public",
        table: "orders",
        name: "orders_pkey",
        type: "p",
        columns: ["id"],
        ref_schema: null,
        ref_table: null,
        ref_columns: null,
        on_delete: null,
        on_update: null,
        definition: null,
      },
      {
        schema: "public",
        table: "orders",
        name: "orders_user_id_fkey",
        type: "f",
        columns: ["user_id"],
        ref_schema: "public",
        ref_table: "users",
        ref_columns: ["id"],
        on_delete: "c",
        on_update: "a",
        definition: null,
      },
      {
        schema: "public",
        table: "orders",
        name: "orders_check_status",
        type: "c",
        columns: null,
        ref_schema: null,
        ref_table: null,
        ref_columns: null,
        on_delete: null,
        on_update: null,
        definition: "CHECK (status IS NOT NULL)",
      },
    ],
    indexes: [
      {
        schema: "public",
        table: "orders",
        name: "orders_status_idx",
        method: "btree",
        is_unique: false,
        columns: ["status"],
        predicate: "status <> 'cancelled'",
      },
    ],
    enums: [
      {
        schema: "public",
        name: "order_status",
        values: ["pending", "paid", "shipped", "cancelled"],
      },
    ],
  };

  it("normalizes PostgreSQL catalog data correctly into SchemaSnapshot", () => {
    const snapshot = parsePostgresCatalogData("test_shop", ["public", "billing"], mockRawData, {
      includeViews: true,
    });

    expect(snapshot.dialect).toBe("postgres");
    expect(snapshot.databaseName).toBe("test_shop");
    expect(snapshot.tables.length).toBe(4);

    const usersTable = snapshot.tables.find((t) => t.name === "users");
    expect(usersTable).toBeDefined();
    if (!usersTable) return;
    expect(usersTable.comment).toBe("registered customers");
    expect(usersTable.primaryKey).toEqual(["id"]);
    expect(usersTable.uniques).toEqual([["email"]]);
    expect(usersTable.columns[0]?.default).toBe("gen_random_uuid()");

    const ordersTable = snapshot.tables.find((t) => t.name === "orders");
    expect(ordersTable).toBeDefined();
    if (!ordersTable) return;
    expect(ordersTable.columns[0]?.isIdentity).toBe(true);
    expect(ordersTable.columns[2]?.enumRef).toBe("order_status");
    expect(ordersTable.foreignKeys[0]?.onDelete).toBe("cascade");
    expect(ordersTable.foreignKeys[0]?.onUpdate).toBe("no action");
    expect(ordersTable.checks).toContain("status IS NOT NULL");
    expect(ordersTable.indexes[0]?.where).toBe("status <> 'cancelled'");

    expect(snapshot.enums[0]?.name).toBe("order_status");
    expect(snapshot.enums[0]?.values).toEqual(["pending", "paid", "shipped", "cancelled"]);
  });

  it("filters out views when includeViews is false", () => {
    const snapshot = parsePostgresCatalogData("test_shop", ["public"], mockRawData, {
      includeViews: false,
    });

    const view = snapshot.tables.find((t) => t.name === "active_orders_view");
    expect(view).toBeUndefined();
  });
});
