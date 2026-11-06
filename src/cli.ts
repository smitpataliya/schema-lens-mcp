import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  backupCurrentSnapshot,
  readPrevSnapshot,
  readSnapshot,
  saveSnapshotFiles,
} from "./core/cache.js";
import { type CliConfigFlags, loadConfig } from "./core/config.js";
import { diffSnapshots, formatDiff } from "./core/diff.js";
import { ConfigError, SnapshotMissingError, getExitCode, getUserMessage } from "./core/errors.js";
import { getAdapter, introspectDatabase } from "./core/introspect.js";
import type { IntrospectOptions } from "./core/types.js";
import { getPackageVersion } from "./core/version.js";
import { renderCompact } from "./format/compact.js";
import { startMcpServer } from "./mcp/server.js";
import { log, logError } from "./util/logger.js";
import { createConnectionLabel } from "./util/redact.js";

const program = new Command();

program
  .name("schema-lens-mcp")
  .description("Token-efficient database schema MCP server and CLI")
  .version(getPackageVersion());

function addGlobalOptions(cmd: Command): Command {
  return cmd
    .option("--url <url>", "Database connection URL")
    .option("--env <var>", "Environment variable containing connection URL")
    .option("-s, --schema <name>", "Included schema name(s)", (val: string, prev: string[] = []) =>
      prev.concat(val),
    )
    .option(
      "-x, --exclude <glob>",
      "Exclude table pattern(s)",
      (val: string, prev: string[] = []) => prev.concat(val),
    )
    .option("--include-views", "Include views in introspection")
    .option("--no-views", "Exclude views")
    .option("--ttl <sec>", "Cache TTL in seconds", (val) => Number.parseInt(val, 10))
    .option("--out <dir>", "Output directory for schema files")
    .option("--cwd <dir>", "Working directory for resolving configuration and output")
    .option("--terse", "Omit defaults and reduce token usage");
}

function parseCliFlags(options: Record<string, unknown>): {
  flags: CliConfigFlags;
  cwd?: string | undefined;
} {
  const flags: CliConfigFlags = {};
  if (typeof options.url === "string") {
    flags.url = options.url;
  }
  if (typeof options.env === "string") {
    flags.env = options.env;
  }
  if (Array.isArray(options.schema)) {
    flags.schema = options.schema;
  }
  if (Array.isArray(options.exclude)) {
    flags.exclude = options.exclude;
  }
  // Commander --no-views sets views=false, --include-views sets includeViews=true
  if (options.views === false || options.includeViews === false) {
    flags.includeViews = false;
  } else if (options.views === true || options.includeViews === true) {
    flags.includeViews = true;
  }
  if (typeof options.ttl === "number") {
    flags.ttl = options.ttl;
  }
  if (typeof options.out === "string") {
    flags.out = options.out;
  }
  if (typeof options.terse === "boolean") {
    flags.terse = options.terse;
  }

  const cwd = typeof options.cwd === "string" ? path.resolve(options.cwd) : undefined;
  return { flags, cwd };
}

function createIntrospectOptions(config: ReturnType<typeof loadConfig>): IntrospectOptions {
  const opts: IntrospectOptions = {
    schemas: config.schemas,
    includeViews: config.includeViews,
    excludeTables: config.exclude,
  };
  if (config.includeTables !== undefined) {
    opts.includeTables = config.includeTables;
  }
  return opts;
}

// init command
program
  .command("init")
  .description("Initialize schema-lens configuration, gitignore rules, and print MCP setup")
  .option("--env <var>", "Environment variable name for database URL", "DATABASE_URL")
  .option("--cwd <dir>", "Working directory")
  .action((options) => {
    try {
      const cwd = typeof options.cwd === "string" ? path.resolve(options.cwd) : process.cwd();
      const configPath = path.join(cwd, "schema-lens.config.json");
      const envVarName = typeof options.env === "string" ? options.env : "DATABASE_URL";

      if (!fs.existsSync(configPath)) {
        const defaultConfig = {
          envVar: envVarName,
          schemas: ["public"],
          exclude: ["_prisma_*", "knex_*", "schema_migrations"],
          includeViews: true,
          ttlSeconds: 300,
          outDir: ".schema-lens",
        };
        fs.writeFileSync(configPath, `${JSON.stringify(defaultConfig, null, 2)}\n`, "utf-8");
        log(`Created ${configPath}`);
      } else {
        log(`Found existing ${configPath}`);
      }

      // Update .gitignore if present
      const gitignorePath = path.join(cwd, ".gitignore");
      const gitignoreEntries = "\n# schema-lens-mcp\n.schema-lens/snapshot*.json\n";
      if (fs.existsSync(gitignorePath)) {
        const currentContent = fs.readFileSync(gitignorePath, "utf-8");
        if (!currentContent.includes(".schema-lens/snapshot*.json")) {
          fs.appendFileSync(gitignorePath, gitignoreEntries, "utf-8");
          log("Appended .schema-lens/snapshot*.json to .gitignore");
        }
      }

      log("\nConfiguration complete! Next steps:");
      log("\n1. Sync database schema to .schema-lens/schema.md:");
      log(`   npx schema-lens-mcp sync --env ${envVarName}`);
      log("\n2. Connect to Claude Code:");
      log(
        `   claude mcp add schema-lens -e ${envVarName}=<connection-url> -- npx -y schema-lens-mcp mcp`,
      );
      log(
        "\n3. Connect to Antigravity / generic MCP client (in mcpSettings / claude_desktop_config.json):",
      );
      log(
        JSON.stringify(
          {
            mcpServers: {
              "schema-lens": {
                command: "npx",
                args: ["-y", "schema-lens-mcp", "mcp"],
                env: { [envVarName]: "<connection-url>" },
              },
            },
          },
          null,
          2,
        ),
      );

      process.exitCode = 0;
    } catch (err) {
      logError(getUserMessage(err));
      process.exitCode = getExitCode(err);
    }
  });

