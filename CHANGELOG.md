# Changelog

All notable changes to `schema-lens-mcp` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-05

### Added
- **Core Engine**:
  - Deterministic canonical SHA-256 schema hashing excluding volatile autovacuum stats.
  - Multi-level compact schema renderer (`overview`, `detail`, `full`) cutting tokens by up to 24x.
  - Undirected BFS shortest join-path graph finder.
  - Structural schema delta engine (`diff`) tracking added/removed/modified tables, columns, indexes, and foreign keys.
  - Atomic cache persistence (`.schema-lens/snapshot.json`, `schema.md`, `meta.json`, `snapshot.prev.json`).
  - Robust credential scrubber redacting sensitive connection passwords across URLs, key-values, and SQL driver logs.
- **Database Adapters**:
  - PostgreSQL adapter querying `pg_catalog` in read-only transaction mode with parallel queries and enum support.
  - MySQL adapter querying `information_schema` with `SET SESSION TRANSACTION READ ONLY` and enum parsing.
  - SQLite adapter using `PRAGMA table_xinfo`, `foreign_key_list`, `index_list`, and `PRAGMA schema_version` fingerprinting with `readonly: true`.
  - Lazy driver loading for `pg`, `mysql2`, and `better-sqlite3`.
- **Model Context Protocol (MCP) Server**:
  - Stdio transport adhering strictly to protocol specifications without polluting stdout.
  - `schema_overview`: high-level schema overview with token-saving table signatures.
  - `table_details`: deep column, constraint, index, and foreign key details with direct neighbor discovery and Levenshtein fuzzy suggestions.
  - `find_join_path`: automated SQL join condition discovery between arbitrary tables.
  - `schema_changes`: delta reporting between current and previous database snapshots.
  - 8,000 character output capping and `readOnlyHint: true` on all tools.
- **Command Line Interface (CLI)**:
  - `init`: interactive or flag-based configuration generator and gitignore updater.
  - `sync`: one-shot database introspection to `.schema-lens/schema.md` and `snapshot.json`.
  - `check`: connection and dialect verification.
  - `diff`: human-readable schema drift reporting.
  - `print`: stdout renderer for `overview`, `detail`, or `full` levels.
  - `mcp`: stdio MCP server starter.
- **Performance & Testing**:
  - 300-table synthetic performance benchmark (cold < 2s, cached < 100ms, hash < 100ms).
  - Automated BPE token count benchmark using `gpt-tokenizer` enforcing $\ge 4.0\times$ token savings.

