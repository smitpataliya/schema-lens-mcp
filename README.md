# Schema Lens

**Token-efficient database schema for AI coding assistants (MCP server + CLI)**

Schema Lens introspects PostgreSQL, MySQL, and SQLite databases and converts catalog structures into an ultra-compact, token-optimized notation designed specifically for LLM context windows. It cuts token consumption by **81% to 95%** compared to traditional JSON snapshots or `information_schema` dumps, allowing AI coding assistants (Claude Code, Antigravity, Cursor, Windsurf) to understand entire database architectures without blowing prompt budgets.

---

## Token Comparison

Measured on `test/fixtures/shop.sql` (9 tables, views, enums, composite foreign keys, indexes, check constraints) using `gpt-tokenizer` (OpenAI & Claude BPE):

| Format | Characters | Tokens | Token Savings | Reduction Ratio | Context Budget Impact |
|---|---|---|---|---|---|
| **Pretty JSON Snapshot** | 10,609 | 2,644 | 0% | 1.00x | Burns context window rapidly |
| **Schema Lens Compact (`full`)** | 1,711 | 493 | **81.4%** | **5.36x** | Fits full schema in single response |
| **Schema Lens Overview (`overview`)** | 317 | 110 | **95.8%** | **24.04x** | Ultra-cheap map for initial exploration |

---

## 30-Second Quick Start

### 1. Initialize configuration
```bash
npx schema-lens-mcp init
```
This writes `schema-lens.config.json` and adds `.schema-lens/snapshot*.json` to `.gitignore`.

### 2. Introspect database
```bash
export DATABASE_URL="postgres://readonly_user:password@localhost:5432/shop"
npx schema-lens-mcp sync
```
This generates `.schema-lens/schema.md` (human and AI readable compact schema) and `.schema-lens/snapshot.json`.

---

## AI Assistant Setup

### Claude Code Setup
Add Schema Lens as an MCP tool directly into Claude Code:

```bash
claude mcp add schema-lens -e DATABASE_URL=postgres://readonly@localhost:5432/shop -- npx -y schema-lens-mcp mcp
```

### Antigravity / Generic MCP Client Setup
Add to your `mcpServers` configuration (e.g., `claude_desktop_config.json` or Antigravity MCP settings):

```json
{
  "mcpServers": {
    "schema-lens": {
      "command": "npx",
      "args": ["-y", "schema-lens-mcp", "mcp"],
      "env": {
        "DATABASE_URL": "postgres://readonly@localhost:5432/shop"
      }
    }
  }
}
```

### The "No-MCP" Option
If you prefer not to run an active MCP server:
1. Run `npx schema-lens-mcp sync` in your CI/CD pipeline or git pre-commit hook.
2. Commit `.schema-lens/schema.md` into your repository.
3. Add this line to your project's `CLAUDE.md`, `AGENTS.md`, or system instructions:
   > *"Database schema is in `.schema-lens/schema.md`. Read it before writing any query, entity, or migration."*

---

## MCP Tool Reference

All tools are annotated with `readOnlyHint: true` and capped at ~8,000 characters to prevent context overflow.

| Tool | Description | Arguments | Output |
|---|---|---|---|
| `schema_overview` | High-level overview of tables, estimated rows, column counts, and outgoing foreign key edges. | `{ schemas?: string[], refresh?: boolean }` | Plain text overview format + snapshot hash |
| `table_details` | Full column definitions, keys, indexes, and constraints for requested tables, plus direct neighbor tables. | `{ tables: string[], refresh?: boolean }` | Compact detail block + incoming/outgoing neighbor names |
| `find_join_path` | Breadth-First Search (BFS) over the foreign key graph to discover shortest join path between any two tables. | `{ from: string, to: string, maxHops?: number }` | Ready-to-use SQL join condition statements |
| `schema_changes` | Diffs current database against previous snapshot (`snapshot.prev.json`). | `{ }` | Added/removed/changed tables, columns, indexes, and FKs |

---

## CLI Reference

```bash
schema-lens-mcp <command> [options]
```

### Commands
- `init`: Scaffold configuration file, update `.gitignore`, and print MCP config snippets.
- `sync`: Connect to database, introspect schema, write `.schema-lens/schema.md` and `snapshot.json`.
- `check`: Verify connection and print dialect, target label, and table count.
- `diff`: Print human-readable schema drift since the last snapshot.
- `print [tables...]`: Print compact schema directly to stdout (`--level overview|detail|full`).
- `mcp`: Start the Model Context Protocol stdio server.

