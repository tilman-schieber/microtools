import crypto from 'crypto';
import type { Lifetime, Tool } from './shared';
import { errorP, expiresIn } from './shared';
import * as objectStore from '../objectStore';

// Short: a secret is meant to be read soon, and one nobody opens should not linger
const LIFETIME: Lifetime = { type: 'secret', days: 7, from: 'creation' };

export const secrets: Tool = {
  id: 'secrets',
  href: '/secrets/new',
  category: 'share',
  lifetime: LIFETIME,
  icon: '<rect x="5" y="11" width="14" height="10" rx="1"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',

  routes(fastify) {
    // Create form page
    fastify.get('/secrets/new', async (request, reply) => {
      return reply.view('secrets/new', {
        title: request.i18n.t('secrets.new.title'),
        lifetime: request.i18n.tn('secrets.lifetime', LIFETIME.days)
      });
    });

    // Store ciphertext (returns HTML fragment)
    fastify.post('/secrets', async (request, reply) => {
      const body = request.body as { ciphertext?: string; keyHash?: string };
      const ciphertext = body.ciphertext || '';
      // SHA-256 of the key (base64url). The reveal request must present it, so a
      // request without the key from the link's #fragment cannot burn the secret.
      const keyHash = /^[A-Za-z0-9_-]{43}$/.test(body.keyHash || '') ? body.keyHash : undefined;

      if (!ciphertext.trim()) {
        return reply.type('text/html').send(errorP(request.i18n, 'secrets.err.noCiphertext'));
      }

      const secret = objectStore.create('secret', { ciphertext: ciphertext.trim(), keyHash }, expiresIn(LIFETIME.days));

      // Return the ID so client JS can build the full URL with fragment
      return reply.type('text/html').send(`/secrets/${secret.id}`);
    });

    // Landing page. Must not consume the secret: Outlook Safe Links, Defender
    // and Teams/Slack previews GET (and HEAD) every link before the recipient
    // clicks it. Only the explicit reveal POST below deletes.
    fastify.get('/secrets/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const secret = objectStore.get(id);

      reply.header('Cache-Control', 'no-store');
      reply.header('X-Robots-Tag', 'noindex');

      if (!secret || secret.type !== 'secret') {
        return reply.view('secrets/gone', { title: request.i18n.t('secrets.gone.title') });
      }

      return reply.view('secrets/show', { title: request.i18n.t('secrets.show.title'), secretId: secret.id });
    });

    // Reveal and delete (one-time access)
    fastify.post('/secrets/:id/reveal', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body || {}) as { keyHash?: string };
      reply.header('Cache-Control', 'no-store');

      const secret = objectStore.get(id);
      if (!secret || secret.type !== 'secret') {
        return reply.code(404).send({ error: 'gone' });
      }

      const data = secret.data as { ciphertext: string; keyHash?: string };

      // Secrets created before key hashes existed have none; let those through.
      if (data.keyHash) {
        const given = Buffer.from(String(body.keyHash || ''));
        const stored = Buffer.from(data.keyHash);
        if (given.length !== stored.length || !crypto.timingSafeEqual(given, stored)) {
          return reply.code(403).send({ error: 'wrongKey' });
        }
      }

      // Only the request that actually deletes the row gets the ciphertext
      if (!objectStore.remove(id)) {
        return reply.code(404).send({ error: 'gone' });
      }

      return reply.send({ ciphertext: data.ciphertext });
    });
  }
};
