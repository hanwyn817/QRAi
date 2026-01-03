import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const options = {
  local: false,
  env: null,
  db: null,
  baseline: false,
  migrationsDir: "migrations"
};

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--local") {
    options.local = true;
    continue;
  }
  if (arg === "--env") {
    options.env = args[i + 1] ?? null;
    i += 1;
    continue;
  }
  if (arg === "--db") {
    options.db = args[i + 1] ?? null;
    i += 1;
    continue;
  }
  if (arg === "--baseline") {
    options.baseline = true;
    continue;
  }
  if (arg === "--dir") {
    options.migrationsDir = args[i + 1] ?? options.migrationsDir;
    i += 1;
    continue;
  }
}

function loadDbNameFromWrangler() {
  const candidates = [
    resolve(process.cwd(), "wrangler.toml"),
    resolve(new URL("..", import.meta.url).pathname, "..", "wrangler.toml")
  ];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) {
    return null;
  }
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  let inD1Block = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    if (line.startsWith("[[")) {
      inD1Block = line === "[[d1_databases]]";
      continue;
    }
    if (!inD1Block) {
      continue;
    }
    const match = line.match(/^database_name\s*=\s*"([^"]+)"/);
    if (match) {
      return match[1];
    }
  }
  return null;
}

const dbName =
  options.db ??
  process.env.D1_DATABASE_NAME ??
  loadDbNameFromWrangler() ??
  (options.local ? "qrai" : null);
if (!dbName) {
  console.error("Missing database name. Use --db or set D1_DATABASE_NAME.");
  process.exit(1);
}

const baseArgs = ["d1", "execute", dbName];
if (options.local) {
  baseArgs.push("--local");
} else {
  baseArgs.push("--remote");
}
if (options.env) {
  baseArgs.push("--env", options.env);
}

function runWrangler(extraArgs) {
  const result = spawnSync("wrangler", [...baseArgs, ...extraArgs], { encoding: "utf8" });
  if (result.status !== 0) {
    const message = result.stderr || result.stdout || "wrangler failed";
    throw new Error(message);
  }
  return result.stdout;
}

function extractJson(text) {
  const start = Math.min(
    ...["[", "{"]
      .map((char) => text.indexOf(char))
      .filter((index) => index >= 0)
  );
  if (!Number.isFinite(start)) {
    return null;
  }
  try {
    return JSON.parse(text.slice(start));
  } catch {
    return null;
  }
}

function queryResults(sql) {
  const output = runWrangler(["--command", sql, "--json"]);
  const payload = extractJson(output);
  if (Array.isArray(payload)) {
    return payload[0]?.results ?? [];
  }
  return payload?.results ?? [];
}

function execCommand(sql) {
  runWrangler(["--command", sql]);
}

function execFile(path) {
  runWrangler(["--file", path]);
}

execCommand(
  "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
);

const files = readdirSync(options.migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

if (options.baseline) {
  for (const file of files) {
    execCommand(
      `INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES ('${file}', datetime('now'))`
    );
  }
  console.log("Baseline applied. No migrations executed.");
  process.exit(0);
}

const applied = new Set(
  queryResults("SELECT id FROM schema_migrations ORDER BY id").map((row) => row.id)
);

for (const file of files) {
  if (applied.has(file)) {
    continue;
  }
  const fullPath = resolve(options.migrationsDir, file);
  console.log(`Running migration: ${file}`);
  execFile(fullPath);
  execCommand(
    `INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES ('${file}', datetime('now'))`
  );
}

console.log("Migrations complete.");
