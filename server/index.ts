import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import Fastify from 'fastify';
import fastifyView from '@fastify/view';
import fastifyStatic from '@fastify/static';
import fastifyFormbody from '@fastify/formbody';
import fastifyMultipart from '@fastify/multipart';
import ejs from 'ejs';
import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import markedKatex from 'marked-katex-extension';
import hljs from 'highlight.js';
import archiver from 'archiver';
import { safeUrlRenderer } from './safeMarkdown';
import * as micropage from './micropage';
import { i18n, resolveLang, isLang, langCookie, clientStrings, escapeHtml, LANGS, type I18n } from './i18n';

declare module 'fastify' {
  interface FastifyRequest { i18n: I18n }
  interface FastifyReply { locals?: object }
}

// Sanitize markdown: escape raw HTML instead of passing it through
marked.use({
  renderer: {
    html(token: { text: string }) {
      return escapeHtml(token.text);
    },
    // marked does not sanitize URLs or escape image alt text; see server/safeMarkdown.ts
    ...safeUrlRenderer
  }
});

// Syntax highlighting: server-side, so the client needs only the theme CSS
marked.use(markedHighlight({
  emptyLangClass: 'hljs',
  langPrefix: 'hljs language-',
  highlight(code: string, lang: string) {
    const language = hljs.getLanguage(lang) ? lang : 'plaintext';
    return hljs.highlight(code, { language }).value;
  }
}));

// Math: $inline$ and $$display$$. MathML output needs no fonts, CSS or client JS.
// throwOnError keeps a stray $ in a note from breaking the whole page. Standard
// delimiter rules (no nonStandard) require the $ to hug the expression, so prose
// prices like "$5 and $10" are not swallowed as math.
marked.use(markedKatex({
  output: 'mathml',
  throwOnError: false
}));
import './db';
import * as objectStore from './objectStore';

const FILES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'files');

// Ensure files directory exists
if (!fs.existsSync(FILES_DIR)) {
  fs.mkdirSync(FILES_DIR, { recursive: true });
}

/** Clean up orphaned file directory (e.g. after lazy expiration deletes the DB row). */
function cleanupShareDir(shareId: string): void {
  const shareDir = path.join(FILES_DIR, shareId);
  if (fs.existsSync(shareDir)) {
    fs.rmSync(shareDir, { recursive: true, force: true });
  }
}

