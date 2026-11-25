import crypto from 'crypto';

// Keys for things without accounts: whoever creates a poll or list, or adds an
// answer or claim to one, gets a random key for it. Only hashes are stored, so
// the keys never appear in the database or in a page someone else loads.

export function newKey(): string {
  return crypto.randomBytes(18).toString('base64url');
}

export function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export function keyMatches(key: unknown, hash: string | undefined): boolean {
  if (typeof key !== 'string' || !key || !hash) return false;
  const a = Buffer.from(hashKey(key), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** A short random id, unique among `taken` */
export function newId(taken: (id: string) => boolean = () => false): string {
  let id: string;
  do id = crypto.randomBytes(6).toString('base64url');
  while (taken(id));
  return id;
}
