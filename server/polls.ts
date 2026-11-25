import crypto from 'crypto';
import { newKey, hashKey, keyMatches } from './keys';

// Answers carry no accounts. Whoever submits an answer gets a random key for it,
// and the poll's creator gets one for the whole poll (see server/keys.ts).
export { newKey, hashKey, keyMatches };

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
