import crypto from 'crypto';
import type { Lifetime, Tool } from './shared';
import { errorP, notFound, requestOrigin, asArray, expiresIn, lifetimeHint } from './shared';
import * as objectStore from '../objectStore';

type Claim = { name: string; amount: number; token: string };
type BringData = {
  title: string;
  needed: Array<{ item: string; amount_needed: number; claims?: Claim[] }>;
  custom: Array<{ name: string; item: string; amount: number; token: string }>;
};

const newToken = () => crypto.randomBytes(8).toString('base64url');

// Routes live under /bring (create) and /b (the shared list)
const LIFETIME: Lifetime = { type: 'bringlist', days: 90, from: 'activity' };

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

    // Create new list (returns HTML fragment for HTMX)
    fastify.post('/bring', async (request, reply) => {
      const body = request.body as { title?: string; 'items[]'?: string | string[]; 'amounts[]'?: string | string[] };
      const title = (body.title || '').trim();
      const items = asArray(body['items[]']);
      const amounts = asArray(body['amounts[]']);

      if (!title) {
        return reply.type('text/html').send(errorP(request.i18n, 'common.err.title'));
      }

      const needed = items
        .map((item, i) => ({
          item: item.trim(),
          amount_needed: parseInt(amounts[i] || '1', 10) || 1,
          claims: []
        }))
        .filter(n => n.item);

      if (needed.length === 0) {
        return reply.type('text/html').send(errorP(request.i18n, 'bring.err.items'));
      }

      const bringlist = objectStore.create('bringlist', { title, needed, custom: [] }, expiresIn(LIFETIME.days));

      return reply.view('_created', {
        heading: `${request.i18n.t('bring.created')} <strong>${request.i18n.t('common.shareThisLink')}</strong>`,
        url: `${requestOrigin(request)}/b/${bringlist.id}`,
        hint: lifetimeHint(request.i18n, LIFETIME)
      });
    });

    // View list
    fastify.get('/b/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const bringlist = objectStore.get(id);
      if (!bringlist || bringlist.type !== 'bringlist') return notFound(request, reply);

      return reply.view('bring/show', { title: (bringlist.data as BringData).title, bringlist });
    });

    // Claim an item (returns HTML fragment for HTMX)
    fastify.post('/b/:id/claim/:idx', async (request, reply) => {
      const { id, idx } = request.params as { id: string; idx: string };
      const body = request.body as { name?: string; amount?: string };
      const name = (body.name || '').trim();
      const amount = parseInt(body.amount || '1', 10);

      if (!name || amount < 1) {
        return reply.type('text/html').send(errorP(request.i18n, 'bring.err.nameAmount'));
      }

      const bringlist = objectStore.get(id);
      if (!bringlist || bringlist.type !== 'bringlist') {
        return reply.status(404).type('text/html').send(errorP(request.i18n, 'bring.notFound'));
      }

      const data = bringlist.data as BringData;
      const index = parseInt(idx, 10);
      const needed = data.needed || [];

      if (index < 0 || index >= needed.length) {
        return reply.status(400).type('text/html').send(errorP(request.i18n, 'bring.err.invalidItem'));
      }

      const item = needed[index];
      const totalClaimed = (item.claims || []).reduce((sum, c) => sum + c.amount, 0);
      const remaining = item.amount_needed - totalClaimed;

      if (amount > remaining) {
        return reply.type('text/html').send(errorP(request.i18n, 'bring.err.remaining', { n: remaining }));
      }

      if (!item.claims) item.claims = [];
      const claimToken = newToken();
      item.claims.push({ name, amount, token: claimToken });
      objectStore.update(id, data, expiresIn(LIFETIME.days));

      return reply.view('bring/_list', { bringlist, lastClaimToken: claimToken });
    });

    // Delete a claim (only with matching token)
    fastify.delete('/b/:id/claim/:idx/:claimIdx', async (request, reply) => {
      const { id, idx, claimIdx } = request.params as { id: string; idx: string; claimIdx: string };
      const token = (request.query as { token?: string }).token || '';

      const bringlist = objectStore.get(id);
      if (!bringlist || bringlist.type !== 'bringlist') {
        return reply.status(404).type('text/html').send(errorP(request.i18n, 'bring.notFound'));
      }

      const data = bringlist.data as BringData;
      const itemIndex = parseInt(idx, 10);
      const claimIndex = parseInt(claimIdx, 10);
      const needed = data.needed || [];

      if (itemIndex < 0 || itemIndex >= needed.length) {
        return reply.status(400).type('text/html').send(errorP(request.i18n, 'bring.err.invalidItem'));
      }

      const claims = needed[itemIndex].claims || [];

      if (claimIndex < 0 || claimIndex >= claims.length) {
        return reply.status(400).type('text/html').send(errorP(request.i18n, 'bring.err.invalidClaim'));
      }
      if (!token || claims[claimIndex].token !== token) {
        return reply.status(403).type('text/html').send(errorP(request.i18n, 'bring.err.cannotDeleteClaim'));
      }

      claims.splice(claimIndex, 1);
      objectStore.update(id, data, expiresIn(LIFETIME.days));

      return reply.view('bring/_list', { bringlist });
    });

    // Add custom item (returns HTML fragment for HTMX)
    fastify.post('/b/:id/custom', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { name?: string; item?: string; amount?: string };
      const name = (body.name || '').trim();
      const item = (body.item || '').trim();
      const amount = parseInt(body.amount || '1', 10);

      if (!name || !item || amount < 1) {
        return reply.type('text/html').send(errorP(request.i18n, 'bring.err.fillAll'));
      }

      const bringlist = objectStore.get(id);
      if (!bringlist || bringlist.type !== 'bringlist') {
        return reply.status(404).type('text/html').send(errorP(request.i18n, 'bring.notFound'));
      }

      const data = bringlist.data as BringData;
      if (!data.custom) data.custom = [];
      const claimToken = newToken();
      data.custom.push({ name, item, amount, token: claimToken });
      objectStore.update(id, data, expiresIn(LIFETIME.days));

      return reply.view('bring/_list', { bringlist, lastClaimToken: claimToken });
    });

    // Delete a custom item (only with matching token)
    fastify.delete('/b/:id/custom/:customIdx', async (request, reply) => {
      const { id, customIdx } = request.params as { id: string; customIdx: string };
      const token = (request.query as { token?: string }).token || '';

      const bringlist = objectStore.get(id);
      if (!bringlist || bringlist.type !== 'bringlist') {
        return reply.status(404).type('text/html').send(errorP(request.i18n, 'bring.notFound'));
      }

      const data = bringlist.data as BringData;
      const index = parseInt(customIdx, 10);
      const custom = data.custom || [];

      if (index < 0 || index >= custom.length) {
        return reply.status(400).type('text/html').send(errorP(request.i18n, 'bring.err.invalidItem'));
      }
      if (!token || custom[index].token !== token) {
        return reply.status(403).type('text/html').send(errorP(request.i18n, 'bring.err.cannotDeleteItem'));
      }

      custom.splice(index, 1);
      objectStore.update(id, data, expiresIn(LIFETIME.days));

      return reply.view('bring/_list', { bringlist });
    });
  }
};
