import type { Tool } from './shared';

// Everything happens in public/qr.js; the server only hands out the page.
export const qr: Tool = {
  id: 'qr',
  href: '/qr',
  category: 'local',
  icon: '<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1"/><path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM14 20.5h1M20.5 14v1"/>',

  routes(fastify) {
    fastify.get('/qr', async (request, reply) => {
      return reply.view('qr/new', { title: request.i18n.t('qr.title') });
    });
  }
};
