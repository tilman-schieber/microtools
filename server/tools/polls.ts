import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Lifetime, Remember, Tool } from './shared';
import { errorP, notFound, requestOrigin, asArray, expiresIn, lifetimeHint } from './shared';
import * as objectStore from '../objectStore';
import * as pollKeys from '../polls';

type PollData = pollKeys.PollData;

const LIFETIME: Lifetime = { type: 'poll', days: 90, from: 'activity' };

const remember = (id: string, title: string, expires: number | null): Remember =>
  ({ tool: 'polls', key: id, path: `/polls/${id}`, title, expires });

function loadPoll(id: string) {
  const poll = objectStore.get(id);
  if (!poll || poll.type !== 'poll') return null;
  const data = poll.data as PollData;
  pollKeys.ensureIds(data);
  return { poll, data };
}

function readAnswer(request: FastifyRequest, data: PollData) {
  const body = (request.body || {}) as { name?: string; 'votes[]'?: string | string[] };
  const name = (body.name || '').trim().slice(0, pollKeys.MAX_NAME);
  return { name, votes: pollKeys.cleanVotes(body['votes[]'], data.slots.length) };
}

/** Store a change; every answer, edit or deletion restarts the poll's lifetime */
function save(id: string, data: PollData) {
  objectStore.update(id, data, expiresIn(LIFETIME.days));
}

function sendContainer(reply: FastifyReply, id: string) {
  return reply.view('polls/_container', { poll: objectStore.get(id) });
}

function pollError(request: FastifyRequest, reply: FastifyReply, status: number, key: string) {
  return reply.status(status).type('text/html').send(errorP(request.i18n, key));
}

export const polls: Tool = {
  id: 'polls',
  href: '/polls/new',
  category: 'plan',
  lifetime: LIFETIME,
  icon: '<rect x="3" y="5" width="18" height="16" rx="1"/><path d="M3 10h18M8 3v4M16 3v4"/>',

  routes(fastify) {
    // Create form page
    fastify.get('/polls/new', async (request, reply) => {
      return reply.view('polls/new', { title: request.i18n.t('polls.new.title') });
    });

    // Create poll (returns HTML fragment for HTMX). The creator's admin key is
    // handed out once, here, and only its hash is stored.
    fastify.post('/polls', async (request, reply) => {
      const body = request.body as { title?: string; 'dates[]'?: string | string[]; 'times[]'?: string | string[] };
      const title = (body.title || '').trim();
      const dates = asArray(body['dates[]']);
      const times = asArray(body['times[]']);

      if (!title) {
        return reply.type('text/html').send(errorP(request.i18n, 'common.err.title'));
      }
      if (dates.length === 0 || dates.length !== times.length) {
        return reply.type('text/html').send(errorP(request.i18n, 'polls.err.slots'));
      }

      const slots = dates.map((date, i) => ({ date, time: times[i] }));
      const adminKey = pollKeys.newKey();
      const poll = objectStore.create('poll', {
        title,
        slots,
        responses: [],
        adminHash: pollKeys.hashKey(adminKey)
      } satisfies PollData, expiresIn(LIFETIME.days));

      const pollUrl = `${requestOrigin(request)}/polls/${poll.id}`;
      return reply.view('polls/_created', {
        heading: request.i18n.t('polls.created'),
        url: pollUrl,
        hint: lifetimeHint(request.i18n, LIFETIME),
        remember: remember(poll.id, title, poll.expires_at),
        pollId: poll.id,
        adminKey,
        adminUrl: `${pollUrl}#admin=${adminKey}`
      });
    });

    // View poll page
    fastify.get('/polls/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const poll = objectStore.get(id);
      if (!poll || poll.type !== 'poll') return notFound(request, reply);

      // Answers from before ids existed get one now, so the creator can delete them.
      // Not a change by anyone, so the poll's expiry stays as it is.
      const data = poll.data as PollData;
      if (pollKeys.ensureIds(data)) objectStore.update(id, data);

      return reply.view('polls/show', {
        title: data.title || request.i18n.t('polls.fallbackTitle'),
        poll,
        remember: remember(id, data.title, poll.expires_at)
      });
    });

    // Answers are sent with fetch from public/polls.js. Success returns the
    // re-rendered #poll-container; errors return a message with a 4xx status.

    // Add response. The key for editing it comes back once, in a header.
    fastify.post('/polls/:id/responses', async (request, reply) => {
      const { id } = request.params as { id: string };
      const found = loadPoll(id);
      if (!found) return pollError(request, reply, 404, 'polls.notFound');

      const { name, votes } = readAnswer(request, found.data);
      if (!name) return pollError(request, reply, 400, 'polls.err.name');

      const rid = pollKeys.newResponseId(found.data);
      const key = pollKeys.newKey();
      found.data.responses.push({ id: rid, name, votes, keyHash: pollKeys.hashKey(key) });
      save(id, found.data);

      reply.header('X-Poll-Response', `${rid}.${key}`);
      return sendContainer(reply, id);
    });

    // Change your own response
    fastify.put('/polls/:id/responses/:rid', async (request, reply) => {
      const { id, rid } = request.params as { id: string; rid: string };
      const found = loadPoll(id);
      if (!found) return pollError(request, reply, 404, 'polls.notFound');
      const response = found.data.responses.find(r => r.id === rid);
      if (!response) return pollError(request, reply, 404, 'polls.err.gone');
      if (!pollKeys.keyMatches(request.headers['x-poll-key'], response.keyHash)) {
        return pollError(request, reply, 403, 'polls.err.notYours');
      }

      const { name, votes } = readAnswer(request, found.data);
      if (!name) return pollError(request, reply, 400, 'polls.err.name');
      response.name = name;
      response.votes = votes;
      save(id, found.data);
      return sendContainer(reply, id);
    });

    // Delete a response: your own, or any of them with the creator's key
    fastify.delete('/polls/:id/responses/:rid', async (request, reply) => {
      const { id, rid } = request.params as { id: string; rid: string };
      const found = loadPoll(id);
      if (!found) return pollError(request, reply, 404, 'polls.notFound');
      const index = found.data.responses.findIndex(r => r.id === rid);
      if (index === -1) return pollError(request, reply, 404, 'polls.err.gone');
      const key = request.headers['x-poll-key'];
      if (!pollKeys.keyMatches(key, found.data.responses[index].keyHash) && !pollKeys.keyMatches(key, found.data.adminHash)) {
        return pollError(request, reply, 403, 'polls.err.notYours');
      }

      found.data.responses.splice(index, 1);
      save(id, found.data);
      return sendContainer(reply, id);
    });
  }
};
