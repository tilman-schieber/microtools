import crypto from 'crypto';
import type { Lifetime, Remember, Tool } from './shared';
import { errorP, plainP, notFound, requestOrigin, asArray, expiresIn, lifetimeHint } from './shared';
import * as objectStore from '../objectStore';

type ExpenseData = {
  title: string;
  currency: string;
  participants: Array<{ name: string; token: string }>;
  entries: Array<{ description: string; amount: number; paid_by: string; split_between: string[] }>;
};

// Long: settling up after a trip can take months
const LIFETIME: Lifetime = { type: 'expense', days: 365, from: 'activity' };

const summary = (id: string, title: string, expires: number | null): Remember =>
  ({ tool: 'expenses', key: id, path: `/e/${id}`, title, expires });

export const expenses: Tool = {
  id: 'expenses',
  href: '/expenses/new',
  category: 'plan',
  lifetime: LIFETIME,
  icon: '<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/>',

  routes(fastify) {
    // Create form page
    fastify.get('/expenses/new', async (request, reply) => {
      return reply.view('expenses/new', { title: request.i18n.t('expenses.new.title') });
    });

    // Create expense share (returns HTML fragment for HTMX)
    fastify.post('/expenses', async (request, reply) => {
      const body = request.body as { title?: string; currency?: string; 'participants[]'?: string | string[] };
      const title = (body.title || '').trim();
      const currency = (body.currency || '€').trim();
      const participantNames = asArray(body['participants[]']).map(n => n.trim()).filter(n => n);

      if (!title) {
        return reply.type('text/html').send(errorP(request.i18n, 'common.err.title'));
      }
      if (participantNames.length < 2) {
        return reply.type('text/html').send(errorP(request.i18n, 'expenses.err.participants'));
      }

      // Each participant gets their own edit link
      const participants = participantNames.map(name => ({
        name,
        token: crypto.randomBytes(8).toString('base64url')
      }));

      const expense = objectStore.create('expense', { title, currency, participants, entries: [] }, expiresIn(LIFETIME.days));

      const base = `${requestOrigin(request)}/e/${expense.id}`;
      const links = participants.map((p) => ({ name: p.name, url: `${base}/p/${p.token}` }));
      return reply.view('expenses/_created', { summaryUrl: base, links, hint: lifetimeHint(request.i18n, LIFETIME), remember: summary(expense.id, title, expense.expires_at) });
    });

    // Summary page (read-only)
    fastify.get('/e/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const expense = objectStore.get(id);
      if (!expense || expense.type !== 'expense') return notFound(request, reply);

      return reply.view('expenses/show', { title: (expense.data as ExpenseData).title, expense, remember: summary(id, (expense.data as ExpenseData).title, expense.expires_at) });
    });

    // Participant page (editable)
    fastify.get('/e/:id/p/:token', async (request, reply) => {
      const { id, token } = request.params as { id: string; token: string };
      const expense = objectStore.get(id);
      if (!expense || expense.type !== 'expense') return notFound(request, reply);

      const data = expense.data as ExpenseData;
      const participant = data.participants.find(p => p.token === token);
      if (!participant) {
        return reply.status(403).type('text/html').send(plainP(request.i18n, 'expenses.invalidToken'));
      }

      return reply.view('expenses/participant', {
        title: data.title,
        expense,
        currentParticipant: participant.name,
        token,
        remember: { tool: 'expenses', key: id, path: `/e/${id}/p/${token}`, title: `${data.title} · ${participant.name}`, expires: expense.expires_at, personal: true }
      });
    });

    // Add entry (returns HTML fragment for HTMX)
    fastify.post('/e/:id/entries', async (request, reply) => {
      const { id } = request.params as { id: string };
      const query = request.query as { token?: string };
      const body = request.body as { description?: string; amount?: string; 'split[]'?: string | string[] };

      const expense = objectStore.get(id);
      if (!expense || expense.type !== 'expense') {
        return reply.type('text/html').send(plainP(request.i18n, 'expenses.notFound'));
      }

      const data = expense.data as ExpenseData;
      const participant = data.participants.find(p => p.token === query.token);
      if (!participant) {
        return reply.status(403).type('text/html').send(plainP(request.i18n, 'expenses.invalidToken'));
      }

      const description = (body.description || '').trim();
      const amount = parseFloat(body.amount || '0');
      const split_between = asArray(body['split[]']);

      if (!description) {
        return reply.type('text/html').send(errorP(request.i18n, 'expenses.err.description'));
      }
      if (amount <= 0) {
        return reply.type('text/html').send(errorP(request.i18n, 'expenses.err.amount'));
      }
      if (split_between.length === 0) {
        return reply.type('text/html').send(errorP(request.i18n, 'expenses.err.split'));
      }

      data.entries.push({ description, amount, paid_by: participant.name, split_between });
      objectStore.update(id, data, expiresIn(LIFETIME.days));

      return reply.view('expenses/_entries', {
        expense: objectStore.get(id),
        currentParticipant: participant.name,
        token: query.token
      });
    });

    // Delete entry (returns HTML fragment for HTMX)
    fastify.delete('/e/:id/entries/:idx', async (request, reply) => {
      const { id, idx } = request.params as { id: string; idx: string };
      const query = request.query as { token?: string };

      const expense = objectStore.get(id);
      if (!expense || expense.type !== 'expense') {
        return reply.type('text/html').send(plainP(request.i18n, 'expenses.notFound'));
      }

      const data = expense.data as ExpenseData;
      const participant = data.participants.find(p => p.token === query.token);
      if (!participant) {
        return reply.status(403).type('text/html').send(plainP(request.i18n, 'expenses.invalidToken'));
      }

      const index = parseInt(idx);
      if (index >= 0 && index < data.entries.length) {
        data.entries.splice(index, 1);
        objectStore.update(id, data, expiresIn(LIFETIME.days));
      }

      return reply.view('expenses/_entries', {
        expense: objectStore.get(id),
        currentParticipant: participant.name,
        token: query.token
      });
    });
  }
};
