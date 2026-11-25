import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './paths';

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'store.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS objects (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER
  )
`);

export default db;
