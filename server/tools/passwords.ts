import type { Tool } from './shared';

// Everything happens in public/passwords.js; the server only hands out the page.
export const passwords: Tool = {
  id: 'passwords',
  href: '/passwords/new',
  category: 'local',
  icon: '<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3M17 6l2.5 2.5M14 9l2.5 2.5"/>',

  routes(fastify) {
    fastify.get('/passwords/new', async (request, reply) => {
      return reply.view('passwords/new', { title: request.i18n.t('passwords.title') });
    });
  }
};
