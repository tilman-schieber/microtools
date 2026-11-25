// Smoke tests: every page and every create/update/delete flow, in both languages,
// against the real app through fastify.inject(). No port is opened and the real
// database is never touched: DATA_DIR points at a throwaway directory.
import fs from 'fs';
import os from 'os';
import path from 'path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'microtools-smoke-'));
process.env.DATA_DIR = dataDir;

// Imported after DATA_DIR is set: the database opens on import
const { buildApp, purgeExpired } = await import('../server/app');
const objectStore = await import('../server/objectStore');
const { TOOLS } = await import('../server/tools');
const { LANGS } = await import('../server/i18n');

const app = await buildApp({ logger: false });

let failed = 0;
let passed = 0;
function check(what: string, ok: unknown, detail = '') {
  if (ok) { passed++; return; }
  failed++;
  console.log(`FAIL ${what}${detail ? `\n     ${detail.slice(0, 300)}` : ''}`);
}

type Res = { statusCode: number; body: string; headers: Record<string, unknown> };

function client(lang: string) {
  const headers = { cookie: `lang=${lang}`, host: 'smoke.test' };
  const send = async (method: string, url: string, payload?: string, extra: Record<string, string> = {}): Promise<Res> => {
    const res = await app.inject({ method: method as 'GET', url, payload, headers: { ...headers, ...extra } });
    return { statusCode: res.statusCode, body: res.body, headers: res.headers };
  };
  return {
    get: (url: string) => send('GET', url),
    del: (url: string) => send('DELETE', url),
    form: (url: string, fields: Array<[string, string]>) =>
      send('POST', url, new URLSearchParams(fields).toString(), { 'content-type': 'application/x-www-form-urlencoded' }),
    json: (url: string, body: unknown) => send('POST', url, JSON.stringify(body), { 'content-type': 'application/json' }),
    multipart: (url: string, fields: Array<[string, string]>, files: Array<[string, string]>) => {
      const b = 'smokeboundary';
      const parts = [
        ...fields.map(([k, v]) => `--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`),
        ...files.map(([name, content]) => `--${b}\r\nContent-Disposition: form-data; name="files"; filename="${name}"\r\nContent-Type: text/plain\r\n\r\n${content}\r\n`)
      ];
      return send('POST', url, parts.join('') + `--${b}--\r\n`, { 'content-type': `multipart/form-data; boundary=${b}` });
    }
  };
}

/** First match of a path pattern in an HTML fragment, e.g. the link a create returns */
const find = (body: string, re: RegExp) => (body.match(re) || [])[0] || '';

