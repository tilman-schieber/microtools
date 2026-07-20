import { parseSpec, renderPage, describeRegistry, TEMPLATES, SpecError, LIMITS, estimateEmWidth, SIGN_MAX_WIDTH, wifiPayload } from '../server/micropage';

let failed = 0;
const fail = (what: string, detail: string) => { console.log(`FAIL ${what}\n     ${detail}`); failed++; };

function parse(query: string) {
  return parseSpec('/micropage?' + query);
}

// --- grammar: the encoding traps that motivated split-before-decode ---------

{
  const s = parse('p=tar.cd~a%7Eb~c');
  if (s.slots.length !== 2) fail('%7E vs ~', `expected 2 slots, got ${s.slots.length}: ${JSON.stringify(s.slots)}`);
  if (s.slots[0] !== 'a~b') fail('%7E decodes to literal tilde', JSON.stringify(s.slots[0]));
}
{
  // tev has five slots, so an empty middle one survives rather than being truncated
  const s = parse('p=tev~a~~c');
  if (s.slots.length !== 3 || s.slots[1] !== '') fail('~~ is an empty slot', JSON.stringify(s.slots));
}
{
  // Extra slots on a fixed template are dropped rather than rejected
  const s = parse('p=tsg~a~b~c~d');
  if (s.slots.length !== 2) fail('fixed template truncates extras', JSON.stringify(s.slots));
}
{
  const s = parse('p=tsg~C%2B%2B~x');
  if (s.slots[0] !== 'C++') fail('encoded plus survives', JSON.stringify(s.slots[0]));
}
{
  const s = parse('p=tsg~C++~x');
  if (s.slots[0] !== 'C++') fail('raw plus is NOT turned into spaces', JSON.stringify(s.slots[0]));
}
{
  const s = parse('p=tsg~%20lead~x');
  if (s.slots[0] !== ' lead') fail('%20 decodes to space', JSON.stringify(s.slots[0]));
}

// --- head parsing ----------------------------------------------------------

{
  const s = parse('p=tsg.cd.wl.asky.xcb~H~B');
  if (s.template.code !== 'tsg') fail('template', s.template.code);
  if (s.theme.code !== 'cd') fail('theme', s.theme.code);
  if (s.width?.code !== 'wl') fail('width', String(s.width?.code));
  if (s.accent.code !== 'sky') fail('accent', s.accent.code);
  if (s.flags.join('') !== 'cb') fail('flags', s.flags.join(''));
}
{
  const s = parse('p=cd.tsg~H');
  if (s.template.code !== 'tsg' || s.theme.code !== 'cd') fail('head order independent', JSON.stringify(s.template.code + '/' + s.theme.code));
}
{
  const s = parse('p=tar~H');
  if (s.accent.code !== 'sky') fail('theme default accent applied', s.accent.code);
}

// --- errors ----------------------------------------------------------------

const mustThrow = (what: string, query: string, expect: RegExp) => {
  try {
    parse(query);
    fail(what, 'expected a SpecError, got none');
  } catch (e) {
    if (!(e instanceof SpecError)) return fail(what, `wrong error type: ${e}`);
    if (!expect.test(e.message + ' ' + (e.detail ?? ''))) fail(what, `message did not match ${expect}: ${e.message} / ${e.detail}`);
  }
};

mustThrow('missing p', 'q=1', /no page/i);
mustThrow('unknown code', 'p=zzz~H', /unknown code/i);
mustThrow('unknown accent', 'p=tsg.aXX~H', /unknown accent/i);
mustThrow('unknown flag', 'p=tsg.xz~H', /unknown flag/i);
mustThrow('broken escape', 'p=tsg~%ZZ', /percent-escape/i);
mustThrow('too many slots', 'p=tev~' + Array(LIMITS.maxSlots + 3).fill('x').join('~'), /too many slots/i);
mustThrow('slot too long', 'p=tsg~' + 'x'.repeat(LIMITS.maxInlineSlot + 1), /too long/i);
mustThrow('query too long', 'p=tsg~' + 'x'.repeat(LIMITS.maxQueryLength + 50), /too long for a URL/i);

// --- rendering -------------------------------------------------------------

