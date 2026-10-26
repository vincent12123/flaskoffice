import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type DB = Database.Database;

/** Buka database SQLite. `:memory:` dipakai test. */
export function bukaDatabase(lokasi: string): DB {
  if (lokasi !== ':memory:') mkdirSync(path.dirname(lokasi), { recursive: true });
  const db = new Database(lokasi);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}
