import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node18",
  external: ["better-sqlite3", "pg", "mysql2"],
  banner: (ctx) => {
    if (ctx.entry === "cli") {
      return { js: "#!/usr/bin/env node" };
    }
    return {};
  },
});
