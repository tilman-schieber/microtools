// Smoke tests: every page and every create/update/delete flow, in both languages,
// against the real app through fastify.inject(). No port is opened and the real
// database is never touched: DATA_DIR points at a throwaway directory.
import fs from 'fs';
import os from 'os';
import path from 'path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'microtools-smoke-'));
process.env.DATA_DIR = dataDir;
process.env.FILES_QUOTA_MB = '4'; // small, so the quota check can be reached
process.env.UPLOAD_LIMIT_MB = '2'; // small, so the per-upload limit can be reached

// Imported after DATA_DIR is set: the database opens on import
const { buildApp, purgeExpired } = await import('../server/app');
const objectStore = await import('../server/objectStore');
const { TOOLS } = await import('../server/tools');
const { LANGS } = await import('../server/i18n');

// The flows below send far more writes than a person would; the rate limit has its own section
const app = await buildApp({ logger: false, rateLimit: false });

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
    del: (url: string, extra: Record<string, string> = {}) => send('DELETE', url, undefined, extra),
    form: (url: string, fields: Array<[string, string]>, extra: Record<string, string> = {}, method = 'POST') =>
      send(method, url, new URLSearchParams(fields).toString(), { 'content-type': 'application/x-www-form-urlencoded', ...extra }),
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
    '/clock/new', '/clock', '/bring/new', '/qr', '/test', '/test/camera', '/test/microphone', '/test/speakers',
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
    const created = await c.form('/bring', [['title', 'Party'], ['items[]', 'Salad'], ['amounts[]', '2'], ['items[]', 'Bread'], ['amounts[]', '1']]);
    const url = find(created.body, /\/b\/[\w-]+/);
    const [, listId, adminKey] = created.body.match(/data-bring-admin="([\w-]+)" data-key="([\w-]+)"/) || [];
    check(L('potluck: created with an admin key'), url && adminKey && listId === url.split('/')[2], created.body);
    check(L('potluck: admin link carries the key in the fragment'), created.body.includes(`${url}#admin=${adminKey}`));
    check(L('potluck: only the hash is stored'), !JSON.stringify(objectStore.get(listId)!.data).includes(adminKey));

    const page = (await c.get(url)).body;
    check(L('potluck: view'), page.includes('Salad'));
    const iid = (page.match(/data-iid="([\w-]+)" data-name="Salad"/) || [])[1];
    const bread = (page.match(/data-iid="([\w-]+)" data-name="Bread"/) || [])[1];
    check(L('potluck: items have ids'), iid && bread);

    const over = await c.form(`${url}/claim/${iid}`, [['name', 'Ada'], ['amount', '3']]);
    check(L('potluck: cannot over-claim'), over.statusCode === 400 && over.body.includes('class="error"'));
    const claimed = await c.form(`${url}/claim/${iid}`, [['name', 'Ada'], ['amount', '1']]);
    const [cid, claimKey] = String(claimed.headers['x-bring-key'] || '').split('.');
    check(L('potluck: a claim returns its id and key once'), cid && claimKey && claimed.body.includes(`data-cid="${cid}"`), JSON.stringify(claimed.headers));
    check(L('potluck: claim keys stored only as hashes'), !JSON.stringify(objectStore.get(listId)!.data).includes(claimKey));
    check(L('potluck: removing needs the key'), (await c.del(`${url}/claims/${cid}`, { 'x-bring-key': 'wrong' })).statusCode === 403);
    check(L('potluck: you can remove your own claim'), (await c.del(`${url}/claims/${cid}`, { 'x-bring-key': claimKey })).statusCode === 200);

    const custom = await c.form(`${url}/custom`, [['name', 'Bo'], ['item', 'Wine'], ['amount', '1']]);
    check(L('potluck: extra added'), custom.body.includes('Wine'));
    const [xid] = String(custom.headers['x-bring-key'] || '').split('.');
    const other = await c.form(`${url}/claim/${iid}`, [['name', 'Cy'], ['amount', '2']]);
    const [cyId] = String(other.headers['x-bring-key'] || '').split('.');
    check(L('potluck: the organiser can remove any claim'), (await c.del(`${url}/claims/${cyId}`, { 'x-bring-key': adminKey })).statusCode === 200);
    check(L('potluck: ...and any extra'), (await c.del(`${url}/claims/${xid}`, { 'x-bring-key': adminKey })).statusCode === 200);

    // The organiser edits the items
    const admin = { 'x-bring-key': adminKey };
    check(L('potluck: only the organiser adds items'), (await c.form(`${url}/items`, [['item', 'Cake'], ['amount', '1']], { 'x-bring-key': claimKey })).statusCode === 403);
    const added = await c.form(`${url}/items`, [['item', 'Cake'], ['amount', '2']], admin);
    check(L('potluck: organiser adds an item'), added.statusCode === 200 && added.body.includes('data-name="Cake"'));
    await c.form(`${url}/claim/${iid}`, [['name', 'Dee'], ['amount', '2']]);
    check(L('potluck: amount cannot drop below what is claimed'), (await c.form(`${url}/items/${iid}`, [['item', 'Salad'], ['amount', '1']], admin, 'PUT')).statusCode === 400);
    const renamed = await c.form(`${url}/items/${iid}`, [['item', 'Green salad'], ['amount', '3']], admin, 'PUT');
    check(L('potluck: organiser renames an item and changes the amount'), renamed.body.includes('data-name="Green salad" data-amount="3"'), renamed.body.slice(0, 400));
    check(L('potluck: renaming keeps its claims'), renamed.body.includes('Dee: 2'));
    const removed = await c.del(`${url}/items/${bread}`, admin);
    check(L('potluck: organiser removes an item'), removed.statusCode === 200 && !removed.body.includes('data-name="Bread"'));
    check(L('potluck: others cannot remove items'), (await c.del(`${url}/items/${iid}`)).statusCode === 403);

    // Lists from before ids and keys: ids appear on view, old tokens still remove
    const legacy = objectStore.create('bringlist', { title: 'Old', needed: [{ item: 'Chips', amount_needed: 2, claims: [{ name: 'Old', amount: 1, token: 'oldtoken' }] }], custom: [] });
    const legacyPage = (await c.get(`/b/${legacy.id}`)).body;
    const oldCid = (legacyPage.match(/data-cid="([\w-]+)"/) || [])[1];
    check(L('potluck: old claims get ids'), oldCid);
    check(L('potluck: an old claim token still removes it'), (await c.del(`/b/${legacy.id}/claims/${oldCid}`, { 'x-bring-key': 'oldtoken' })).statusCode === 200);
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

