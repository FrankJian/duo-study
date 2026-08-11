import fs from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { config } from "../config.js";
import { schema } from "./schema.js";

fs.mkdirSync(config.dataDir, { recursive: true });

export const sqlite = new Database(config.dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 5000");

export const db = drizzle(sqlite, { schema });

export function closeDatabase() {
  sqlite.close();
}

export function isDatabaseMigrated() {
  const row = sqlite
    .prepare("SELECT 1 AS ready FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get() as { ready?: number } | undefined;
  return row?.ready === 1;
}
