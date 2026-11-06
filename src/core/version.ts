import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let cachedVersion: string | null = null;

export function getPackageVersion(): string {
  if (cachedVersion) {
    return cachedVersion;
  }

  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    // Walk up to find nearest package.json
    let dir = currentDir;
    for (let i = 0; i < 4; i++) {
      const pkgPath = path.join(dir, "package.json");
      if (fs.existsSync(pkgPath)) {
        const raw = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        if (typeof raw.version === "string") {
          cachedVersion = raw.version;
          return raw.version;
        }
      }
      dir = path.dirname(dir);
    }
  } catch {
    // Fallback if bundled in strict virtual environments
  }

  cachedVersion = "0.1.0";
  return cachedVersion;
}
