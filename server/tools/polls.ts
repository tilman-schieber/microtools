import type { Tool } from './shared';
import { errorP, plainP, notFound, requestOrigin, asArray } from './shared';
import * as objectStore from '../objectStore';

type PollData = {
  title: string;
  slots: Array<{ date: string; time: string }>;
  responses: Array<{ name: string; votes: string[] }>;
};

export const polls: Tool = {
  id: 'polls',
  href: '/polls/new',
  category: 'plan',
  icon: '<rect x="3" y="5" width="18" height="16" rx="1"/><path d="M3 10h18M8 3v4M16 3v4"/>',

  routes(fastify) {
    // Create form page
    fastify.get('/polls/new', async (request, reply) => {
      return reply.view('polls/new', { title: request.i18n.t('polls.new.title') });
    });

    // Create poll (returns HTML fragment for HTMX)
    fastify.post('/polls', async (request, reply) => {
      const body = request.body as { title?: string; 'dates[]'?: string | string[]; 'times[]'?: string | string[] };
      const title = body.title || '';
      const dates = asArray(body['dates[]']);
      const times = asArray(body['times[]']);

      if (!title.trim()) {
        return reply.type('text/html').send(errorP(request.i18n, 'common.err.title'));
      }
      if (dates.length === 0 || dates.length !== times.length) {
        return reply.type('text/html').send(errorP(request.i18n, 'polls.err.slots'));
      }

      const slots = dates.map((date, i) => ({ date, time: times[i] }));
      const poll = objectStore.create('poll', { title: title.trim(), slots, responses: [] });

      return reply.view('_created', { heading: request.i18n.t('polls.created'), url: `${requestOrigin(request)}/polls/${poll.id}` });
    });

    // View poll page
    fastify.get('/polls/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const poll = objectStore.get(id);
      if (!poll) return notFound(request, reply);

      return reply.view('polls/show', {
        title: (poll.data as PollData).title || request.i18n.t('polls.fallbackTitle'),
        poll
      });
    });

    // Add response (returns HTML fragment for HTMX)
    fastify.post('/polls/:id/responses', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { name?: string; 'votes[]'?: string | string[] };

      const poll = objectStore.get(id);
      if (!poll) {
        return reply.type('text/html').send(plainP(request.i18n, 'polls.notFound'));
      }

      const name = (body.name || '').trim();
      const votes = asArray(body['votes[]']);

      if (!name) {
        return reply.type('text/html').send(errorP(request.i18n, 'polls.err.name'));
      }

      const data = poll.data as PollData;
      data.responses.push({ name, votes });
      objectStore.update(id, data);

      return reply.view('polls/_container', { poll: objectStore.get(id) });
    });
  }
};