// --- Date poll: editing your own answer, and the creator's admin key -------------------------
{
  const created = await app.inject({
    method: 'POST', url: '/polls', headers: { 'content-type': 'application/x-www-form-urlencoded', host: 'smoke.test' },
    payload: 'title=Keys&dates%5B%5D=2026-12-01&times%5B%5D=10%3A00&dates%5B%5D=2026-12-02&times%5B%5D=11%3A00'
  });
  const [, pollId, adminKey] = created.body.match(/data-poll-admin="([\w-]+)" data-key="([\w-]+)"/) || [];
  check('poll keys: creator gets an admin key', pollId && adminKey, created.body);
  check('poll keys: admin link carries the key in the fragment', created.body.includes(`/polls/${pollId}#admin=${adminKey}`));
  check('poll keys: only the hash is stored', !JSON.stringify(objectStore.get(pollId)!.data).includes(adminKey));

  const call = (method: string, url: string, key?: string, payload?: string) => app.inject({
    method: method as 'POST', url, payload,
    headers: { ...(payload ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...(key ? { 'x-poll-key': key } : {}) }
  });
  const answer = async (name: string, votes: string[]) => {
    const res = await call('POST', `/polls/${pollId}/responses`, undefined, new URLSearchParams([['name', name], ...votes.map((v) => ['votes[]', v])]).toString());
    const [rid, key] = String(res.headers['x-poll-response'] || '').split('.');
    return { res, rid, key };
  };

  const ada = await answer('Ada', ['yes', 'bogus']);
  check('poll keys: an answer returns its id and key once', ada.rid && ada.key, JSON.stringify(ada.res.headers));
  const stored = (objectStore.get(pollId)!.data as { responses: Array<{ id: string; votes: string[]; keyHash: string }> }).responses[0];
  check('poll keys: unknown votes count as no', stored.votes.join() === 'yes,no', stored.votes.join());
  check('poll keys: answer key stored only as a hash', stored.keyHash && !JSON.stringify(stored).includes(ada.key));
  const bo = await answer('Bo', ['no', 'no']);

  const edit = (rid: string, key: string | undefined, name: string, votes: string[]) =>
    call('PUT', `/polls/${pollId}/responses/${rid}`, key, new URLSearchParams([['name', name], ...votes.map((v) => ['votes[]', v])]).toString());
  check('poll keys: editing without the key is refused', (await edit(ada.rid, undefined, 'Mallory', ['no', 'no'])).statusCode === 403);
  check('poll keys: editing with another answer\'s key is refused', (await edit(ada.rid, bo.key, 'Mallory', ['no', 'no'])).statusCode === 403);
  check('poll keys: the admin key cannot edit answers', (await edit(ada.rid, adminKey, 'Mallory', ['no', 'no'])).statusCode === 403);
  const edited = await edit(ada.rid, ada.key, 'Ada L.', ['tentative', 'yes']);
  check('poll keys: editing with its key works', edited.statusCode === 200 && edited.body.includes('Ada L.'), edited.body);
  check('poll keys: an empty name is refused', (await edit(ada.rid, ada.key, ' ', ['yes', 'yes'])).statusCode === 400);

  check('poll keys: deleting someone else\'s answer is refused', (await call('DELETE', `/polls/${pollId}/responses/${bo.rid}`, ada.key)).statusCode === 403);
  const adminDelete = await call('DELETE', `/polls/${pollId}/responses/${bo.rid}`, adminKey);
  check('poll keys: the creator can delete any answer', adminDelete.statusCode === 200 && !adminDelete.body.includes('>Bo<'));
  check('poll keys: a deleted answer is gone', (await call('DELETE', `/polls/${pollId}/responses/${bo.rid}`, adminKey)).statusCode === 404);
  check('poll keys: you can delete your own answer', (await call('DELETE', `/polls/${pollId}/responses/${ada.rid}`, ada.key)).statusCode === 200);

  // Polls from before keys existed: their answers get ids on first view, the expiry stays
  const legacy = objectStore.create('poll', { title: 'Old', slots: [{ date: '2026-12-01', time: '10:00' }], responses: [{ name: 'Cy', votes: ['yes'] }] }, Date.now() + 5 * 86400000);
  const before = objectStore.get(legacy.id)!.expires_at;
  const page = await app.inject({ method: 'GET', url: `/polls/${legacy.id}` });
  const rid = (objectStore.get(legacy.id)!.data as { responses: Array<{ id?: string }> }).responses[0].id;
  check('poll keys: old answers get an id when the poll is viewed', rid && page.body.includes(`data-rid="${rid}"`));
  check('poll keys: that does not count as a change', objectStore.get(legacy.id)!.expires_at === before);
}

// --- QR code: what each kind of content encodes ----------------------------------------------
{
  await import('../public/qr-payload.js');
  const { build } = (globalThis as unknown as { QRPayload: { build: Record<string, (f: Record<string, unknown>) => string> } }).QRPayload;
  const eq = (what: string, got: string, want: string) => check(`qr: ${what}`, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

  eq('text passes through unchanged', build.text({ text: 'https://example.com/ä?x=1' }), 'https://example.com/ä?x=1');
  eq('wifi', build.wifi({ ssid: 'Home', security: 'WPA', password: 'secret' }), 'WIFI:T:WPA;S:Home;P:secret;;');
  eq('wifi escapes ; , : \\ and "', build.wifi({ ssid: 'My;Net', security: 'WPA', password: 'a\\b,c:d"e' }), 'WIFI:T:WPA;S:My\\;Net;P:a\\\\b\\,c\\:d\\"e;;');
  eq('open wifi has no password', build.wifi({ ssid: 'Cafe', security: 'nopass', password: 'ignored' }), 'WIFI:T:nopass;S:Cafe;;');
  eq('hidden wifi', build.wifi({ ssid: 'X', security: 'WPA', password: 'p', hidden: true }), 'WIFI:T:WPA;S:X;P:p;H:true;;');
  eq('wifi needs a network name', build.wifi({ ssid: ' ', security: 'WPA', password: 'p' }), '');
  eq('contact', build.contact({ first: 'Ada', last: 'Müller', phone: '+41 79 1', email: 'ada@example.com', org: 'A, B; C' }),
    ['BEGIN:VCARD', 'VERSION:3.0', 'N:Müller;Ada;;;', 'FN:Ada Müller', 'TEL;TYPE=CELL:+41 79 1', 'EMAIL:ada@example.com', 'ORG:A\\, B\\; C', 'END:VCARD'].join('\r\n'));
  eq('empty contact', build.contact({}), '');
  eq('email with subject and body', build.email({ to: 'a@b.ch', subject: 'Hi there', body: 'Line 1\nä & more' }), 'mailto:a@b.ch?subject=Hi%20there&body=Line%201%0A%C3%A4%20%26%20more');
  eq('email without extras', build.email({ to: 'a@b.ch' }), 'mailto:a@b.ch');
  eq('phone keeps + and digits', build.phone({ number: '+41 (79) 123-45-67' }), 'tel:+41791234567');
  eq('empty phone', build.phone({ number: '' }), '');
}

// --- Lifetimes ---------------------------------------------------------------------------
{
  const c = client('en');
  const DAY = 24 * 60 * 60 * 1000;
  const expiry = (id: string) => objectStore.get(id)!.expires_at!;
  const near = (ts: number, days: number) => Math.abs(ts - (Date.now() + days * DAY)) < 60 * 1000;

  for (const tool of TOOLS) {
    if (tool.category === 'local') check(`${tool.id} stores nothing, so has no lifetime`, !tool.lifetime);
  }

  const note = await c.form('/notes', [['text', 'x']]);
  check('note: expires in 180 days', near(expiry(find(note.body, /\/notes\/[\w-]+/).split('/')[2]), 180));
  check('note: says so', note.body.includes('deleted after 180 days'), note.body);

  const secret = (await c.form('/secrets', [['ciphertext', 'x'], ['keyHash', 'k'.repeat(43)]])).body.trim();
  check('secret: expires in 7 days', near(expiry(secret.split('/')[2]), 7));
  check('secret: form says so', (await c.get('/secrets/new')).body.includes('deleted after 7 days'));

  const poll = find((await c.form('/polls', [['title', 'P'], ['dates[]', '2026-12-01'], ['times[]', '10:00']])).body, /\/polls\/[\w-]+/);
  const pollId = poll.split('/')[2];
  check('poll: expires in 90 days', near(expiry(pollId), 90));
  objectStore.update(pollId, objectStore.get(pollId)!.data, Date.now() + DAY); // pretend it is about to expire
  await c.form(`${poll}/responses`, [['name', 'Ada']]);
  check('poll: a response restarts the 90 days', near(expiry(pollId), 90));

  const exp = await c.form('/expenses', [['title', 'E'], ['participants[]', 'A'], ['participants[]', 'B']]);
  check('expense: expires in 365 days', near(expiry(find(exp.body, /\/e\/[\w-]+/).split('/')[2]), 365));
  check('expense: says so', exp.body.includes('365 days after the last change'), exp.body);

  const bring = find((await c.form('/bring', [['title', 'B'], ['items[]', 'Salad']])).body, /\/b\/[\w-]+/);
  const bringId = bring.split('/')[2];
  objectStore.update(bringId, objectStore.get(bringId)!.data, Date.now() + DAY);
  await c.form(`${bring}/custom`, [['name', 'Bo'], ['item', 'Wine'], ['amount', '1']]);
  check('potluck: a change restarts the 90 days', near(expiry(bringId), 90));

  // Rows from before lifetimes: a fresh app start gives them one, counted from now
  const legacy = objectStore.create('poll', { title: 'old', slots: [], responses: [] });
  const old = objectStore.create('note', { text: 'old' });
  await (await buildApp({ logger: false, rateLimit: false })).close();
  check('backfill: old poll gets 90 days', near(expiry(legacy.id), 90));
  check('backfill: old note gets 180 days', near(expiry(old.id), 180));
}

// --- Quick links: pages mark themselves for the browser's local list -----------------------
{
  const c = client('en');
  const marker = (body: string) => {
    const m = body.match(/<span hidden data-remember ([^>]*)>/);
    if (!m) return null;
    const attr = (name: string) => (m[1].match(new RegExp(`data-${name}="([^"]*)"`)) || [])[1];
    return { tool: attr('tool'), key: attr('key'), path: attr('path'), title: attr('title'), expires: Number(attr('expires')), personal: m[1].includes('data-personal') };
  };

  const created = await c.form('/polls', [['title', 'Lunch <b>&</b>'], ['dates[]', '2026-12-01'], ['times[]', '10:00']]);
  const m1 = marker(created.body);
  check('remember: created poll is marked', m1 && m1.tool === 'polls' && m1.path === `/polls/${m1.key}` && m1.expires > Date.now(), created.body);
  check('remember: title is escaped', created.body.includes('data-title="Lunch &lt;b&gt;&amp;&lt;/b&gt;"'));
  check('remember: poll page is marked', marker((await c.get(m1!.path)).body)?.key === m1!.key);

  const note = await c.form('/notes', [['text', '\n## Shopping list\n- milk']]);
  const m2 = marker(note.body);
  check('remember: untitled note uses its first line', m2?.title === 'Shopping list', JSON.stringify(m2));
  check('remember: markdown view is marked too', marker((await c.get(`${m2!.path}/md`)).body)?.key === m2!.key);

  const exp = await c.form('/expenses', [['title', 'Trip'], ['participants[]', 'Ada'], ['participants[]', 'Bo']]);
  const m3 = marker(exp.body);
  check('remember: new expense group remembers the summary', m3?.path === `/e/${m3?.key}` && !m3?.personal);
  const personal = find(exp.body, /\/e\/[\w-]+\/p\/[\w-]+/);
  const m4 = marker((await c.get(personal)).body);
  check('remember: participant page is personal', m4?.personal && m4.path === personal && m4.title === 'Trip · Ada', JSON.stringify(m4));

  const bring = await c.form('/bring', [['title', 'Party'], ['items[]', 'Salad']]);
  check('remember: potluck is marked', marker(bring.body)?.tool === 'potluck');

  const files = await c.multipart('/files', [['expiry', '7']], [['a.txt', 'a'], ['b.txt', 'b']]);
  const m5 = marker(files.body);
  check('remember: file share named after its first file', m5?.title === 'a.txt +1', JSON.stringify(m5));
  check('remember: file share page is marked', marker((await c.get(m5!.path)).body)?.key === m5!.key);

  // A secret's link carries its key; it must never be remembered
  const secret = (await c.form('/secrets', [['ciphertext', 'x'], ['keyHash', 'k'.repeat(43)]])).body.trim();
  check('remember: secrets are never marked', !marker((await c.get(secret)).body) && !(await c.get('/secrets/new')).body.includes('data-remember'));

  const home = (await c.get('/')).body;
  const meta = JSON.parse(find(home, /<script type="application\/json" id="tool-meta">[^<]*<\/script>/).replace(/^<script[^>]*>|<\/script>$/g, '') || '{}');
  check('landing: tool names and icons for the quick links', meta.polls?.name === 'Date Poll' && meta.polls?.icon.includes('<rect'), JSON.stringify(meta).slice(0, 200));
  check('landing: quick links section starts hidden', home.includes('id="recent" aria-labelledby="group-recent" hidden'));
}

// --- Rate limits ----------------------------------------------------------------------------
{
  const limited = await buildApp({ logger: false });
  const post = (ip: string) => limited.inject({
    method: 'POST', url: '/notes', payload: 'text=x',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': ip, cookie: 'lang=de' }
  });
  let first429 = 0;
  for (let i = 1; i <= 61 && !first429; i++) if ((await post('203.0.113.1')).statusCode === 429) first429 = i;
  check('rate limit: 61st write in a minute is refused', first429 === 61, `refused at ${first429}`);
  const refused = await post('203.0.113.1');
  check('rate limit: answers with a translated HTML error', refused.body.includes('class="error"') && refused.body.includes('Zu viele'), refused.body);
  check('rate limit: other clients are unaffected', (await post('203.0.113.2')).statusCode === 200);
  const read = await limited.inject({ method: 'GET', url: '/notes/new', headers: { 'x-forwarded-for': '203.0.113.1' } });
  check('rate limit: reading is never limited', read.statusCode === 200);
  // X-Forwarded-For only counts from a proxy on this machine
  const spoofed = await limited.inject({
    method: 'POST', url: '/notes', payload: 'text=x', remoteAddress: '198.51.100.7',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '203.0.113.99' }
  });
  check('rate limit: a remote client cannot pick its own IP', spoofed.statusCode === 200);

  // Uploads have their own, tighter budget: 20 an hour
  const upload = () => limited.inject({
    method: 'POST', url: '/files', remoteAddress: '198.51.100.8',
    payload: '--b\r\nContent-Disposition: form-data; name="files"; filename="a.txt"\r\n\r\na\r\n--b--\r\n',
    headers: { 'content-type': 'multipart/form-data; boundary=b' }
  });
  let uploads429 = 0;
  for (let i = 1; i <= 21 && !uploads429; i++) if ((await upload()).statusCode === 429) uploads429 = i;
  check('rate limit: 21st upload in an hour is refused', uploads429 === 21, `refused at ${uploads429}`);
  const noteAfter = await limited.inject({
    method: 'POST', url: '/notes', payload: 'text=x', remoteAddress: '198.51.100.8',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  });
  check('rate limit: the upload budget does not block other writes', noteAfter.statusCode === 200);
  for (const dir of fs.readdirSync(path.join(dataDir, 'files'))) fs.rmSync(path.join(dataDir, 'files', dir), { recursive: true });
  await limited.close();
}

// --- Disk quota for uploads (FILES_QUOTA_MB=4 above) --------------------------------------
{
  const c = client('en');
  const filesDir = path.join(dataDir, 'files');
  for (const dir of fs.readdirSync(filesDir)) fs.rmSync(path.join(filesDir, dir), { recursive: true });
  // Fill the disk to just under the quota with an existing share
  fs.mkdirSync(path.join(filesDir, 'filler'));
  fs.writeFileSync(path.join(filesDir, 'filler', 'f'), Buffer.alloc(4 * 1024 * 1024 - 1024));
  const res = await c.multipart('/files', [['expiry', '1']], [['big.txt', 'x'.repeat(2048)]]);
  check('quota: upload that would pass the quota is refused', res.statusCode === 507 && res.body.includes('no room'), `${res.statusCode} ${res.body}`);
  check('quota: refused upload leaves nothing on disk', fs.readdirSync(filesDir).join() === 'filler', fs.readdirSync(filesDir).join(' '));
  fs.writeFileSync(path.join(filesDir, 'filler', 'f'), Buffer.alloc(4 * 1024 * 1024));
  check('quota: a full disk refuses even a tiny upload', (await c.multipart('/files', [], [['s.txt', 'x']])).statusCode === 507);
  fs.rmSync(path.join(filesDir, 'filler'), { recursive: true });
  check('quota: with room again, uploads work', find((await c.multipart('/files', [], [['s.txt', 'small']])).body, /\/files\/[\w-]+/));
  for (const dir of fs.readdirSync(filesDir)) fs.rmSync(path.join(filesDir, dir), { recursive: true });
}

// --- Per-upload size limit (UPLOAD_LIMIT_MB=2 above) ------------------------------------------
{
  const c = client('de');
  check('upload limit: form states it', (await c.get('/files/new')).body.includes('bis zu 2 MB'));
  const half = 'x'.repeat(1024 * 1024 + 512 * 1024);
  const together = await c.multipart('/files', [], [['a.txt', half], ['b.txt', half]]);
  check('upload limit: files that add up to too much are refused', together.statusCode === 413 && together.body.includes('Zu groß'), `${together.statusCode} ${together.body}`);
  const single = await c.multipart('/files', [], [['big.txt', 'x'.repeat(2 * 1024 * 1024 + 1)]]);
  check('upload limit: one file over the limit is refused, not truncated', single.statusCode === 413, `${single.statusCode} ${single.body}`);
  check('upload limit: refused uploads leave nothing on disk', fs.readdirSync(path.join(dataDir, 'files')).length === 0);
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
