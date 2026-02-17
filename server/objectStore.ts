import db from './db';
import crypto from 'crypto';

interface StoredObject {
  id: string;
  type: string;
  data: unknown;
  created_at: number;
  expires_at: number | null;
}

interface ObjectRow {
  id: string;
  type: string;
  data: string;
  created_at: number;
  expires_at: number | null;
}

function generateId(): string {
  return crypto.randomBytes(8).toString('base64url');
}

export function create(type: string, data: unknown, expiresAt: number | null = null): StoredObject {
  const id = generateId();
  return createWithId(id, type, data, expiresAt);
}

export function createWithId(id: string, type: string, data: unknown, expiresAt: number | null = null): StoredObject {
  const createdAt = Date.now();
  const jsonData = JSON.stringify(data);

  const stmt = db.prepare(`
    INSERT INTO objects (id, type, data, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  stmt.run(id, type, jsonData, createdAt, expiresAt);

  return {
    id,
    type,
    data,
    created_at: createdAt,
    expires_at: expiresAt
  };
}

export function get(id: string): StoredObject | null {
  const stmt = db.prepare('SELECT * FROM objects WHERE id = ?');
  const row = stmt.get(id) as ObjectRow | undefined;

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    type: row.type,
    data: JSON.parse(row.data),
    created_at: row.created_at,
    expires_at: row.expires_at
  };
}

export function update(id: string, data: unknown): StoredObject | null {
  const jsonData = JSON.stringify(data);

  const stmt = db.prepare('UPDATE objects SET data = ? WHERE id = ?');
  const result = stmt.run(jsonData, id);

  if (result.changes === 0) {
    return null;
  }

  return get(id);
}

export function remove(id: string): boolean {
  const stmt = db.prepare('DELETE FROM objects WHERE id = ?');
  const result = stmt.run(id);

  return result.changes > 0;
}

export { remove as deleteObject };
