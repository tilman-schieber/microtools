import Fastify, { type FastifyInstance } from 'fastify';
import fastifyView from '@fastify/view';
import fastifyStatic from '@fastify/static';
import fastifyFormbody from '@fastify/formbody';
import fastifyMultipart from '@fastify/multipart';
import fastifyRateLimit from '@fastify/rate-limit';
import ejs from 'ejs';
import { i18n, resolveLang, isLang, langCookie, clientStrings, plainText, LANGS, type I18n } from './i18n';
import { VIEWS_DIR, PUBLIC_DIR } from './paths';
import * as objectStore from './objectStore';
import { TOOLS, toolGroups } from './tools';
import { expiresIn } from './tools/shared';
import { UPLOAD_LIMIT_BYTES } from './tools/files';

declare module 'fastify' {
  interface FastifyRequest { i18n: I18n }
  interface FastifyReply { locals?: object }
}

/**
 * The whole application, ready but not listening. server/index.ts starts it;
 * the smoke tests call it through fastify.inject() without opening a port.
 */
export async function buildApp(options: { logger?: boolean; rateLimit?: boolean } = {}): Promise<FastifyInstance> {
  const fastify = Fastify({
    trustProxy: trustProxy(process.env.TRUST_PROXY),
    logger: options.logger === false ? false : {
      serializers: {
        // A micropage's entire content lives in its query string, so logging the
        // full URL would copy every page (including anything private someone
        // pasted) into the log. Keep the path, drop the query.
        req(request: { method: string; url: string; hostname?: string; ip?: string }) {
          const url = request.url.startsWith('/micropage')
            ? request.url.split('?')[0] + (request.url.includes('?') ? '?[redacted]' : '')
            : request.url;
          return { method: request.method, url, hostname: request.hostname, remoteAddress: request.ip };
        }
      }
    }
  });

  // Writes are rate-limited per client IP; reading is not. Uploads get a
  // tighter budget of their own, since they are what costs disk space.
  if (options.rateLimit !== false) {
    await fastify.register(fastifyRateLimit, {
      global: true,
      max: (request) => (request.method === 'POST' && request.url === '/files' ? 20 : 60),
      timeWindow: (request) => (request.method === 'POST' && request.url === '/files' ? 60 * 60 * 1000 : 60 * 1000),
      allowList: (request) => request.method === 'GET' || request.method === 'HEAD',
      errorResponseBuilder: (_request, context) => ({ statusCode: context.statusCode, rateLimited: true })
    });
  }

  // Rate-limited requests mostly come from htmx forms, so answer in the same
  // HTML fragment the form would show for any other error.
  fastify.setErrorHandler((error: { statusCode?: number; rateLimited?: boolean }, request, reply) => {
    if (error.rateLimited) {
      return reply.status(429).type('text/html').send(`<p class="error">${request.i18n.t('common.err.tooMany')}</p>`);
    }
    throw error;
  });

  await fastify.register(fastifyFormbody);
  await fastify.register(fastifyMultipart, {
    limits: {
      fileSize: UPLOAD_LIMIT_BYTES, // no single file can exceed the whole upload's limit
      files: 20 // max 20 files
    }
  });

  await fastify.register(fastifyView, {
    engine: {
      ejs: ejs
    },
    root: VIEWS_DIR,
    viewExt: 'ejs'
  });

  await fastify.register(fastifyStatic, {
    root: PUBLIC_DIR,
    prefix: '/public/'
  });

  // Language. Every request gets an i18n object; every view gets t() and friends
  // through reply.locals, so no route has to pass them along.
  fastify.decorateRequest('i18n', null as unknown as I18n);
  fastify.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/public/')) return;

    // An explicit ?lang= is a choice: remember it, then redirect to the clean URL
    // so the parameter does not end up in links people copy from the address bar.
    const url = new URL(request.url, 'http://x');
    const chosen = url.searchParams.get('lang');
    if (request.method === 'GET' && isLang(chosen)) {
      url.searchParams.delete('lang');
      return reply.header('Set-Cookie', langCookie(chosen)).redirect(url.pathname + url.search, 302);
    }

    const lang = resolveLang(request.headers);
    const tr = i18n(lang);
    request.i18n = tr;

    // Switcher links: the current URL plus ?lang=
    const join = url.search ? '&' : '?';
    const langLinks = LANGS.map((code) => ({
      code,
      label: code.toUpperCase(),
      current: code === lang,
      href: url.pathname + url.search + join + 'lang=' + code
    }));

    reply.locals = {
      t: tr.t, tn: tr.tn, fmtDate: tr.fmtDate, fmtMoney: tr.fmtMoney, plain: plainText,
      lang, langLinks, clientT: clientStrings(lang)
    };

    // A rendered micropage is a pure function of its URL and is cached as such;
    // everything else depends on who is looking.
    if (!request.url.startsWith('/micropage?')) reply.header('Vary', 'Accept-Language, Cookie');
  });

  // Home page: the tools, grouped by what you want to do
  fastify.get('/', async (request, reply) => {
    return reply.view('index', { title: 'Microtools', groups: toolGroups() });
  });

  // Unknown routes get the styled page rather than Fastify's JSON body
  fastify.setNotFoundHandler(async (request, reply) => {
    return reply.status(404).view('404', { title: request.i18n.t('notFound.title') });
  });

  // Objects stored before lifetimes existed get one now, counted from today
  for (const tool of TOOLS) {
    if (tool.lifetime) objectStore.backfillExpiry(tool.lifetime.type, expiresIn(tool.lifetime.days));
  }

  // Each tool registers its own routes; see server/tools/
  for (const tool of TOOLS) {
    await tool.routes(fastify);
  }

  return fastify;
}

/** Delete expired objects, and whatever each tool keeps for them outside the database. */
export function purgeExpired(): number {
  const purged = objectStore.purgeExpired();
  for (const row of purged) {
    for (const tool of TOOLS) tool.onPurge?.(row);
  }
  return purged.length;
}

/**
 * Which proxies may tell us the client's address (X-Forwarded-For). The default,
 * loopback, fits nginx on the same machine and cannot be spoofed by a client
 * that connects directly. Without it, every visitor would share the proxy's IP
 * and so one rate limit.
 */
function trustProxy(value: string | undefined): boolean | string | number {
  if (value === undefined || value === '') return 'loopback';
  if (value === 'true' || value === 'false') return value === 'true';
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  return value;
}