### Global Options
- `--url <url>`: Direct database connection URL (or use environment variable).
- `--env <var>`: Name of environment variable containing connection URL (default: `DATABASE_URL`).
- `-s, --schema <name>`: Target schema(s) (e.g. `-s public -s billing`).
- `-x, --exclude <pattern>`: Glob patterns to exclude tables (e.g. `-x '_prisma_*' -x 'knex_*'`).
- `--include-views` / `--no-views`: Toggle view introspection (default: true).
- `--ttl <sec>`: Cache freshness time-to-live in seconds (default: 300).
- `--out <dir>`: Output directory (default: `.schema-lens`).
- `--terse`: Omit default column expressions and empty constraint sections to maximize token savings.

---

## Supported Databases & Driver Installation

Database drivers are loaded lazily on demand. Install only the driver required for your database:

| Database | Connection Scheme | Driver Package | Installation Command |
|---|---|---|---|
| **PostgreSQL** | `postgres://`, `postgresql://` | `pg` | `npm i -D pg` / `npm i -g pg` |
| **MySQL / MariaDB** | `mysql://`, `mariadb://` | `mysql2` | `npm i -D mysql2` |
| **SQLite** | `sqlite:<path>`, file path | `better-sqlite3` | `npm i -D better-sqlite3` |

---

## Configuration Reference (`schema-lens.config.json`)

```json
{
  "envVar": "DATABASE_URL",
  "schemas": ["public"],
  "exclude": ["_prisma_*", "knex_*", "schema_migrations"],
  "includeViews": true,
  "ttlSeconds": 300,
  "outDir": ".schema-lens",
  "terse": false
}
```

> **Security Note:** Never put connection strings containing passwords inside `schema-lens.config.json`. Use `envVar` to point to an environment variable.

---

## Security & Least Privilege

Schema Lens enforces read-only operations across every layer:
1. **No Data Access:** Never executes `SELECT *` or reads user row data. Queries only system catalogs (`pg_catalog`, `information_schema`, `sqlite_schema`).
2. **Session Read-Only:** Establishes read-only transactions on connection (`SET default_transaction_read_only = on` in Postgres, `SET SESSION TRANSACTION READ ONLY` in MySQL, `readonly: true` in SQLite).
3. **Credential Scrubbing:** Automatically redacts passwords and secrets from all logs, error messages, metadata files, and MCP tool outputs.
4. **Injection Proof:** Table exclusion and schema matching are evaluated purely in memory via JavaScript regular expressions; no user strings are concatenated into catalog queries.

### Recommended Read-Only Role SQL

#### PostgreSQL
```sql
-- Create read-only role
CREATE ROLE schema_lens WITH LOGIN PASSWORD 'strong_password';
GRANT CONNECT ON DATABASE shop TO schema_lens;
GRANT USAGE ON SCHEMA public TO schema_lens;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO schema_lens;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO schema_lens;
```

#### MySQL
```sql
-- Create read-only user
CREATE USER 'schema_lens'@'%' IDENTIFIED BY 'strong_password';
GRANT SELECT, SHOW VIEW ON shop.* TO 'schema_lens'@'%';
FLUSH PRIVILEGES;
```

---

## Compact Output Format Syntax

The compact output format uses an intuitive indentation-based syntax:
- `?`: Nullable column (e.g. `name text?`). Not-null is the default and is omitted.
- `pk`: Primary key column (e.g. `id uuid pk`).
- `uniq`: Single-column unique constraint.
- `identity`: Auto-incrementing identity column.
- `default <expr>`: Default column value expression.
- `fk->table.col`: Inline foreign key reference (e.g. `user_id uuid fk->users.id`).
- `pk: (a, b)`: Composite primary key.
- `fk: (a, b) -> target(x, y)`: Composite foreign key.
- `idx: (col1, col2) where cond`: Table index and optional partial predicate.
- `check: total >= 0`: Table check constraint.

---

## Contributing & Development

```bash
# Clone and install dependencies
git clone https://github.com/smitpataliya/schema-lens-mcp.git
cd schema-lens-mcp
npm install

# Run checks and tests
npm run lint
npm run typecheck
npm test
npm run bench

# Build bundle
npm run build
```

---

## License

[MIT](LICENSE) © 2026 Schema Lens Contributors

