import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Lifetime, Remember, Tool } from './shared';
import { errorP, notFound, requestOrigin, asArray, expiresIn, lifetimeHint } from './shared';
import * as objectStore from '../objectStore';
import { newKey, hashKey, keyMatches, newId } from '../keys';

// A claim on a needed item, or an extra someone brings on their own. Each has
// an id that stays put when others are added or removed, and the hash of the
// key its author got. Claims from before keys existed carry a plain `token`.
type Claim = { id?: string; name: string; amount: number; keyHash?: string; token?: string };
type Needed = { id?: string; item: string; amount_needed: number; claims?: Claim[] };
type Extra = Claim & { item: string };
type BringData = {
  title: string;
  needed: Needed[];
  custom: Extra[];
  /** The organiser's key, hashed: remove any claim, edit the items */
  adminHash?: string;
};

const LIFETIME: Lifetime = { type: 'bringlist', days: 90, from: 'activity' };
const MAX_TEXT = 100;

const remember = (id: string, title: string, expires: number | null): Remember =>
  ({ tool: 'potluck', key: id, path: `/b/${id}`, title, expires });

/** Give every item, claim and extra an id; returns true if any was missing */
function ensureIds(data: BringData): boolean {
  const all: Array<{ id?: string }> = [...data.needed, ...data.needed.flatMap((n) => n.claims || []), ...(data.custom || [])];
  const taken = new Set(all.map((x) => x.id).filter(Boolean));
  let changed = false;
  for (const x of all) {
    if (!x.id) {
      x.id = newId((id) => taken.has(id));
      taken.add(x.id);
      changed = true;
    }
  }
  return changed;
}

function load(id: string) {
  const list = objectStore.get(id);
  if (!list || list.type !== 'bringlist') return null;
  const data = list.data as BringData;
  data.needed ||= [];
  data.custom ||= [];
  ensureIds(data);
  return { list, data };
}

/** A fresh id that no item, claim or extra in this list uses */
function freshId(data: BringData): string {
  const taken = new Set([...data.needed.map((n) => n.id), ...data.needed.flatMap((n) => (n.claims || []).map((c) => c.id)), ...data.custom.map((c) => c.id)]);
  return newId((id) => taken.has(id));
}

/** Store a change; every claim, extra or edit restarts the list's lifetime */
function save(id: string, data: BringData) {
  objectStore.update(id, data, expiresIn(LIFETIME.days));
}

const claimed = (n: Needed) => (n.claims || []).reduce((sum, c) => sum + c.amount, 0);

function sendList(reply: FastifyReply, id: string) {
  return reply.view('bring/_list', { bringlist: objectStore.get(id) });
}

function fail(request: FastifyRequest, reply: FastifyReply, status: number, key: string, params?: Record<string, string | number>) {
  return reply.status(status).type('text/html').send(errorP(request.i18n, key, params));
}

const keyOf = (request: FastifyRequest) => request.headers['x-bring-key'];
const isAdmin = (request: FastifyRequest, data: BringData) => keyMatches(keyOf(request), data.adminHash);

/** Who may remove a claim or extra: its author (new key or old token) or the organiser */
function mayRemove(request: FastifyRequest, data: BringData, c: Claim): boolean {
  const key = keyOf(request);
  return keyMatches(key, c.keyHash) || (!!c.token && key === c.token) || isAdmin(request, data);
}

/** Read an item name and amount from a form, or null if either is missing */
function readItem(request: FastifyRequest): { item: string; amount: number } | null {
  const body = (request.body || {}) as { item?: string; amount?: string };
  const item = (body.item || '').trim().slice(0, MAX_TEXT);
  const amount = parseInt(body.amount || '1', 10);
  return item && amount >= 1 ? { item, amount: Math.min(amount, 999) } : null;
}

