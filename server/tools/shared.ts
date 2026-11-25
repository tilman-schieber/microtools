import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { I18n } from '../i18n';

/**
 * What the landing page shows a tool under. The grouping follows what a visitor
 * wants to do, and it happens to say what becomes of their data as well:
 * plan  – others open the link and add to it
 * share – you write it, they read it
 * local – runs in the browser, nothing is stored
 */
export type Category = 'plan' | 'share' | 'local';

export const CATEGORIES: readonly Category[] = ['plan', 'share', 'local'];

/** A stored object as the object store hands it back. */
export interface StoredRow { id: string; type: string }

/**
 * How long a tool's stored objects live. 'creation' counts from when the
 * object was made; 'activity' restarts the count on every change, so a poll
 * or expense group that is still in use never disappears.
 */
export interface Lifetime {
  /** The objectStore type this applies to */
  type: string;
  days: number;
  from: 'creation' | 'activity';
}

const DAY = 24 * 60 * 60 * 1000;

/** Timestamp `days` from now */
export const expiresIn = (days: number) => Date.now() + days * DAY;

/** The sentence under a freshly created link that says when it goes away */
export function lifetimeHint(tr: I18n, lifetime: Lifetime): string {
  return tr.tn(lifetime.from === 'activity' ? 'lifetime.activity' : 'lifetime.creation', lifetime.days);
}

export interface Tool {
  /** Locale prefix: the landing page reads tool.<id>.name and tool.<id>.desc */
  id: string;
  /** Where the landing page links to */
  href: string;
  category: Category;
  /** SVG path data for a 24×24, 1.5px-stroke icon */
  icon: string;
  routes(fastify: FastifyInstance): void | Promise<void>;
  /** Default lifetime of what the tool stores; tools that store nothing leave it out */
  lifetime?: Lifetime;
  /** Called by the hourly cleanup for each expired object, e.g. to delete files on disk */
  onPurge?(row: StoredRow): void;
}

/** Scheme + host for the current request, honouring the reverse proxy's forwarded proto. */
export function requestOrigin(request: { headers: Record<string, unknown> }): string {
  const protocol = (request.headers['x-forwarded-proto'] as string) || 'http';
  return `${protocol}://${request.headers.host}`;
}

export const errorP = (tr: I18n, key: string, params?: Record<string, string | number>) =>
  `<p class="error">${tr.t(key, params)}</p>`;

export const plainP = (tr: I18n, key: string) => `<p>${tr.t(key)}</p>`;

/** The styled 404 page */
export function notFound(request: FastifyRequest, reply: FastifyReply) {
  return reply.status(404).view('404', { title: request.i18n.t('notFound.title') });
}

/** Form fields named foo[] arrive as a string when only one was sent */
export function asArray(value: string | string[] | undefined): string[] {
  return Array.isArray(value) ? value : (value ? [value] : []);
}
