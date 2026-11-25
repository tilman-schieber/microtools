import type { Tool } from './shared';
import { requestOrigin } from './shared';
import * as micropage from '../micropage';

// A whole page encoded in its URL. Nothing is stored; see server/micropage.ts.
export const micropageTool: Tool = {
  id: 'micropage',
  href: '/micropage/new',
  category: 'share',
  icon: '<path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1"/><path d="M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1"/>',

  routes(fastify) {
    // Builder
    fastify.get('/micropage/new', async (request, reply) => {
      return reply.view('micropage/new', { title: request.i18n.t('micropage.title') });
    });

    // Documentation: the reference for people and agents alike, in the viewer's
    // language. The Markdown twin serves scripts and agents that prefer plain text.
    fastify.get('/micropage/docs', async (request, reply) => {
      return reply.view('micropage/docs', {
        title: request.i18n.t('crumb.micropageDocs'),
        registry: micropage.localizedRegistry(requestOrigin(request), request.i18n)
      });
    });

    fastify.get('/micropage/docs.md', async (request, reply) => {
      return reply.type('text/markdown; charset=utf-8').view('micropage/docs-md', {
        origin: requestOrigin(request),
        registry: micropage.localizedRegistry(requestOrigin(request), request.i18n)
      });
    });

    // The builder's data source: template, theme and colour lists plus limits
    fastify.get('/micropage/agents', async (request, reply) => {
      return reply
        .type('application/json; charset=utf-8')
        // no-cache, not max-age: the builder reads its template and palette lists from
        // here, so a cached copy silently shows a stale palette after any change. The
        // payload is small, and no-cache still permits a 304.
        .header('Cache-Control', 'no-cache')
        .send(JSON.stringify(micropage.describeRegistry(requestOrigin(request)), null, 2));
    });

    // Render. Everything the page contains comes from the URL; nothing is stored.
    fastify.get('/micropage', async (request, reply) => {
      // The rendered page is attacker-authorable content served from our own origin.
      // script-src 'none' means it can never run script; form-action 'none' means it
      // can never collect credentials.
      reply
        .header('Content-Security-Policy', [
          "default-src 'none'",
          "img-src 'self' https: data:",
          "style-src 'self'",
          "font-src 'self'",
          "script-src 'none'",
          "form-action 'none'",
          // 'self' rather than 'none': the builder at /micropage/new previews pages in an
          // iframe. Third-party sites still cannot embed a micropage.
          "frame-ancestors 'self'",
          "base-uri 'none'",
          "connect-src 'none'"
        ].join('; '))
        .header('X-Content-Type-Options', 'nosniff')
        .header('Referrer-Policy', 'no-referrer')
        .header('X-Robots-Tag', 'noindex, nofollow');

      try {
        const spec = micropage.parseSpec(request.raw.url || '');
        const page = micropage.renderPage(spec);
        // A page is a pure function of its URL, so it is cacheable — but a short window
        // bounds how long an old render survives a template or stylesheet change.
        return reply.header('Cache-Control', 'public, max-age=300').view('micropage/show', { page });
      } catch (err) {
        if (err instanceof micropage.SpecError) {
          return reply.status(400).view('micropage/error', {
            title: request.i18n.t('micropage.title'),
            message: err.message,
            detail: err.detail || ''
          });
        }
        throw err;
      }
    });
  }
};
