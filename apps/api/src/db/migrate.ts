import fs from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { config } from "../config.js";
import { db, closeDatabase, sqlite } from "./client.js";

const migrationsFolder = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../drizzle");
fs.mkdirSync(config.dataDir, { recursive: true });

try {
  migrate(db, { migrationsFolder });
  sqlite.pragma("optimize");
  console.log(`Database migrated: ${config.dbPath}`);
} finally {
  closeDatabase();
}
