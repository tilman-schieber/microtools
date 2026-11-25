import crypto from 'crypto';

// Answers carry no accounts. Whoever submits an answer gets a random key for it,
// and the poll's creator gets one for the whole poll. Only hashes are stored, so
// the keys never appear in the database or in a page someone else loads.

export type Vote = 'yes' | 'tentative' | 'no';

export interface PollResponse {
  id?: string;
  name: string;
  votes: string[];
  keyHash?: string;
}

export interface PollData {
  title: string;
  slots: Array<{ date: string; time: string }>;
  responses: PollResponse[];
  adminHash?: string;
}

const VOTES: Vote[] = ['yes', 'tentative', 'no'];
export const MAX_NAME = 100;

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

/** Answers from before ids existed get one, so the creator can delete them. Returns true if any changed. */
export function ensureIds(data: PollData): boolean {
  let changed = false;
  for (const r of data.responses) {
    if (!r.id) {
      r.id = crypto.randomBytes(6).toString('base64url');
      changed = true;
    }
  }
  return changed;
}

export function newResponseId(data: PollData): string {
  let id: string;
  do id = crypto.randomBytes(6).toString('base64url');
  while (data.responses.some(r => r.id === id));
  return id;
}

/** One valid vote per slot; anything missing or unknown counts as no. */
export function cleanVotes(raw: string | string[] | undefined, slots: number): string[] {
  const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  return Array.from({ length: slots }, (_, i) => (VOTES as string[]).includes(list[i]) ? list[i] : 'no');
}
