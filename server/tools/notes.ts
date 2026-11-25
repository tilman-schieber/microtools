import type { Lifetime, Remember, Tool } from './shared';
import { errorP, plainP, notFound, requestOrigin, expiresIn, lifetimeHint } from './shared';
import * as objectStore from '../objectStore';
import { renderMarkdown } from '../markdown';

const LIFETIME: Lifetime = { type: 'note', days: 180, from: 'creation' };

type NoteData = { text: string; title?: string };

/** The note's title, or its first line without Markdown heading marks */
function noteTitle(data: NoteData): string {
  if (data.title) return data.title;
  const first = data.text.split('\n').find((line) => line.trim()) || '';
  return first.replace(/^#+\s*/, '').trim().slice(0, 80);
}

const remember = (id: string, data: NoteData, expires: number | null): Remember =>
  ({ tool: 'notes', key: id, path: `/notes/${id}`, title: noteTitle(data), expires });

export const notes: Tool = {
  id: 'notes',
  href: '/notes/new',
  category: 'share',
  lifetime: LIFETIME,
  icon: '<path d="M5 3h8l4 4v14H5z"/><path d="M13 3v4h4"/><path d="M8 12h8M8 16h8"/>',

  routes(fastify) {
    // Create form page
    fastify.get('/notes/new', async (request, reply) => {
      return reply.view('notes/new', { title: request.i18n.t('notes.new.title') });
    });

    // Create note (returns HTML fragment for HTMX)
    fastify.post('/notes', async (request, reply) => {
      const body = request.body as { text?: string; title?: string };
      const text = body.text || '';
      const title = (body.title || '').trim();

      if (!text.trim()) {
        return reply.type('text/html').send(errorP(request.i18n, 'notes.err.empty'));
      }

      const noteData: { text: string; title?: string } = { text: text.trim() };
      if (title) noteData.title = title;

      const note = objectStore.create('note', noteData, expiresIn(LIFETIME.days));
      const noteUrl = `${requestOrigin(request)}/notes/${note.id}`;

      return reply.view('_created', { heading: request.i18n.t('notes.created'), url: noteUrl, md: `${noteUrl}/md`, hint: lifetimeHint(request.i18n, LIFETIME), remember: remember(note.id, noteData, note.expires_at) });
    });

    // View note page
    fastify.get('/notes/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const note = objectStore.get(id);
      if (!note) return notFound(request, reply);

      return reply.view('notes/show', { title: request.i18n.t('notes.fallbackTitle'), note, remember: remember(id, note.data as NoteData, note.expires_at) });
    });

    // Raw text view
    fastify.get('/notes/:id/raw', async (request, reply) => {
      const { id } = request.params as { id: string };
      const note = objectStore.get(id);
      if (!note) return reply.status(404).type('text/plain').send('Not found');

      return reply.type('text/plain').send((note.data as { text: string }).text);
    });

    // Markdown rendered view
    fastify.get('/notes/:id/md', async (request, reply) => {
      const { id } = request.params as { id: string };
      const note = objectStore.get(id);
      if (!note) return notFound(request, reply);

      const data = note.data as { text: string; title?: string };
      return reply.view('notes/md', {
        title: data.title || request.i18n.t('notes.fallbackTitle'),
        note,
        renderedMarkdown: renderMarkdown(data.text),
        remember: remember(id, data, note.expires_at)
      });
    });

    // Delete note (returns HTML fragment for HTMX)
    fastify.delete('/notes/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!objectStore.remove(id)) {
        return reply.type('text/html').send(plainP(request.i18n, 'notes.notFound'));
      }
      return reply.type('text/html').send(`<p>${request.i18n.t('notes.deleted')}</p><p><a href="/notes/new">${request.i18n.t('notes.createAnother')}</a></p>`);
    });
  }
};
