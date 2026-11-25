import type { Tool } from './shared';

// Passwords, passphrases, picks, teams, dice and numbers. Everything happens in
// the browser (public/passwords.js, public/random.js); the server only hands
// out the page.
export const random: Tool = {
  id: 'random',
  href: '/random',
  category: 'local',
  icon: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><circle cx="8.5" cy="8.5" r="1" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1" fill="currentColor"/>',

  routes(fastify) {
    fastify.get('/random', async (request, reply) => {
      return reply.view('random/new', { title: request.i18n.t('random.title') });
    });

    // The tool's old home; links and bookmarks to it keep working
    fastify.get('/passwords/new', async (_request, reply) => reply.redirect('/random', 301));
  }
};
