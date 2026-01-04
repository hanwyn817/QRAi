import Database from "better-sqlite3";
import type { Database as DatabaseInterface, PreparedStatement } from "./api/types";

type StatementRunner = {
  get: (...params: unknown[]) => Record<string, unknown> | undefined;
  all: (...params: unknown[]) => Array<Record<string, unknown>>;
  run: (...params: unknown[]) => { changes: number };
};

class SqliteStatement implements PreparedStatement {
  private statement: StatementRunner;
  private params: unknown[] = [];

  constructor(statement: StatementRunner) {
    this.statement = statement;
  }

  bind(...values: unknown[]): PreparedStatement {
    this.params = values;
    return this;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.statement.get(...this.params) as T | undefined;
    return row ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    const results = this.statement.all(...this.params) as T[];
    return { results };
  }

  async run(): Promise<{ success?: boolean }> {
    this.statement.run(...this.params);
    return { success: true };
  }
}

export class SqliteDatabase implements DatabaseInterface {
  private db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  prepare(query: string): PreparedStatement {
    const statement = this.db.prepare(query) as unknown as StatementRunner;
    return new SqliteStatement(statement);
  }
}
