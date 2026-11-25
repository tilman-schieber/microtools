import type { Tool } from './shared';

export const clock: Tool = {
  id: 'clock',
  href: '/clock/new',
  category: 'local',
  icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',

  routes(fastify) {
    // Configuration page
    fastify.get('/clock/new', async (request, reply) => {
      return reply.view('clock/new', { title: request.i18n.t('clock.title') });
    });

    // Display page, configured entirely by URL params
    fastify.get('/clock', async (request, reply) => {
      return reply.view('clock/show', { title: request.i18n.t('clock.title') });
    });
  }
};
