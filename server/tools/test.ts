import type { Tool } from './shared';
import { notFound } from './shared';

// Device and browser checks. Everything runs in the browser; the server only
// hands out the pages.
const TESTS = ['camera', 'microphone', 'speakers', 'gamepad', 'keyboard', 'pointer', 'browser'];

export const test: Tool = {
  id: 'test',
  href: '/test',
  category: 'local',
  icon: '<rect x="3" y="4" width="18" height="12" rx="1"/><path d="M8 20h8M12 16v4"/><path d="M7 10l2.5 2.5L15 7"/>',

  routes(fastify) {
    fastify.get('/test', async (request, reply) => {
      return reply.view('test/index', { title: request.i18n.t('test.title'), tests: TESTS });
    });

    fastify.get<{ Params: { kind: string } }>('/test/:kind', async (request, reply) => {
      const { kind } = request.params;
      if (!TESTS.includes(kind)) return notFound(request, reply);
      return reply.view(`test/${kind}`, { title: `${request.i18n.t(`test.${kind}.name`)} · ${request.i18n.t('test.title')}` });
    });
  }
};