// sync command
addGlobalOptions(program.command("sync"))
  .description("Introspect database and write schema.md and snapshot.json")
  .action(async (options) => {
    try {
      const startTime = Date.now();
      const { flags, cwd } = parseCliFlags(options);
      const config = loadConfig(flags, cwd);

      log(`Connecting to ${createConnectionLabel(config.connectionUrl)}...`);
      const snapshot = await introspectDatabase(
        config.dialect,
        config.connectionUrl,
        createIntrospectOptions(config),
      );

      const outDir = path.resolve(cwd ?? process.cwd(), config.outDir);
      backupCurrentSnapshot(outDir);
      saveSnapshotFiles(outDir, snapshot, config.connectionUrl, undefined, config.terse);

      const elapsed = Date.now() - startTime;
      log(`Synced ${snapshot.tables.length} tables in ${elapsed}ms -> ${config.outDir}/schema.md`);
      process.exitCode = 0;
    } catch (err) {
      logError(getUserMessage(err));
      process.exitCode = getExitCode(err);
    }
  });

// diff command
addGlobalOptions(program.command("diff"))
  .description("Print changes since previous snapshot")
  .action(async (options) => {
    try {
      const { flags, cwd } = parseCliFlags(options);
      const config = loadConfig(flags, cwd, false);
      const outDir = path.resolve(cwd ?? process.cwd(), config.outDir);

      const current = readSnapshot(outDir);
      if (!current) {
        throw new SnapshotMissingError("No snapshot found. Run sync first.");
      }

      const prev = readPrevSnapshot(outDir);
      const diff = diffSnapshots(prev, current);
      const formatted = formatDiff(diff);

      process.stdout.write(`${formatted}\n`);
      process.exitCode = 0;
    } catch (err) {
      logError(getUserMessage(err));
      process.exitCode = getExitCode(err);
    }
  });

// mcp command
addGlobalOptions(program.command("mcp"))
  .description("Start the MCP server over stdio")
  .action(async (options) => {
    try {
      const { flags, cwd } = parseCliFlags(options);
      const config = loadConfig(flags, cwd, false);
      await startMcpServer(config);
    } catch (err) {
      logError(getUserMessage(err));
      process.exitCode = getExitCode(err);
    }
  });

// check command
addGlobalOptions(program.command("check"))
  .description("Test connection and print dialect and table count")
  .action(async (options) => {
    try {
      const { flags, cwd } = parseCliFlags(options);
      const config = loadConfig(flags, cwd);
      const adapter = getAdapter(config.dialect, config.connectionUrl);

      await adapter.connect();
      try {
        const snapshot = await adapter.introspect(createIntrospectOptions(config));

        const label = createConnectionLabel(config.connectionUrl);
        log(
          `Connection OK | Dialect: ${config.dialect} | Target: ${label} | Tables: ${snapshot.tables.length}`,
        );
        process.exitCode = 0;
      } finally {
        await adapter.close();
      }
    } catch (err) {
      logError(getUserMessage(err));
      process.exitCode = getExitCode(err);
    }
  });

// print command
addGlobalOptions(
  program
    .command("print [tables...]")
    .option("--level <level>", "Output level: overview | detail | full"),
)
  .description("Print compact schema output to stdout")
  .action(async (tablesArg: string[], options) => {
    try {
      const { flags, cwd } = parseCliFlags(options);
      const config = loadConfig(flags, cwd, false);
      const outDir = path.resolve(cwd ?? process.cwd(), config.outDir);

      let snapshot = readSnapshot(outDir);

      if (!snapshot) {
        if (!config.connectionUrl) {
          throw new ConfigError(
            "No snapshot found and no connection URL provided to generate one.",
          );
        }
        snapshot = await introspectDatabase(
          config.dialect,
          config.connectionUrl,
          createIntrospectOptions(config),
        );
      }

      const validLevels = ["overview", "detail", "full"] as const;
      const rawLevel = options.level || (tablesArg.length > 0 ? "detail" : "overview");
      if (!validLevels.includes(rawLevel as (typeof validLevels)[number])) {
        throw new ConfigError(
          `Invalid --level: "${rawLevel}". Allowed values: ${validLevels.join(", ")}`,
        );
      }
      const level = rawLevel as (typeof validLevels)[number];

      const compactOpts: { tables?: string[]; terse?: boolean } = {
        terse: config.terse,
      };
      if (tablesArg.length > 0) {
        compactOpts.tables = tablesArg;
      }

      const output = renderCompact(snapshot, level, compactOpts);

      process.stdout.write(`${output}\n`);
      process.exitCode = 0;
    } catch (err) {
      logError(getUserMessage(err));
      process.exitCode = getExitCode(err);
    }
  });

program.parse(process.argv);
