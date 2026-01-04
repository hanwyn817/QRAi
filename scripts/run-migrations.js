import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const args = process.argv.slice(2);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const options = {
  db: process.env.DB_PATH ?? "./data/qrai.sqlite",
  migrationsDir: resolve(scriptDir, "../migrations")
};

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--db") {
    options.db = args[i + 1] ?? options.db;
    i += 1;
    continue;
  }
  if (arg === "--dir") {
    options.migrationsDir = args[i + 1] ?? options.migrationsDir;
    i += 1;
    continue;
  }
}

const dbPath = resolve(options.db);
const dbDir = dirname(dbPath);
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(
  "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
);

const migrationsDir = resolve(options.migrationsDir);
const files = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

const applied = new Set(
  db.prepare("SELECT id FROM schema_migrations ORDER BY id").all().map((row) => row.id)
);

for (const file of files) {
  if (applied.has(file)) {
    continue;
  }
  const fullPath = resolve(migrationsDir, file);
  const sql = readFileSync(fullPath, "utf8");
  console.log(`Running migration: ${file}`);
  db.exec(sql);
  db.prepare("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, datetime('now'))")
    .run(file);
}

console.log("Migrations complete.");