{
  const r = renderPage(parse('p=tar.cd~Hello~World'));
  if (!r.html.includes('Hello')) fail('renders heading', r.html);
  if (!r.bodyClass.includes('micropage-page--cd')) fail('theme class', r.bodyClass);
  // cd's default accent is amber, so the class reflects the theme default
  if (!r.bodyClass.includes('micropage-page--aamb')) fail('accent class', r.bodyClass);
  const explicit = renderPage(parse('p=tar.cd.alob~Hello~World'));
  if (!explicit.bodyClass.includes('micropage-page--alob')) fail('explicit accent class', explicit.bodyClass);
  if (r.title !== 'Hello') fail('title from first slot', r.title);
}
{
  // Empty slots must vanish, not render an empty element
  const r = renderPage(parse('p=tar~Only heading~'));
  if (/<p class="mp-lede">\s*<\/p>/.test(r.html)) fail('empty slot renders blank element', r.html);
}
{
  // Markdown-lite works, raw HTML does not
  const r = renderPage(parse('p=tar~' + encodeURIComponent('**bold** and <img src=x onerror=alert(1)>')));
  if (!r.html.includes('<strong>bold</strong>')) fail('bold renders', r.html);
  if (r.html.includes('<img src=x')) fail('raw html escaped', r.html);
}
{
  // XSS: javascript link in a slot must degrade to text
  const r = renderPage(parse('p=tar~' + encodeURIComponent('[click](javascript:alert(1))')));
  if (/href="\s*javascript:/i.test(r.html)) fail('javascript link in slot', r.html);
  if (!r.html.includes('click')) fail('rejected link keeps its text', r.html);
}
{
  // KaTeX must NOT be active on this instance
  const r = renderPage(parse('p=tar~' + encodeURIComponent('costs $5 and $10 today')));
  if (r.html.includes('<math')) fail('KaTeX leaked into micropage', r.html);
  if (!r.html.includes('$5')) fail('dollar amounts survive', r.html);
}

// --- QR template -----------------------------------------------------------

{
  const r = renderPage(parse('p=tqr~' + encodeURIComponent('Scan me') + '~' + encodeURIComponent('https://example.dev')));
  if (!r.html.includes('<svg')) fail('qr renders inline svg', r.html.slice(0, 200));
  if (!r.html.includes('viewBox')) fail('qr svg is scalable', r.html.slice(0, 200));
  if (!r.html.includes('Scan me')) fail('qr shows the title', r.html.slice(0, 200));
  if (!/href="https:\/\/example\.dev"/.test(r.html)) fail('qr caption links the target', r.html);
}
{
  // No link yet: prompt rather than an empty frame
  const r = renderPage(parse('p=tqr~' + encodeURIComponent('Title only')));
  if (r.html.includes('<svg')) fail('qr with no link should not render a code', r.html);
}
{
  // A javascript: target must not become a clickable caption
  const r = renderPage(parse('p=tqr~T~' + encodeURIComponent('javascript:alert(1)')));
  if (/href="\s*javascript:/i.test(r.html)) fail('qr caption rejects javascript:', r.html);
}
{
  // Too much data for a QR code is a clear error, not a crash
  try {
    renderPage(parse('p=tqr~T~' + 'x'.repeat(590)));
  } catch (e) {
    if (!(e instanceof SpecError)) fail('oversized qr', `wrong error: ${e}`);
  }
}

// --- Sign template ---------------------------------------------------------

{
  const r = renderPage(parse('p=tsg~' + encodeURIComponent('BACK IN 10 MIN') + '~' + encodeURIComponent('Back by 14:30')));
  if (!/mp-sign-text--w\d+/.test(r.html)) fail('sign emits a width bucket', r.html);
  if (!r.html.includes('BACK IN 10 MIN')) fail('sign shows its text', r.html);
  if (!r.html.includes('Back by 14:30')) fail('sign shows its note', r.html);
}
{
  // Wide and narrow strings of equal length must land in different buckets
  const wide = estimateEmWidth('WWWWWW');
  const narrow = estimateEmWidth('iiiiii');
  if (!(wide > narrow * 2)) fail('width estimate distinguishes glyph widths', `${wide} vs ${narrow}`);
}
{
  // Very long text clamps to the widest bucket the stylesheet defines
  const r = renderPage(parse('p=tsg~' + encodeURIComponent('W'.repeat(200))));
  const m = r.html.match(/mp-sign-text--w(\d+)/);
  if (!m || Number(m[1]) > SIGN_MAX_WIDTH) fail('sign clamps to max bucket', String(m && m[1]));
}
{
  const r = renderPage(parse('p=tsg~'));
  if (r.html.includes('mp-sign-text')) fail('empty sign should prompt, not render an empty bar', r.html);
}
{
  // The template code reaches the body class so the shell can adapt
  const r = renderPage(parse('p=tsg~Hi'));
  if (!r.bodyClass.includes('micropage-page--tsg')) fail('template body class', r.bodyClass);
}

// --- WiFi payload (what a phone actually reads) ----------------------------

{
  const cases: [string, string, string, string][] = [
    ['Guest WiFi', 'hunter2', 'WPA', 'WIFI:T:WPA;S:Guest WiFi;P:hunter2;;'],
    ['Open Net', '', 'nopass', 'WIFI:T:nopass;S:Open Net;;'],
    ['Old AP', 'abc', 'WEP', 'WIFI:T:WEP;S:Old AP;P:abc;;'],
    // Characters special to the format must be escaped or the payload truncates
    ['My;Net', 'a:b', 'WPA', 'WIFI:T:WPA;S:My\\;Net;P:a\\:b;;'],
    ['back\\slash', 'q,w', 'WPA', 'WIFI:T:WPA;S:back\\\\slash;P:q\\,w;;']
  ];
  for (const [ssid, pw, type, expected] of cases) {
    const got = wifiPayload(ssid, pw, type);
    if (got !== expected) fail(`wifi payload for ${JSON.stringify(ssid)}`, `got      ${got}\n     expected ${expected}`);
  }
}

// --- WiFi template ---------------------------------------------------------

{
  const r = renderPage(parse('p=twf~' + encodeURIComponent('Guest WiFi') + '~' + encodeURIComponent('hunter2') + '~WPA'));
  if (!r.html.includes('<svg')) fail('wifi renders a qr', r.html.slice(0, 200));
  if (!r.html.includes('mp-wifi-icon')) fail('wifi renders the icon', r.html.slice(0, 200));
  if (!r.html.includes('Guest WiFi')) fail('wifi shows the ssid', r.html.slice(0, 300));
  if (!r.html.includes('hunter2')) fail('wifi shows the password', r.html.slice(0, 400));
}
{
  // The icon must carry no colour of its own, so themes can drive it
  const r = renderPage(parse('p=twf~Net~pw~WPA'));
  const icon = r.html.slice(r.html.indexOf('<svg'), r.html.indexOf('</svg>'));
  if (/#[0-9a-fA-F]{3,6}/.test(icon)) fail('icon hardcodes a colour', icon);
  if (!icon.includes('currentColor')) fail('icon should use currentColor', icon);
}
{
  // Open network: no password field in the payload, and it says so
  const r = renderPage(parse('p=twf~' + encodeURIComponent('Open Net') + '~~none'));
  if (!/open network/i.test(r.html)) fail('open network is labelled', r.html);
}
{
  // Characters special to the WIFI: payload must be escaped, not truncate it
  const r = renderPage(parse('p=twf~' + encodeURIComponent('My;Net') + '~' + encodeURIComponent('a:b;c') + '~WPA'));
  if (!r.html.includes('<svg')) fail('wifi with special chars still encodes', r.html.slice(0, 200));
}
{
  // No SSID yet: prompt rather than a broken code
  const r = renderPage(parse('p=twf~'));
  if (r.html.includes('<svg') && !r.html.includes('mp-wifi-icon')) fail('empty wifi should not render a qr', r.html);
}

// --- the template set is exactly what we kept ------------------------------

{
  const codes = TEMPLATES.map((t) => t.code).sort().join(' ');
  if (codes !== 'tar tev tqr tsg twf') fail('template set', codes);
}

// --- every template's documented example must actually render --------------

for (const t of TEMPLATES) {
  try {
    const encoded = encodeURIComponent(t.example).replace(/%7E/g, '~');
    const r = renderPage(parse('p=' + encoded));
    if (!r.html.trim()) fail(`example for ${t.code}`, 'rendered empty');
  } catch (e) {
    fail(`example for ${t.code}`, String(e));
  }
}

// --- /agents must describe exactly what exists -----------------------------

{
  const doc = describeRegistry('https://example.dev');
  if (doc.templates.length !== TEMPLATES.length) fail('agents template count', `${doc.templates.length} vs ${TEMPLATES.length}`);
  for (const t of TEMPLATES) {
    const d = doc.templates.find((x) => x.code === t.code);
    if (!d) { fail('agents missing template', t.code); continue; }
    if (d.slots.length !== t.slots.length) fail(`agents slots for ${t.code}`, `${d.slots.length} vs ${t.slots.length}`);
  }
  if (!JSON.stringify(doc).includes('%2B')) fail('agents documents the + rule', 'no mention of %2B');
}

console.log(failed === 0 ? '\nAll micropage checks passed.' : `\n${failed} FAILURES`);
process.exit(failed === 0 ? 0 : 1);
