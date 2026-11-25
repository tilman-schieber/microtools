import type { Tool } from './shared';
import { errorP, plainP, notFound, requestOrigin } from './shared';
import * as objectStore from '../objectStore';
import { renderMarkdown } from '../markdown';

export const notes: Tool = {
  id: 'notes',
  href: '/notes/new',
  category: 'share',
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

      const note = objectStore.create('note', noteData);
      const noteUrl = `${requestOrigin(request)}/notes/${note.id}`;

      return reply.view('_created', { heading: request.i18n.t('notes.created'), url: noteUrl, md: `${noteUrl}/md` });
    });

    // View note page
    fastify.get('/notes/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const note = objectStore.get(id);
      if (!note) return notFound(request, reply);

      return reply.view('notes/show', { title: request.i18n.t('notes.fallbackTitle'), note });
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
        renderedMarkdown: renderMarkdown(data.text)
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
