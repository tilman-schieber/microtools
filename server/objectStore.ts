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

  // Lazy expiration: treat as not found if expired
  if (row.expires_at && row.expires_at < Date.now()) {
    remove(id);
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

/** Replace an object's data; with expiresAt, also move its expiry (for lifetimes that count from the last change). */
export function update(id: string, data: unknown, expiresAt?: number): StoredObject | null {
  const jsonData = JSON.stringify(data);

  const result = expiresAt === undefined
    ? db.prepare('UPDATE objects SET data = ? WHERE id = ?').run(jsonData, id)
    : db.prepare('UPDATE objects SET data = ?, expires_at = ? WHERE id = ?').run(jsonData, expiresAt, id);

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

/**
 * Give objects of a type that have no expiry one. Rows from before lifetimes
 * existed get the full lifetime from now on rather than from their creation,
 * so nothing old disappears without warning on the first deploy.
 */
export function backfillExpiry(type: string, expiresAt: number): number {
  return db.prepare('UPDATE objects SET expires_at = ? WHERE type = ? AND expires_at IS NULL').run(expiresAt, type).changes;
}

/** Delete all rows whose expires_at is in the past. Returns the deleted rows (id + type) so callers can clean up associated files. */
export function purgeExpired(): Array<{ id: string; type: string }> {
  const now = Date.now();
  const rows = db.prepare(
    'SELECT id, type FROM objects WHERE expires_at IS NOT NULL AND expires_at < ?'
  ).all(now) as Array<{ id: string; type: string }>;

  if (rows.length > 0) {
    db.prepare(
      'DELETE FROM objects WHERE expires_at IS NOT NULL AND expires_at < ?'
    ).run(now);
  }

  return rows;
}