for (const lang of LANGS) {
  const c = client(lang);
  const L = (what: string) => `[${lang}] ${what}`;

  // --- Static pages ---------------------------------------------------------
  const pages = [
    '/', '/notes/new', '/polls/new', '/expenses/new', '/secrets/new', '/files/new', '/passwords/new',
    '/clock/new', '/clock', '/bring/new', '/test', '/test/camera', '/test/microphone', '/test/speakers',
    '/test/gamepad', '/test/keyboard', '/test/pointer', '/test/browser',
    '/micropage/new', '/micropage/docs', '/micropage/docs.md', '/micropage/agents'
  ];
  for (const p of pages) {
    const res = await c.get(p);
    check(L(`GET ${p} is 200`), res.statusCode === 200, `got ${res.statusCode}`);
    check(L(`GET ${p} has no raw locale keys`), !/\b(tool|landing|common)\.[a-z]+\.[a-z]+\b/.test(res.body) || p.endsWith('agents'), find(res.body, /\b(tool|landing|common)\.[a-z]+\.[a-z]+\b/));
  }
  check(L('html lang attribute'), (await c.get('/')).body.includes(`lang="${lang}"`));
  for (const p of ['/nope', '/test/nope', '/notes/doesnotexist', '/polls/doesnotexist', '/e/doesnotexist', '/b/doesnotexist']) {
    check(L(`GET ${p} is 404`), (await c.get(p)).statusCode === 404);
  }

  // --- Landing page lists every tool, grouped ----------------------------------
  {
    const home = (await c.get('/')).body;
    for (const tool of TOOLS) check(L(`landing links ${tool.id}`), home.includes(`href="${tool.href}"`));
    check(L('landing has three groups'), (home.match(/class="tool-group"/g) || []).length === 3);
  }

  // --- Notes -----------------------------------------------------------------
  {
    check(L('note: empty text rejected'), (await c.form('/notes', [['text', '  ']])).body.includes('class="error"'));
    const created = await c.form('/notes', [['title', 'Smoke'], ['text', '# Heading\n\n$x^2$ and [ok](https://example.com) [bad](javascript:alert(1))']]);
    const url = find(created.body, /\/notes\/[\w-]+/);
    check(L('note: created'), url, created.body);
    check(L('note: link uses Host header'), created.body.includes(`http://smoke.test${url}`));
    check(L('note: view'), (await c.get(url)).statusCode === 200);
    const raw = await c.get(`${url}/raw`);
    check(L('note: raw is plain text'), raw.body.startsWith('# Heading') && String(raw.headers['content-type']).startsWith('text/plain'));
    const md = (await c.get(`${url}/md`)).body;
    check(L('note: markdown renders heading'), md.includes('<h1'));
    check(L('note: markdown renders math'), md.includes('<math'));
    check(L('note: javascript: link neutralised'), !md.includes('href="javascript:'));
    check(L('note: delete'), (await c.del(url)).statusCode === 200);
    check(L('note: gone after delete'), (await c.get(url)).statusCode === 404);
  }

  // --- Date poll ---------------------------------------------------------------
  {
    check(L('poll: title required'), (await c.form('/polls', [['dates[]', '2026-12-01'], ['times[]', '10:00']])).body.includes('class="error"'));
    check(L('poll: slots required'), (await c.form('/polls', [['title', 'P']])).body.includes('class="error"'));
    const created = await c.form('/polls', [['title', 'Team lunch'], ['dates[]', '2026-12-01'], ['times[]', '10:00'], ['dates[]', '2026-12-02'], ['times[]', '12:00']]);
    const url = find(created.body, /\/polls\/[\w-]+/);
    check(L('poll: created'), url, created.body);
    check(L('poll: view shows title'), (await c.get(url)).body.includes('Team lunch'));
    check(L('poll: name required'), (await c.form(`${url}/responses`, [['name', '']])).body.includes('class="error"'));
    const voted = await c.form(`${url}/responses`, [['name', 'Ada'], ['votes[]', '0']]);
    check(L('poll: response shown'), voted.body.includes('Ada'), voted.body);
  }

  // --- Expense share -------------------------------------------------------------
  {
    check(L('expense: two participants required'), (await c.form('/expenses', [['title', 'E'], ['participants[]', 'A']])).body.includes('class="error"'));
    const created = await c.form('/expenses', [['title', 'Trip'], ['currency', '€'], ['participants[]', 'Ada'], ['participants[]', 'Bo']]);
    const personal = find(created.body, /\/e\/[\w-]+\/p\/[\w-]+/);
    check(L('expense: created with participant links'), personal, created.body);
    const id = personal.split('/')[2];
    const token = personal.split('/')[4];
    check(L('expense: summary'), (await c.get(`/e/${id}`)).body.includes('Trip'));
    check(L('expense: participant page'), (await c.get(personal)).statusCode === 200);
    check(L('expense: bad token is 403'), (await c.get(`/e/${id}/p/wrong`)).statusCode === 403);
    check(L('expense: amount must be positive'),
      (await c.form(`/e/${id}/entries?token=${token}`, [['description', 'x'], ['amount', '0'], ['split[]', 'Ada']])).body.includes('class="error"'));
    check(L('expense: entry needs a valid token'),
      (await c.form(`/e/${id}/entries?token=wrong`, [['description', 'x'], ['amount', '5'], ['split[]', 'Ada']])).statusCode === 403);
    const added = await c.form(`/e/${id}/entries?token=${token}`, [['description', 'Fuel'], ['amount', '42'], ['split[]', 'Ada'], ['split[]', 'Bo']]);
    check(L('expense: entry added'), added.body.includes('Fuel'), added.body);
    const removed = await c.del(`/e/${id}/entries/0?token=${token}`);
    check(L('expense: entry deleted'), removed.statusCode === 200 && !removed.body.includes('Fuel'));
  }

  // --- Potluck -------------------------------------------------------------------
  {
    check(L('potluck: items required'), (await c.form('/bring', [['title', 'B']])).body.includes('class="error"'));
    const created = await c.form('/bring', [['title', 'Party'], ['items[]', 'Salad'], ['amounts[]', '2']]);
    const url = find(created.body, /\/b\/[\w-]+/);
    check(L('potluck: created'), url, created.body);
    check(L('potluck: view'), (await c.get(url)).body.includes('Salad'));
    check(L('potluck: cannot over-claim'), (await c.form(`${url}/claim/0`, [['name', 'Ada'], ['amount', '3']])).body.includes('class="error"'));
    const claimed = await c.form(`${url}/claim/0`, [['name', 'Ada'], ['amount', '1']]);
    const claimToken = find(claimed.body, /token=[\w-]+/).slice('token='.length);
    check(L('potluck: claim returns a removal token'), claimToken, claimed.body);
    check(L('potluck: claim removal needs the token'), (await c.del(`${url}/claim/0/0?token=wrong`)).statusCode === 403);
    check(L('potluck: claim removed'), (await c.del(`${url}/claim/0/0?token=${claimToken}`)).statusCode === 200);
    const custom = await c.form(`${url}/custom`, [['name', 'Bo'], ['item', 'Wine'], ['amount', '1']]);
    check(L('potluck: custom item added'), custom.body.includes('Wine'));
    const customToken = find(custom.body, /custom\/0\?token=[\w-]+/).split('token=')[1];
    check(L('potluck: custom item removed'), (await c.del(`${url}/custom/0?token=${customToken}`)).statusCode === 200);
  }

  // --- File share ----------------------------------------------------------------
  {
    const created = await c.multipart('/files', [['expiry', '1']], [['hello.txt', 'hello world']]);
    const url = find(created.body, /\/files\/[\w-]+/);
    check(L('files: uploaded'), url, created.body);
    const id = url.split('/')[2];
    check(L('files: stored on disk'), fs.existsSync(path.join(dataDir, 'files', id, 'hello.txt')));
    check(L('files: view'), (await c.get(url)).body.includes('hello.txt'));
    check(L('files: download'), (await c.get(`${url}/download/hello.txt`)).body === 'hello world');
    check(L('files: unknown file is 404'), (await c.get(`${url}/download/nope.txt`)).statusCode === 404);
    const zip = await c.get(`${url}/zip`);
    check(L('files: zip'), zip.statusCode === 200 && zip.body.startsWith('PK'));
    check(L('files: delete'), (await c.del(url)).statusCode === 200);
    check(L('files: directory removed'), !fs.existsSync(path.join(dataDir, 'files', id)));
    check(L('files: gone page'), (await c.get(url)).statusCode === 200);
    check(L('files: nothing uploaded is an error'), (await c.multipart('/files', [['expiry', '1']], [])).body.includes('class="error"'));
  }

  // --- One-time secret -------------------------------------------------------------
  {
    const keyHash = 'k'.repeat(43);
    const created = await c.form('/secrets', [['ciphertext', 'CIPHER'], ['keyHash', keyHash]]);
    const url = created.body.trim();
    check(L('secret: created'), /^\/secrets\/[\w-]+$/.test(url), created.body);
    const page = await c.get(url);
    check(L('secret: viewing does not consume it'), page.statusCode === 200 && String(page.headers['cache-control']).includes('no-store'));
    check(L('secret: wrong key is refused'), (await c.json(`${url}/reveal`, { keyHash: 'x'.repeat(43) })).statusCode === 403);
    const revealed = await c.json(`${url}/reveal`, { keyHash });
    check(L('secret: reveal returns ciphertext'), JSON.parse(revealed.body).ciphertext === 'CIPHER');
    check(L('secret: second reveal is gone'), (await c.json(`${url}/reveal`, { keyHash })).statusCode === 404);
  }

  // --- Micropage -------------------------------------------------------------------
  {
    const res = await c.get('/micropage?p=tsg~Hello~World');
    check(L('micropage: renders'), res.statusCode === 200 && res.body.includes('Hello'));
    check(L('micropage: strict CSP'), String(res.headers['content-security-policy']).includes("script-src 'none'"));
    check(L('micropage: bad spec is 400'), (await c.get('/micropage?p=nonsense~x')).statusCode === 400);
  }
}

// --- Language selection ------------------------------------------------------------
{
  const res = await app.inject({ method: 'GET', url: '/notes/new?lang=de' });
  check('?lang= redirects to the clean URL', res.statusCode === 302 && res.headers.location === '/notes/new');
  check('?lang= sets the cookie', String(res.headers['set-cookie']).includes('lang=de'));
  const accept = await app.inject({ method: 'GET', url: '/', headers: { 'accept-language': 'de-CH,de;q=0.9' } });
  check('Accept-Language picks German', accept.body.includes('lang="de"'));
}

// --- Cleanup removes expired objects and their files ---------------------------------
{
  const id = 'expiredshare';
  fs.mkdirSync(path.join(dataDir, 'files', id), { recursive: true });
  objectStore.createWithId(id, 'fileshare', { files: [] }, Date.now() - 1000);
  check('purge reports the expired share', purgeExpired() >= 1);
  check('purge removes the share directory', !fs.existsSync(path.join(dataDir, 'files', id)));
}

await app.close();
fs.rmSync(dataDir, { recursive: true, force: true });

console.log(failed === 0 ? `\nAll ${passed} smoke checks passed.` : `\n${failed} FAILURES (${passed} passed)`);
process.exit(failed === 0 ? 0 : 1);