// Routes live under /bring (create) and /b (the shared list)
export const potluck: Tool = {
  id: 'potluck',
  href: '/bring/new',
  category: 'plan',
  lifetime: LIFETIME,
  icon: '<path d="M3 17h18M5 17a7 7 0 0 1 14 0"/><path d="M12 8v2"/>',

  routes(fastify) {
    // New list form
    fastify.get('/bring/new', async (request, reply) => {
      return reply.view('bring/new', { title: request.i18n.t('bring.new.title') });
    });

    // Create new list (returns HTML fragment for HTMX). The organiser's key is
    // handed out once, here, and only its hash is stored.
    fastify.post('/bring', async (request, reply) => {
      const body = request.body as { title?: string; 'items[]'?: string | string[]; 'amounts[]'?: string | string[] };
      const title = (body.title || '').trim();
      const items = asArray(body['items[]']);
      const amounts = asArray(body['amounts[]']);

      if (!title) {
        return reply.type('text/html').send(errorP(request.i18n, 'common.err.title'));
      }

      const data: BringData = {
        title,
        needed: items
          .map((item, i) => ({ item: item.trim().slice(0, MAX_TEXT), amount_needed: parseInt(amounts[i] || '1', 10) || 1, claims: [] }))
          .filter((n) => n.item),
        custom: []
      };
      if (data.needed.length === 0) {
        return reply.type('text/html').send(errorP(request.i18n, 'bring.err.items'));
      }
      ensureIds(data);
      const adminKey = newKey();
      data.adminHash = hashKey(adminKey);

      const bringlist = objectStore.create('bringlist', data, expiresIn(LIFETIME.days));
      const url = `${requestOrigin(request)}/b/${bringlist.id}`;
      return reply.view('bring/_created', {
        heading: `${request.i18n.t('bring.created')} <strong>${request.i18n.t('common.shareThisLink')}</strong>`,
        url,
        hint: lifetimeHint(request.i18n, LIFETIME),
        remember: remember(bringlist.id, title, bringlist.expires_at),
        listId: bringlist.id,
        adminKey,
        adminUrl: `${url}#admin=${adminKey}`
      });
    });

    // View list
    fastify.get('/b/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const bringlist = objectStore.get(id);
      if (!bringlist || bringlist.type !== 'bringlist') return notFound(request, reply);

      // Lists from before ids existed get them now. Not a change by anyone, so
      // the list's expiry stays as it is.
      const data = bringlist.data as BringData;
      data.needed ||= [];
      data.custom ||= [];
      if (ensureIds(data)) objectStore.update(id, data);

      return reply.view('bring/show', { title: data.title, bringlist, remember: remember(id, data.title, bringlist.expires_at) });
    });

    // Claim (part of) a needed item. The key for removing the claim comes back
    // once, in a header; public/bring.js keeps it.
    fastify.post('/b/:id/claim/:iid', async (request, reply) => {
      const { id, iid } = request.params as { id: string; iid: string };
      const body = request.body as { name?: string; amount?: string };
      const name = (body.name || '').trim().slice(0, MAX_TEXT);
      const amount = parseInt(body.amount || '1', 10);
      if (!name || !(amount >= 1)) return fail(request, reply, 400, 'bring.err.nameAmount');

      const found = load(id);
      if (!found) return fail(request, reply, 404, 'bring.notFound');
      const item = found.data.needed.find((n) => n.id === iid);
      if (!item) return fail(request, reply, 404, 'bring.err.invalidItem');

      const remaining = item.amount_needed - claimed(item);
      if (amount > remaining) return fail(request, reply, 400, 'bring.err.remaining', { n: remaining });

      const key = newKey();
      const cid = freshId(found.data);
      (item.claims ||= []).push({ id: cid, name, amount, keyHash: hashKey(key) });
      save(id, found.data);

      reply.header('X-Bring-Key', `${cid}.${key}`);
      return sendList(reply, id);
    });

    // Bring something extra
    fastify.post('/b/:id/custom', async (request, reply) => {
      const { id } = request.params as { id: string };
      const name = (((request.body || {}) as { name?: string }).name || '').trim().slice(0, MAX_TEXT);
      const extra = readItem(request);
      if (!name || !extra) return fail(request, reply, 400, 'bring.err.fillAll');

      const found = load(id);
      if (!found) return fail(request, reply, 404, 'bring.notFound');

      const key = newKey();
      const cid = freshId(found.data);
      found.data.custom.push({ id: cid, name, item: extra.item, amount: extra.amount, keyHash: hashKey(key) });
      save(id, found.data);

      reply.header('X-Bring-Key', `${cid}.${key}`);
      return sendList(reply, id);
    });

    // Remove a claim or an extra: your own, or any of them as the organiser
    fastify.delete('/b/:id/claims/:cid', async (request, reply) => {
      const { id, cid } = request.params as { id: string; cid: string };
      const found = load(id);
      if (!found) return fail(request, reply, 404, 'bring.notFound');
      const { data } = found;

      const extra = data.custom.findIndex((c) => c.id === cid);
      const owner = data.needed.find((n) => (n.claims || []).some((c) => c.id === cid));
      const claim = extra !== -1 ? data.custom[extra] : owner?.claims?.find((c) => c.id === cid);
      if (!claim) return fail(request, reply, 404, 'bring.err.invalidClaim');
      if (!mayRemove(request, data, claim)) return fail(request, reply, 403, 'bring.err.cannotDeleteClaim');

      if (extra !== -1) data.custom.splice(extra, 1);
      else owner!.claims = owner!.claims!.filter((c) => c.id !== cid);
      save(id, data);
      return sendList(reply, id);
    });

    // -- The organiser's edits -------------------------------------------------

    // Add a needed item
    fastify.post('/b/:id/items', async (request, reply) => {
      const { id } = request.params as { id: string };
      const found = load(id);
      if (!found) return fail(request, reply, 404, 'bring.notFound');
      if (!isAdmin(request, found.data)) return fail(request, reply, 403, 'bring.err.notOrganiser');
      const item = readItem(request);
      if (!item) return fail(request, reply, 400, 'bring.err.fillAll');

      found.data.needed.push({ id: freshId(found.data), item: item.item, amount_needed: item.amount, claims: [] });
      save(id, found.data);
      return sendList(reply, id);
    });

    // Rename an item or change how many are needed (never below what is claimed)
    fastify.put('/b/:id/items/:iid', async (request, reply) => {
      const { id, iid } = request.params as { id: string; iid: string };
      const found = load(id);
      if (!found) return fail(request, reply, 404, 'bring.notFound');
      if (!isAdmin(request, found.data)) return fail(request, reply, 403, 'bring.err.notOrganiser');
      const target = found.data.needed.find((n) => n.id === iid);
      if (!target) return fail(request, reply, 404, 'bring.err.invalidItem');
      const item = readItem(request);
      if (!item) return fail(request, reply, 400, 'bring.err.fillAll');
      if (item.amount < claimed(target)) return fail(request, reply, 400, 'bring.err.belowClaimed', { n: claimed(target) });

      target.item = item.item;
      target.amount_needed = item.amount;
      save(id, found.data);
      return sendList(reply, id);
    });

    // Remove an item, with whatever was claimed on it
    fastify.delete('/b/:id/items/:iid', async (request, reply) => {
      const { id, iid } = request.params as { id: string; iid: string };
      const found = load(id);
      if (!found) return fail(request, reply, 404, 'bring.notFound');
      if (!isAdmin(request, found.data)) return fail(request, reply, 403, 'bring.err.notOrganiser');
      const index = found.data.needed.findIndex((n) => n.id === iid);
      if (index === -1) return fail(request, reply, 404, 'bring.err.invalidItem');

      found.data.needed.splice(index, 1);
      save(id, found.data);
      return sendList(reply, id);
    });
  }
};
