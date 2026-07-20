import { parseSpec, renderPage, describeRegistry, TEMPLATES, SpecError, LIMITS } from '../server/micropage';

let failed = 0;
const fail = (what: string, detail: string) => { console.log(`FAIL ${what}\n     ${detail}`); failed++; };

function parse(query: string) {
  return parseSpec('/micropage?' + query);
}

// --- grammar: the encoding traps that motivated split-before-decode ---------

{
  const s = parse('p=thp.cd~a%7Eb~c');
  if (s.slots.length !== 2) fail('%7E vs ~', `expected 2 slots, got ${s.slots.length}: ${JSON.stringify(s.slots)}`);
  if (s.slots[0] !== 'a~b') fail('%7E decodes to literal tilde', JSON.stringify(s.slots[0]));
}
{
  // tls repeats, so no slot is truncated and the empty middle survives
  const s = parse('p=tls~a~~c');
  if (s.slots.length !== 3 || s.slots[1] !== '') fail('~~ is an empty slot', JSON.stringify(s.slots));
}
{
  // Extra slots on a fixed template are dropped rather than rejected
  const s = parse('p=thp~a~b~c~d');
  if (s.slots.length !== 2) fail('fixed template truncates extras', JSON.stringify(s.slots));
}
{
  const s = parse('p=thp~C%2B%2B~x');
  if (s.slots[0] !== 'C++') fail('encoded plus survives', JSON.stringify(s.slots[0]));
}
{
  const s = parse('p=thp~C++~x');
  if (s.slots[0] !== 'C++') fail('raw plus is NOT turned into spaces', JSON.stringify(s.slots[0]));
}
{
  const s = parse('p=thp~%20lead~x');
  if (s.slots[0] !== ' lead') fail('%20 decodes to space', JSON.stringify(s.slots[0]));
}

// --- head parsing ----------------------------------------------------------

{
  const s = parse('p=thp.cd.wl.asky.xcb~H~B');
  if (s.template.code !== 'thp') fail('template', s.template.code);
  if (s.theme.code !== 'cd') fail('theme', s.theme.code);
  if (s.width?.code !== 'wl') fail('width', String(s.width?.code));
  if (s.accent.code !== 'sky') fail('accent', s.accent.code);
  if (s.flags.join('') !== 'cb') fail('flags', s.flags.join(''));
}
{
  const s = parse('p=cd.thp~H');
  if (s.template.code !== 'thp' || s.theme.code !== 'cd') fail('head order independent', JSON.stringify(s.template.code + '/' + s.theme.code));
}
{
  const s = parse('p=thp~H');
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
mustThrow('unknown accent', 'p=thp.aXX~H', /unknown accent/i);
mustThrow('unknown flag', 'p=thp.xz~H', /unknown flag/i);
mustThrow('broken escape', 'p=thp~%ZZ', /percent-escape/i);
mustThrow('too many slots', 'p=tls~' + Array(LIMITS.maxSlots + 3).fill('x').join('~'), /too many slots/i);
mustThrow('slot too long', 'p=thp~' + 'x'.repeat(LIMITS.maxInlineSlot + 1), /too long/i);
mustThrow('query too long', 'p=thp~' + 'x'.repeat(LIMITS.maxQueryLength + 50), /too long for a URL/i);

// --- rendering -------------------------------------------------------------

{
  const r = renderPage(parse('p=thp.cd~Hello~World'));
  if (!r.html.includes('Hello')) fail('renders heading', r.html);
  if (!r.bodyClass.includes('micropage-page--cd')) fail('theme class', r.bodyClass);
  // cd's default accent is amber, so the class reflects the theme default
  if (!r.bodyClass.includes('micropage-page--aamb')) fail('accent class', r.bodyClass);
  const explicit = renderPage(parse('p=thp.cd.alob~Hello~World'));
  if (!explicit.bodyClass.includes('micropage-page--alob')) fail('explicit accent class', explicit.bodyClass);
  if (r.title !== 'Hello') fail('title from first slot', r.title);
}
{
  // Empty slots must vanish, not render an empty element
  const r = renderPage(parse('p=thp~Only heading~'));
  if (/<p class="mp-lede">\s*<\/p>/.test(r.html)) fail('empty slot renders blank element', r.html);
}
{
  // Markdown-lite works, raw HTML does not
  const r = renderPage(parse('p=thp~' + encodeURIComponent('**bold** and <img src=x onerror=alert(1)>')));
  if (!r.html.includes('<strong>bold</strong>')) fail('bold renders', r.html);
  if (r.html.includes('<img src=x')) fail('raw html escaped', r.html);
}
{
  // XSS: javascript link in a slot must degrade to text
  const r = renderPage(parse('p=thp~' + encodeURIComponent('[click](javascript:alert(1))')));
  if (/href="\s*javascript:/i.test(r.html)) fail('javascript link in slot', r.html);
  if (!r.html.includes('click')) fail('rejected link keeps its text', r.html);
}
{
  // KaTeX must NOT be active on this instance
  const r = renderPage(parse('p=thp~' + encodeURIComponent('costs $5 and $10 today')));
  if (r.html.includes('<math')) fail('KaTeX leaked into micropage', r.html);
  if (!r.html.includes('$5')) fail('dollar amounts survive', r.html);
}
{
  // Repeating slots
  const r = renderPage(parse('p=tls~Title~one~two~three'));
  const items = (r.html.match(/<li>/g) ?? []).length;
  if (items !== 3) fail('list repeats', `expected 3 items, got ${items}`);
}
{
  // Tuple repeats read in pairs
  const r = renderPage(parse('p=tfq~FAQ~Q1~A1~Q2~A2'));
  const dts = (r.html.match(/<dt>/g) ?? []).length;
  if (dts !== 2) fail('faq pairs', `expected 2 pairs, got ${dts}`);
}
{
  // A dangling half-pair is dropped rather than rendering an empty answer
  const r = renderPage(parse('p=tfq~FAQ~Q1~A1~Q2'));
  const dts = (r.html.match(/<dt>/g) ?? []).length;
  if (dts !== 1) fail('faq drops incomplete pair', `expected 1 pair, got ${dts}`);
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
    if (!!d.repeat !== !!t.repeat) fail(`agents repeat flag for ${t.code}`, String(d.repeat));
  }
  if (!JSON.stringify(doc).includes('%2B')) fail('agents documents the + rule', 'no mention of %2B');
}

console.log(failed === 0 ? '\nAll micropage checks passed.' : `\n${failed} FAILURES`);
process.exit(failed === 0 ? 0 : 1);