/** Scheme + host for the current request, honouring the reverse proxy's forwarded proto. */
function requestOrigin(request: { headers: Record<string, unknown> }): string {
  const protocol = (request.headers['x-forwarded-proto'] as string) || 'http';
  return `${protocol}://${request.headers.host}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fastify = Fastify({
  logger: {
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

function log(message: string, source = "fastify") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

async function start() {
  await fastify.register(fastifyFormbody);
  await fastify.register(fastifyMultipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB max per file
      files: 20 // max 20 files
    }
  });

  await fastify.register(fastifyView, {
    engine: {
      ejs: ejs
    },
    root: path.join(__dirname, '..', 'views'),
    viewExt: 'ejs'
  });

  await fastify.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'public'),
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
      t: tr.t, tn: tr.tn, fmtDate: tr.fmtDate, fmtMoney: tr.fmtMoney,
      lang, langLinks, clientT: clientStrings(lang)
    };

    // A rendered micropage is a pure function of its URL and is cached as such;
    // everything else depends on who is looking.
    if (!request.url.startsWith('/micropage?')) reply.header('Vary', 'Accept-Language, Cookie');
  });

  const errorP = (tr: I18n, key: string, params?: Record<string, string | number>) => `<p class="error">${tr.t(key, params)}</p>`;
  const plainP = (tr: I18n, key: string) => `<p>${tr.t(key)}</p>`;

  // Home page
  fastify.get('/', async (request, reply) => {
    return reply.view('index', {
      title: 'Microtools'
    });
  });

  // Unknown routes get the styled page rather than Fastify's JSON body
  fastify.setNotFoundHandler(async (request, reply) => {
    return reply.status(404).view('404', { title: request.i18n.t('notFound.title') });
  });

  // Passwords: Generator page
  fastify.get('/passwords/new', async (request, reply) => {
    return reply.view('passwords/new', {
      title: request.i18n.t('passwords.title')
    });
  });

  // Clock: Configuration page
  fastify.get('/clock/new', async (request, reply) => {
    return reply.view('clock/new', {
      title: request.i18n.t('clock.title')
    });
  });

  // Clock: Display page configured entirely by URL params
  fastify.get('/clock', async (request, reply) => {
    return reply.view('clock/show', {
      title: request.i18n.t('clock.title')
    });
  });

  // ============ Micropage (a whole page encoded in its URL) ============

  // Builder
  fastify.get('/micropage/new', async (request, reply) => {
    return reply.view('micropage/new', { title: request.i18n.t('micropage.title') });
  });

  // Human documentation, generated from the same registry as /agents
  fastify.get('/micropage/docs', async (request, reply) => {
    return reply.view('micropage/docs', {
      title: 'Micropage docs',
      registry: micropage.describeRegistry(requestOrigin(request))
    });
  });

  // Machine-readable description, for agents composing micropage URLs
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

  // Notes: Create form page
  fastify.get('/notes/new', async (request, reply) => {
    return reply.view('notes/new', {
      title: request.i18n.t('notes.new.title')
    });
  });

  // Notes: Create note (returns HTML fragment for HTMX)
  fastify.post('/notes', async (request, reply) => {
    const body = request.body as { text?: string; title?: string };
    const text = body.text || '';
    const title = (body.title || '').trim();

    if (!text.trim()) {
      return reply.type('text/html').send(errorP(request.i18n, 'notes.err.empty'));
    }

    const noteData: { text: string; title?: string } = { text: text.trim() };
    if (title) {
      noteData.title = title;
    }

    const note = objectStore.create('note', noteData);
    const protocol = request.headers['x-forwarded-proto'] || 'http';
    const host = request.headers.host;
    const noteUrl = `${protocol}://${host}/notes/${note.id}`;

    return reply.view('_created', { heading: request.i18n.t('notes.created'), url: noteUrl, md: `${noteUrl}/md` });
  });

  // Notes: View note page
  fastify.get('/notes/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const note = objectStore.get(params.id);

    if (!note) {
      return reply.status(404).view('404', { title: request.i18n.t('notFound.title') });
    }

    return reply.view('notes/show', {
      title: request.i18n.t('notes.fallbackTitle'),
      note
    });
  });

  // Notes: Raw text view
  fastify.get('/notes/:id/raw', async (request, reply) => {
    const params = request.params as { id: string };
    const note = objectStore.get(params.id);

    if (!note) {
      return reply.status(404).type('text/plain').send('Not found');
    }

    const data = note.data as { text: string };
    return reply.type('text/plain').send(data.text);
  });

  // Notes: Markdown rendered view
  fastify.get('/notes/:id/md', async (request, reply) => {
    const params = request.params as { id: string };
    const note = objectStore.get(params.id);

    if (!note) {
      return reply.status(404).view('404', { title: request.i18n.t('notFound.title') });
    }

    const data = note.data as { text: string; title?: string };
    const renderedMarkdown = marked(data.text);

    return reply.view('notes/md', {
      title: data.title || request.i18n.t('notes.fallbackTitle'),
      note,
      renderedMarkdown
    });
  });

  // Notes: Delete note (returns HTML fragment for HTMX)
  fastify.delete('/notes/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const deleted = objectStore.remove(params.id);

    if (!deleted) {
      return reply.type('text/html').send(plainP(request.i18n, 'notes.notFound'));
    }

    return reply.type('text/html').send(`<p>${request.i18n.t('notes.deleted')}</p><p><a href="/notes/new">${request.i18n.t('notes.createAnother')}</a></p>`);
  });

  // Secrets: Create form page
  fastify.get('/secrets/new', async (request, reply) => {
    return reply.view('secrets/new', {
      title: request.i18n.t('secrets.new.title')
    });
  });

  // Secrets: Store ciphertext (returns HTML fragment)
  fastify.post('/secrets', async (request, reply) => {
    const body = request.body as { ciphertext?: string };
    const ciphertext = body.ciphertext || '';

    if (!ciphertext.trim()) {
      return reply.type('text/html').send(errorP(request.i18n, 'secrets.err.noCiphertext'));
    }

    const secret = objectStore.create('secret', { ciphertext: ciphertext.trim() });

    // Return the ID so client JS can build the full URL with fragment
    return reply.type('text/html').send(`/secrets/${secret.id}`);
  });

  // Secrets: View and delete (one-time access)
  fastify.get('/secrets/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const secret = objectStore.get(params.id);

    if (!secret) {
      return reply.view('secrets/gone', {
        title: request.i18n.t('secrets.gone.title')
      });
    }

    const data = secret.data as { ciphertext: string };
    const ciphertext = data.ciphertext;

    // Delete immediately after retrieving
    objectStore.remove(params.id);

    return reply.view('secrets/show', {
      title: request.i18n.t('secrets.show.title'),
      ciphertext
    });
  });

  // Files: Create form page
  fastify.get('/files/new', async (request, reply) => {
    return reply.view('files/new', {
      title: request.i18n.t('files.new.title')
    });
  });

  // Files: Upload files
  fastify.post('/files', async (request, reply) => {
    const parts = request.parts();
    const uploadedFiles: Array<{ name: string; storedName: string; size: number; sizeFormatted: string }> = [];
    
    // Generate share ID upfront
    const shareId = crypto.randomBytes(8).toString('base64url');
    const shareDir = path.join(FILES_DIR, shareId);
    let expiryDays = 3; // default
    
    try {
      fs.mkdirSync(shareDir, { recursive: true });
      
      for await (const part of parts) {
        if (part.type === 'field' && part.fieldname === 'expiry') {
          const val = parseInt(part.value as string, 10);
          if ([1, 3, 7, 30].includes(val)) expiryDays = val;
        }
        if (part.type === 'file' && part.filename) {
          const safeName = part.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
          const filePath = path.join(shareDir, safeName);
          
          await pipeline(part.file, fs.createWriteStream(filePath));
          
          const stats = fs.statSync(filePath);
          uploadedFiles.push({
            name: part.filename,
            storedName: safeName,
            size: stats.size,
            sizeFormatted: formatFileSize(stats.size)
          });
        }
      }
      
      if (uploadedFiles.length === 0) {
        // Clean up empty directory
        fs.rmdirSync(shareDir);
        return reply.type('text/html').send(errorP(request.i18n, 'files.err.none'));
      }
      
      // Store metadata in objectStore with expiration
      const expiresAt = Date.now() + expiryDays * 24 * 60 * 60 * 1000;
      objectStore.createWithId(shareId, 'fileshare', { files: uploadedFiles }, expiresAt);
      
      const protocol = request.headers['x-forwarded-proto'] || 'http';
      const host = request.headers.host;
      const shareUrl = `${protocol}://${host}/files/${shareId}`;
      
      return reply.view('_created', {
        heading: request.i18n.t('files.created'),
        url: shareUrl,
        hint: request.i18n.tn('files.expiresIn', expiryDays)
      });
    } catch (err) {
      // Clean up on error
      if (fs.existsSync(shareDir)) {
        fs.rmSync(shareDir, { recursive: true, force: true });
      }
      return reply.type('text/html').send(errorP(request.i18n, 'files.err.upload', { message: (err as Error).message }));
    }
  });

  // Files: View share page
  fastify.get('/files/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const share = objectStore.get(params.id);

    if (!share) {
      cleanupShareDir(params.id);
      return reply.view('files/gone', { title: request.i18n.t('files.gone.title') });
    }

    const protocol = request.headers['x-forwarded-proto'] || 'http';
    const host = request.headers.host;
    const shareUrl = `${protocol}://${host}/files/${params.id}`;

    return reply.view('files/show', {
      title: request.i18n.t('files.show.title'),
      share,
      shareUrl
    });
  });

  // Files: Download single file
  fastify.get('/files/:id/download/:filename', async (request, reply) => {
    const params = request.params as { id: string; filename: string };
    const share = objectStore.get(params.id);

    if (!share) {
      cleanupShareDir(params.id);
      return reply.status(404).send('Not found');
    }

    const data = share.data as { files: Array<{ name: string; storedName: string }> };
    const file = data.files.find(f => f.name === params.filename);
    
    if (!file) {
      return reply.status(404).send('File not found');
    }

    const filePath = path.join(FILES_DIR, params.id, file.storedName);
    
    if (!fs.existsSync(filePath)) {
      return reply.status(404).send('File not found');
    }

    return reply.header('Content-Disposition', `attachment; filename="${file.name}"`).send(fs.createReadStream(filePath));
  });

  // Files: Download all as ZIP
  fastify.get('/files/:id/zip', async (request, reply) => {
    const params = request.params as { id: string };
    const share = objectStore.get(params.id);

    if (!share) {
      cleanupShareDir(params.id);
      return reply.status(404).send('Not found');
    }

    const data = share.data as { files: Array<{ name: string; storedName: string }> };
    const shareDir = path.join(FILES_DIR, params.id);

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="files-${params.id}.zip"`);

    const archive = archiver('zip', { zlib: { level: 5 } });
    
    archive.on('error', (err) => {
      throw err;
    });

    for (const file of data.files) {
      const filePath = path.join(shareDir, file.storedName);
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: file.name });
      }
    }

    archive.finalize();
    return reply.send(archive);
  });

  // Files: Delete share
  fastify.delete('/files/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const share = objectStore.get(params.id);

    if (!share) {
      cleanupShareDir(params.id);
      return reply.type('text/html').send(plainP(request.i18n, 'files.notFound'));
    }

    // Delete files from filesystem
    const shareDir = path.join(FILES_DIR, params.id);
    if (fs.existsSync(shareDir)) {
      fs.rmSync(shareDir, { recursive: true, force: true });
    }

    // Delete from objectStore
    objectStore.remove(params.id);

    return reply.type('text/html').send(`<p>${request.i18n.t('files.deleted')}</p><p><a href="/files/new">${request.i18n.t('files.shareMore')}</a></p>`);
  });

  // Polls: Create form page
  fastify.get('/polls/new', async (request, reply) => {
    return reply.view('polls/new', {
      title: request.i18n.t('polls.new.title')
    });
  });

  // Polls: Create poll (returns HTML fragment for HTMX)
  fastify.post('/polls', async (request, reply) => {
    const body = request.body as { title?: string; 'dates[]'?: string | string[]; 'times[]'?: string | string[] };
    const title = body.title || '';
    
    // Handle both single and multiple values
    const datesRaw = body['dates[]'];
    const timesRaw = body['times[]'];
    const dates = Array.isArray(datesRaw) ? datesRaw : (datesRaw ? [datesRaw] : []);
    const times = Array.isArray(timesRaw) ? timesRaw : (timesRaw ? [timesRaw] : []);

    if (!title.trim()) {
      return reply.type('text/html').send(errorP(request.i18n, 'common.err.title'));
    }

    if (dates.length === 0 || dates.length !== times.length) {
      return reply.type('text/html').send(errorP(request.i18n, 'polls.err.slots'));
    }

    const slots = dates.map((date, i) => ({ date, time: times[i] }));
    
    const poll = objectStore.create('poll', { 
      title: title.trim(), 
      slots,
      responses: []
    });
    
    const protocol = request.headers['x-forwarded-proto'] || 'http';
    const host = request.headers.host;
    const pollUrl = `${protocol}://${host}/polls/${poll.id}`;

    return reply.view('_created', { heading: request.i18n.t('polls.created'), url: pollUrl });
  });

  // Polls: View poll page
  fastify.get('/polls/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const poll = objectStore.get(params.id);

    if (!poll) {
      return reply.status(404).view('404', { title: request.i18n.t('notFound.title') });
    }

    const pollData = poll.data as { title: string };
    return reply.view('polls/show', {
      title: pollData.title || request.i18n.t('polls.fallbackTitle'),
      poll
    });
  });

  // Polls: Add response (returns HTML fragment for HTMX)
  fastify.post('/polls/:id/responses', async (request, reply) => {
    const params = request.params as { id: string };
    const body = request.body as { name?: string; 'votes[]'?: string | string[] };
    
    const poll = objectStore.get(params.id);
    if (!poll) {
      return reply.type('text/html').send(plainP(request.i18n, 'polls.notFound'));
    }

    const name = (body.name || '').trim();
    const votesRaw = body['votes[]'];
    const votes = Array.isArray(votesRaw) ? votesRaw : (votesRaw ? [votesRaw] : []);

    if (!name) {
      return reply.type('text/html').send(errorP(request.i18n, 'polls.err.name'));
    }

    const data = poll.data as { title: string; slots: Array<{date: string; time: string}>; responses: Array<{name: string; votes: string[]}> };
    data.responses.push({ name, votes });
    
    objectStore.update(params.id, data);
    
    // Re-fetch updated poll and render the container partial
    const updatedPoll = objectStore.get(params.id);
    return reply.view('polls/_container', { poll: updatedPoll });
  });

  // Expenses: Create form page
  fastify.get('/expenses/new', async (request, reply) => {
    return reply.view('expenses/new', {
      title: request.i18n.t('expenses.new.title')
    });
  });

  // Expenses: Create expense share (returns HTML fragment for HTMX)
  fastify.post('/expenses', async (request, reply) => {
    const body = request.body as { title?: string; currency?: string; 'participants[]'?: string | string[] };
    const title = (body.title || '').trim();
    const currency = (body.currency || '€').trim();
    
    const participantsRaw = body['participants[]'];
    const participantNames = Array.isArray(participantsRaw) 
      ? participantsRaw.map(n => n.trim()).filter(n => n) 
      : (participantsRaw ? [participantsRaw.trim()].filter(n => n) : []);

    if (!title) {
      return reply.type('text/html').send(errorP(request.i18n, 'common.err.title'));
    }

    if (participantNames.length < 2) {
      return reply.type('text/html').send(errorP(request.i18n, 'expenses.err.participants'));
    }

    // Generate tokens for each participant
    const participants = participantNames.map(name => ({
      name,
      token: crypto.randomBytes(8).toString('base64url')
    }));

    const expense = objectStore.create('expense', {
      title,
      currency,
      participants,
      entries: []
    });

    const protocol = request.headers['x-forwarded-proto'] || 'http';
    const host = request.headers.host;
    const summaryUrl = `${protocol}://${host}/e/${expense.id}`;

    const links = participants.map((p) => ({ name: p.name, url: `${protocol}://${host}/e/${expense.id}/p/${p.token}` }));
    return reply.view('expenses/_created', { summaryUrl, links });
  });

  // Expenses: Summary page (read-only)
  fastify.get('/e/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const expense = objectStore.get(params.id);

    if (!expense || expense.type !== 'expense') {
      return reply.status(404).view('404', { title: request.i18n.t('notFound.title') });
    }

    return reply.view('expenses/show', {
      title: (expense.data as { title: string }).title,
      expense
    });
  });

  // Expenses: Participant page (editable)
  fastify.get('/e/:id/p/:token', async (request, reply) => {
    const params = request.params as { id: string; token: string };
    const expense = objectStore.get(params.id);

    if (!expense || expense.type !== 'expense') {
      return reply.status(404).view('404', { title: request.i18n.t('notFound.title') });
    }

    const data = expense.data as { title: string; participants: Array<{name: string; token: string}>; entries: unknown[] };
    const participant = data.participants.find(p => p.token === params.token);

    if (!participant) {
      return reply.status(403).type('text/html').send(plainP(request.i18n, 'expenses.invalidToken'));
    }

    return reply.view('expenses/participant', {
      title: data.title,
      expense,
      currentParticipant: participant.name,
      token: params.token
    });
  });

  // Expenses: Add entry (returns HTML fragment for HTMX)
  fastify.post('/e/:id/entries', async (request, reply) => {
    const params = request.params as { id: string };
    const query = request.query as { token?: string };
    const body = request.body as { description?: string; amount?: string; 'split[]'?: string | string[] };
    
    const expense = objectStore.get(params.id);
    if (!expense || expense.type !== 'expense') {
      return reply.type('text/html').send(plainP(request.i18n, 'expenses.notFound'));
    }

    const data = expense.data as { 
      title: string; 
      participants: Array<{name: string; token: string}>; 
      entries: Array<{description: string; amount: number; paid_by: string; split_between: string[]}>
    };
    
    const participant = data.participants.find(p => p.token === query.token);
    if (!participant) {
      return reply.status(403).type('text/html').send(plainP(request.i18n, 'expenses.invalidToken'));
    }

    const description = (body.description || '').trim();
    const amount = parseFloat(body.amount || '0');
    const splitRaw = body['split[]'];
    const split_between = Array.isArray(splitRaw) ? splitRaw : (splitRaw ? [splitRaw] : []);

    if (!description) {
      return reply.type('text/html').send(errorP(request.i18n, 'expenses.err.description'));
    }

    if (amount <= 0) {
      return reply.type('text/html').send(errorP(request.i18n, 'expenses.err.amount'));
    }

    if (split_between.length === 0) {
      return reply.type('text/html').send(errorP(request.i18n, 'expenses.err.split'));
    }

    data.entries.push({
      description,
      amount,
      paid_by: participant.name,
      split_between
    });

    objectStore.update(params.id, data);

    const updatedExpense = objectStore.get(params.id);
    return reply.view('expenses/_entries', { 
      expense: updatedExpense, 
      currentParticipant: participant.name,
      token: query.token
    });
  });

  // Expenses: Delete entry (returns HTML fragment for HTMX)
  fastify.delete('/e/:id/entries/:idx', async (request, reply) => {
    const params = request.params as { id: string; idx: string };
    const query = request.query as { token?: string };
    
    const expense = objectStore.get(params.id);
    if (!expense || expense.type !== 'expense') {
      return reply.type('text/html').send(plainP(request.i18n, 'expenses.notFound'));
    }

    const data = expense.data as { 
      title: string; 
      participants: Array<{name: string; token: string}>; 
      entries: Array<{description: string; amount: number; paid_by: string; split_between: string[]}>
    };
    
    const participant = data.participants.find(p => p.token === query.token);
    if (!participant) {
      return reply.status(403).type('text/html').send(plainP(request.i18n, 'expenses.invalidToken'));
    }

    const idx = parseInt(params.idx);
    if (idx >= 0 && idx < data.entries.length) {
      data.entries.splice(idx, 1);
      objectStore.update(params.id, data);
    }

    const updatedExpense = objectStore.get(params.id);
    return reply.view('expenses/_entries', { 
      expense: updatedExpense, 
      currentParticipant: participant.name,
      token: query.token
    });
  });

  // ============ Bring List (Potluck/Party Planner) ============

  // Bring List: New list form
  fastify.get('/bring/new', async (request, reply) => {
    return reply.view('bring/new', { title: request.i18n.t('bring.new.title') });
  });

  // Bring List: Create new list (returns HTML fragment for HTMX)
  fastify.post('/bring', async (request, reply) => {
    const body = request.body as { title?: string; 'items[]'?: string | string[]; 'amounts[]'?: string | string[] };
    const title = (body.title || '').trim();
    
    const itemsRaw = body['items[]'];
    const amountsRaw = body['amounts[]'];
    
    const items = Array.isArray(itemsRaw) ? itemsRaw : (itemsRaw ? [itemsRaw] : []);
    const amounts = Array.isArray(amountsRaw) ? amountsRaw : (amountsRaw ? [amountsRaw] : []);

    if (!title) {
      return reply.type('text/html').send(errorP(request.i18n, 'common.err.title'));
    }

    const needed = items
      .map((item, i) => ({
        item: item.trim(),
        amount_needed: parseInt(amounts[i] || '1', 10) || 1,
        claims: []
      }))
      .filter(n => n.item);

    if (needed.length === 0) {
      return reply.type('text/html').send(errorP(request.i18n, 'bring.err.items'));
    }

    const bringlist = objectStore.create('bringlist', {
      title,
      needed,
      custom: []
    });

    const protocol = request.headers['x-forwarded-proto'] || 'http';
    const host = request.headers.host;
    const url = `${protocol}://${host}/b/${bringlist.id}`;

    return reply.view('_created', {
      heading: `${request.i18n.t('bring.created')} <strong>${request.i18n.t('common.shareThisLink')}</strong>`,
      url
    });
  });

  // Bring List: View list
  fastify.get('/b/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const bringlist = objectStore.get(id);

    if (!bringlist || bringlist.type !== 'bringlist') {
      return reply.status(404).view('404', { title: request.i18n.t('notFound.title') });
    }

    const data = bringlist.data as { title: string; needed: any[]; custom: any[] };
    return reply.view('bring/show', { 
      title: data.title,
      bringlist 
    });
  });

  // Bring List: Claim an item (returns HTML fragment for HTMX)
  fastify.post('/b/:id/claim/:idx', async (request, reply) => {
    const { id, idx } = request.params as { id: string; idx: string };
    const body = request.body as { name?: string; amount?: string };
    const name = (body.name || '').trim();
    const amount = parseInt(body.amount || '1', 10);

    if (!name || amount < 1) {
      return reply.type('text/html').send(errorP(request.i18n, 'bring.err.nameAmount'));
    }

    const bringlist = objectStore.get(id);
    if (!bringlist || bringlist.type !== 'bringlist') {
      return reply.status(404).type('text/html').send(errorP(request.i18n, 'bring.notFound'));
    }

    const data = bringlist.data as { title: string; needed: any[]; custom: any[] };
    const index = parseInt(idx, 10);
    const needed = data.needed || [];
    
    if (index < 0 || index >= needed.length) {
      return reply.status(400).type('text/html').send(errorP(request.i18n, 'bring.err.invalidItem'));
    }

    const item = needed[index];
    const totalClaimed = (item.claims || []).reduce((sum: number, c: { amount: number }) => sum + c.amount, 0);
    const remaining = item.amount_needed - totalClaimed;

    if (amount > remaining) {
      return reply.type('text/html').send(errorP(request.i18n, 'bring.err.remaining', { n: remaining }));
    }

    if (!item.claims) item.claims = [];
    const claimToken = crypto.randomBytes(8).toString('base64url');
    item.claims.push({ name, amount, token: claimToken });

    objectStore.update(id, data);

    return reply.view('bring/_list', { bringlist, lastClaimToken: claimToken });
  });

  // Bring List: Delete a claim (only with matching token)
  fastify.delete('/b/:id/claim/:idx/:claimIdx', async (request, reply) => {
    const { id, idx, claimIdx } = request.params as { id: string; idx: string; claimIdx: string };
    const query = request.query as { token?: string };
    const token = query.token || '';

    const bringlist = objectStore.get(id);
    if (!bringlist || bringlist.type !== 'bringlist') {
      return reply.status(404).type('text/html').send(errorP(request.i18n, 'bring.notFound'));
    }

    const data = bringlist.data as { title: string; needed: any[]; custom: any[] };
    const itemIndex = parseInt(idx, 10);
    const claimIndex = parseInt(claimIdx, 10);
    const needed = data.needed || [];

    if (itemIndex < 0 || itemIndex >= needed.length) {
      return reply.status(400).type('text/html').send(errorP(request.i18n, 'bring.err.invalidItem'));
    }

    const item = needed[itemIndex];
    const claims = item.claims || [];

    if (claimIndex < 0 || claimIndex >= claims.length) {
      return reply.status(400).type('text/html').send(errorP(request.i18n, 'bring.err.invalidClaim'));
    }

    if (!token || claims[claimIndex].token !== token) {
      return reply.status(403).type('text/html').send(errorP(request.i18n, 'bring.err.cannotDeleteClaim'));
    }

    claims.splice(claimIndex, 1);
    objectStore.update(id, data);

    return reply.view('bring/_list', { bringlist });
  });

  // Bring List: Add custom item (returns HTML fragment for HTMX)
  fastify.post('/b/:id/custom', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { name?: string; item?: string; amount?: string };
    const name = (body.name || '').trim();
    const item = (body.item || '').trim();
    const amount = parseInt(body.amount || '1', 10);

    if (!name || !item || amount < 1) {
      return reply.type('text/html').send(errorP(request.i18n, 'bring.err.fillAll'));
    }

    const bringlist = objectStore.get(id);
    if (!bringlist || bringlist.type !== 'bringlist') {
      return reply.status(404).type('text/html').send(errorP(request.i18n, 'bring.notFound'));
    }

    const data = bringlist.data as { title: string; needed: any[]; custom: any[] };
    if (!data.custom) data.custom = [];
    const claimToken = crypto.randomBytes(8).toString('base64url');
    data.custom.push({ name, item, amount, token: claimToken });

    objectStore.update(id, data);

    return reply.view('bring/_list', { bringlist, lastClaimToken: claimToken });
  });

  // Bring List: Delete a custom item (only with matching token)
  fastify.delete('/b/:id/custom/:customIdx', async (request, reply) => {
    const { id, customIdx } = request.params as { id: string; customIdx: string };
    const query = request.query as { token?: string };
    const token = query.token || '';

    const bringlist = objectStore.get(id);
    if (!bringlist || bringlist.type !== 'bringlist') {
      return reply.status(404).type('text/html').send(errorP(request.i18n, 'bring.notFound'));
    }

    const data = bringlist.data as { title: string; needed: any[]; custom: any[] };
    const index = parseInt(customIdx, 10);
    const custom = data.custom || [];

    if (index < 0 || index >= custom.length) {
      return reply.status(400).type('text/html').send(errorP(request.i18n, 'bring.err.invalidItem'));
    }

    if (!token || custom[index].token !== token) {
      return reply.status(403).type('text/html').send(errorP(request.i18n, 'bring.err.cannotDeleteItem'));
    }

    custom.splice(index, 1);
    objectStore.update(id, data);

    return reply.view('bring/_list', { bringlist });
  });

  const port = parseInt(process.env.PORT || "3459", 10);

  // Periodic cleanup: purge expired objects and their files every hour
  const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
  setInterval(() => {
    try {
      const purged = objectStore.purgeExpired();
      for (const row of purged) {
        if (row.type === 'fileshare') {
          const shareDir = path.join(FILES_DIR, row.id);
          if (fs.existsSync(shareDir)) {
            fs.rmSync(shareDir, { recursive: true, force: true });
          }
        }
      }
      if (purged.length > 0) {
        log(`cleanup: purged ${purged.length} expired object(s)`);
      }
    } catch (err) {
      log(`cleanup error: ${(err as Error).message}`);
    }
  }, CLEANUP_INTERVAL);

  const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';

  try {
    await fastify.listen({ port, host });
    log(`serving on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
