/**
 * Micropage — a complete webpage encoded entirely in its URL.
 *
 *   /micropage?p=thp.cd~Welcome~Built entirely from a URL
 *                │   │  │        └── slot 2
 *                │   │  └─────────── slot 1
 *                │   └────────────── theme: dark
 *                └────────────────── template: heading + paragraph
 *
 * Nothing is stored. The URL is the page.
 */

import { Marked } from 'marked';
import qrcode from 'qrcode-generator';
import { safeUrlRenderer, escapeAttr, safeUrl } from './safeMarkdown';

// ---------------------------------------------------------------------------
// Markdown instance
// ---------------------------------------------------------------------------

/**
 * A dedicated instance, deliberately NOT the global `marked` from index.ts.
 * The global has KaTeX and highlight.js applied, which would make "$5 and $10"
 * in a slot render as maths. Micropage wants plain prose plus the URL safety.
 */
const md = new Marked();
md.use({
  breaks: true,
  renderer: {
    html(token: { text: string }) {
      return escapeAttr(token.text);
    },
    ...safeUrlRenderer
  }
});

const inline = (s: string): string => md.parseInline(s) as string;
const block = (s: string): string => md.parse(s) as string;

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

export interface AccentDef {
  code: string;
  name: string;
  hex: string;
  /** Readable text colour when this accent is used as a background. */
  on: string;
  /** Readable link colour on a light page. */
  onLight: string;
  /** Readable link colour on a dark page. */
  onDark: string;
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const v = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Text on an accent background must not inherit the page background colour:
 * white on amber is unreadable. Pick whichever of near-black/white contrasts better.
 */
function readableOn(hex: string): string {
  const l = luminance(hex);
  return contrast(l, 1) >= contrast(l, 0) ? '#ffffff' : '#141414';
}

function mix(hex: string, towards: string, amount: number): string {
  const parse = (h: string) => [0, 2, 4].map((i) => parseInt(h.replace('#', '').slice(i, i + 2), 16));
  const [r1, g1, b1] = parse(hex);
  const [r2, g2, b2] = parse(towards);
  const c = (a: number, b: number) => Math.round(a + (b - a) * amount);
  return '#' + [c(r1, r2), c(g1, g2), c(b1, b2)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/**
 * An accent used as link *text* has the opposite problem to one used as a background:
 * amber on white is ~1.7:1. Darken (or lighten, on dark themes) until it clears WCAG AA.
 */
function readableText(hex: string, background: string): string {
  const bg = luminance(background);
  const towards = bg > 0.5 ? '#000000' : '#ffffff';
  let candidate = hex;
  for (let step = 0; step <= 20; step++) {
    if (contrast(luminance(candidate), bg) >= 4.5) return candidate;
    candidate = mix(hex, towards, step / 20);
  }
  return towards === '#000000' ? '#141414' : '#f5f5f5';
}

/** Backgrounds the themes actually use, so link colours can be precomputed against them. */
const LIGHT_BG = '#ffffff';
const DARK_BG = '#14161a';

/** Named accents rather than raw hex: a lookup key cannot inject CSS. */
export const ACCENTS: AccentDef[] = [
  { code: 'lob', name: 'Lobster', hex: '#E15554' },
  { code: 'rub', name: 'Ruby', hex: '#A31621' },
  { code: 'amb', name: 'Amber', hex: '#ECC30B' },
  { code: 'tig', name: 'Tiger', hex: '#F18701' },
  { code: 'lil', name: 'Lilac', hex: '#7768AE' },
  { code: 'sky', name: 'Sky', hex: '#4D9DE0' },
  { code: 'esp', name: 'Espresso', hex: '#551B14' },
  { code: 'pru', name: 'Prussian', hex: '#0A2239' },
  { code: 'gry', name: 'Grey', hex: '#6B7280' }
].map((a) => ({
  ...a,
  on: readableOn(a.hex),
  onLight: readableText(a.hex, LIGHT_BG),
  onDark: readableText(a.hex, DARK_BG)
}));

export interface ThemeDef {
  code: string;
  name: string;
  description: string;
  defaultAccent: string;
  dark: boolean;
}

export const THEMES: ThemeDef[] = [
  { code: 'cl', name: 'Light', description: 'Clean light page, system sans', defaultAccent: 'sky', dark: false },
  { code: 'cd', name: 'Dark', description: 'Dark page, system sans', defaultAccent: 'amb', dark: true },
  { code: 'cm', name: 'Minimal mono', description: 'Monospace, generous whitespace', defaultAccent: 'pru', dark: false },
  { code: 'cp', name: 'Paper', description: 'Serif on faintly textured off-white', defaultAccent: 'esp', dark: false },
  { code: 'ct', name: 'Terminal', description: 'Monospace, green on near-black', defaultAccent: 'amb', dark: true },
  { code: 'cb', name: 'Brutalist', description: 'Heavy rules, flat black on white', defaultAccent: 'lob', dark: false }
];

export interface WidthDef { code: string; name: string; css: string; }

export const WIDTHS: WidthDef[] = [
  { code: 'ws', name: 'Small', css: '32rem' },
  { code: 'wm', name: 'Medium', css: '44rem' },
  { code: 'wl', name: 'Large', css: '60rem' },
  { code: 'wf', name: 'Full', css: 'none' }
];

export interface FlagDef { code: string; name: string; description: string; }

export const FLAGS: FlagDef[] = [
  { code: 'c', name: 'Center', description: 'Centre all text' },
  { code: 'b', name: 'Big', description: 'Larger display type scale' }
];

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const LIMITS = {
  /** Encoded query length. 1800 keeps every micropage URL QR-encodable (QR v40 binary ~1852 B). */
  maxQueryLength: 1800,
  maxSlots: 24,
  maxInlineSlot: 600,
  maxBlockSlot: 2000,
  maxRenderedBytes: 64 * 1024
};

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export interface SlotDef {
  name: string;
  kind: 'inline' | 'block' | 'enum';
  description: string;
  values?: string[];
}

export interface TemplateDef {
  code: string;
  name: string;
  description: string;
  slots: SlotDef[];
  example: string;
  render: (slots: string[]) => string;
}

const NOTICE_KINDS = ['info', 'warn', 'ok', 'err'];

/** Emits an element only when the slot has content, so empty slots vanish rather than render blank. */
function el(tag: string, cls: string, content: string): string {
  return content.trim() ? `<${tag} class="${cls}">${inline(content)}</${tag}>` : '';
}

export const TEMPLATES: TemplateDef[] = [
  {
    code: 'thp',
    name: 'Hero',
    description: 'A heading with a short paragraph beneath it.',
    slots: [
      { name: 'heading', kind: 'inline', description: 'The h1' },
      { name: 'body', kind: 'inline', description: 'A short paragraph' }
    ],
    example: 'thp.cd~Welcome~Built entirely from a URL',
    render: (s) => `
      <header class="mp-hero">
        ${el('h1', 'mp-title', s[0] ?? '')}
        ${el('p', 'mp-lede', s[1] ?? '')}
      </header>`
  },
  {
    code: 'tar',
    name: 'Article',
    description: 'Title, standfirst, and a full markdown body.',
    slots: [
      { name: 'title', kind: 'inline', description: 'The h1' },
      { name: 'lede', kind: 'inline', description: 'Standfirst paragraph' },
      { name: 'body', kind: 'block', description: 'Markdown: headings, lists, quotes, code' }
    ],
    example: 'tar.cp.wm~On Small Tools~Why a URL is enough~## First\\n\\nSome **prose**.',
    render: (s) => `
      <article class="mp-article">
        ${el('h1', 'mp-title', s[0] ?? '')}
        ${el('p', 'mp-lede', s[1] ?? '')}
        ${(s[2] ?? '').trim() ? `<div class="mp-prose">${block(s[2])}</div>` : ''}
      </article>`
  },
  {
    code: 'tev',
    name: 'Event',
    description: 'Title, when, where, details, and a link.',
    slots: [
      { name: 'title', kind: 'inline', description: 'The h1' },
      { name: 'when', kind: 'inline', description: 'Date and time, as free text' },
      { name: 'where', kind: 'inline', description: 'Location, as free text' },
      { name: 'details', kind: 'block', description: 'Markdown details' },
      { name: 'link', kind: 'inline', description: 'A markdown link, e.g. tickets' }
    ],
    example: 'tev.cb~Release party~Fri 7pm~The Old Bakery~Bring cake.~[RSVP](https://example.dev)',
    render: (s) => `
      <section class="mp-event">
        ${el('h1', 'mp-title', s[0] ?? '')}
        <dl class="mp-meta">
          ${(s[1] ?? '').trim() ? `<div><dt>When</dt><dd>${inline(s[1])}</dd></div>` : ''}
          ${(s[2] ?? '').trim() ? `<div><dt>Where</dt><dd>${inline(s[2])}</dd></div>` : ''}
        </dl>
        ${(s[3] ?? '').trim() ? `<div class="mp-prose">${block(s[3])}</div>` : ''}
        ${(s[4] ?? '').trim() ? `<p class="mp-cta">${inline(s[4])}</p>` : ''}
      </section>`
  },
  {
    code: 'tnt',
    name: 'Notice',
    description: 'A single status banner: info, warn, ok, or err.',
    slots: [
      { name: 'kind', kind: 'enum', description: 'Banner style', values: NOTICE_KINDS },
      { name: 'title', kind: 'inline', description: 'The h1' },
      { name: 'body', kind: 'inline', description: 'Supporting line' }
    ],
    example: 'tnt.cl~warn~Maintenance Sunday~Back by 09:00.',
    render: (s) => {
      const kind = NOTICE_KINDS.includes((s[0] ?? '').trim()) ? (s[0] ?? '').trim() : 'info';
      return `
      <section class="mp-notice mp-notice--${kind}">
        ${el('h1', 'mp-title', s[1] ?? '')}
        ${el('p', 'mp-lede', s[2] ?? '')}
      </section>`;
    }
  },
  {
    code: 'tqr',
    name: 'QR code',
    description: 'A title above a large scannable QR code of a link.',
    slots: [
      { name: 'title', kind: 'inline', description: 'Shown above the code' },
      { name: 'link', kind: 'inline', description: 'The URL the code points to' }
    ],
    example: 'tqr.cl.apru~Scan to open~https://example.dev',
    render: (s) => {
      const title = s[0] ?? '';
      const target = (s[1] ?? '').trim();
      if (!target) {
        return `<section class="mp-qr">${el('h1', 'mp-title', title)}
          <p class="mp-lede">Add a link to generate a code.</p></section>`;
      }
      // Rendered server-side: the page's CSP sets script-src 'none', so the
      // client-side QR library used elsewhere in the app cannot run here.
      let svg: string;
      try {
        const qr = qrcode(0, 'M');
        qr.addData(target);
        qr.make();
        svg = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
      } catch {
        throw new SpecError(
          'That link is too long to fit in a QR code.',
          `A QR code holds roughly 1200 characters at this error-correction level; yours is ${target.length}.`
        );
      }
      const safe = safeUrl(target);
      const caption = safe
        ? `<a class="mp-qr-target" href="${escapeAttr(safe)}" rel="nofollow ugc noopener noreferrer">${escapeAttr(target)}</a>`
        : `<span class="mp-qr-target">${escapeAttr(target)}</span>`;
      return `
      <section class="mp-qr">
        ${el('h1', 'mp-title', title)}
        <div class="mp-qr-frame">${svg}</div>
        <p class="mp-qr-caption">${caption}</p>
      </section>`;
    }
  }
];

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export interface Spec {
  template: TemplateDef;
  theme: ThemeDef;
  width: WidthDef | null;
  accent: AccentDef;
  flags: string[];
  slots: string[];
}

export class SpecError extends Error {
  constructor(message: string, readonly detail?: string) {
    super(message);
  }
}

const byCode = <T extends { code: string }>(list: T[], code: string): T | undefined =>
  list.find((x) => x.code === code);

/**
 * Extracts the RAW (still percent-encoded) value of `p` from a full request URL.
 *
 * Splitting before decoding is what makes the grammar unambiguous: %7E survives as
 * a literal tilde distinct from the ~ delimiter, ~~ is unambiguously an empty slot,
 * and `+` stays a plus instead of silently becoming a space.
 */
function rawParam(requestUrl: string, name: string): string | null {
  const q = requestUrl.indexOf('?');
  if (q < 0) return null;
  const query = requestUrl.slice(q + 1);
  for (const pair of query.split('&')) {
    if (pair === name) return '';
    if (pair.startsWith(name + '=')) return pair.slice(name.length + 1);
  }
  return null;
}

function decodeSlot(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new SpecError(
      'That link contains a broken percent-escape.',
      `Could not decode "${raw.slice(0, 40)}". Every % must be followed by two hex digits.`
    );
  }
}

export function parseSpec(requestUrl: string): Spec {
  const raw = rawParam(requestUrl, 'p');
  if (raw === null || raw === '') {
    throw new SpecError('This link has no page in it.', 'Expected a "p" parameter, e.g. ?p=thp.cd~Hello~World');
  }

  const q = requestUrl.indexOf('?');
  const queryLength = q < 0 ? 0 : requestUrl.length - q - 1;
  if (queryLength > LIMITS.maxQueryLength) {
    throw new SpecError(
      'This page is too long for a URL.',
      `The link is ${queryLength} characters; the limit is ${LIMITS.maxQueryLength}, which keeps it QR-encodable.`
    );
  }

  const pieces = raw.split('~');
  const head = decodeSlot(pieces[0]);
  const slots = pieces.slice(1).map(decodeSlot);

  if (slots.length > LIMITS.maxSlots) {
    throw new SpecError(
      'Too many slots.',
      `Found ${slots.length}; the limit is ${LIMITS.maxSlots}.`
    );
  }

  let template = TEMPLATES[0];
  let theme = THEMES[0];
  let width: WidthDef | null = null;
  let accent: AccentDef | null = null;
  const flags: string[] = [];

  for (const code of head.split('.').filter(Boolean)) {
    const t = byCode(TEMPLATES, code);
    const c = byCode(THEMES, code);
    const w = byCode(WIDTHS, code);
    if (t) { template = t; continue; }
    if (c) { theme = c; continue; }
    if (w) { width = w; continue; }
    if (code.startsWith('a')) {
      const a = byCode(ACCENTS, code.slice(1));
      if (!a) {
        throw new SpecError(
          `Unknown accent "${code}".`,
          `Accents are: ${ACCENTS.map((x) => 'a' + x.code).join(', ')}.`
        );
      }
      accent = a;
      continue;
    }
    if (code.startsWith('x')) {
      for (const ch of code.slice(1)) {
        if (!FLAGS.some((f) => f.code === ch)) {
          throw new SpecError(
            `Unknown flag "x${ch}".`,
            `Flags are: ${FLAGS.map((f) => 'x' + f.code).join(', ')}.`
          );
        }
        flags.push(ch);
      }
      continue;
    }
    throw new SpecError(
      `Unknown code "${code}".`,
      `Templates: ${TEMPLATES.map((x) => x.code).join(', ')}. Themes: ${THEMES.map((x) => x.code).join(', ')}.`
    );
  }

  const limit = (kind: string) => (kind === 'block' ? LIMITS.maxBlockSlot : LIMITS.maxInlineSlot);
  slots.forEach((value, i) => {
    const def = template.slots[i];
    const max = limit(def?.kind ?? 'inline');
    if (value.length > max) {
      throw new SpecError(
        `Slot ${i + 1}${def ? ` (${def.name})` : ''} is too long.`,
        `It is ${value.length} characters; the limit is ${max}.`
      );
    }
  });

  if (slots.length > template.slots.length) {
    // Lenient: extra slots are ignored rather than rejected, so a hand-trimmed
    // URL still renders.
    slots.length = template.slots.length;
  }

  return {
    template,
    theme,
    width,
    accent: accent ?? byCode(ACCENTS, theme.defaultAccent) ?? ACCENTS[0],
    flags,
    slots
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export interface RenderedPage {
  html: string;
  bodyClass: string;
  title: string;
  description: string;
}

/** Plain-text reduction of a slot, for <title> and OG tags. */
function plain(s: string, max = 200): string {
  const text = (s ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

export function renderPage(spec: Spec): RenderedPage {
  const html = spec.template.render(spec.slots);
  if (Buffer.byteLength(html, 'utf8') > LIMITS.maxRenderedBytes) {
    throw new SpecError('That page renders to too much HTML.', 'Shorten the content and try again.');
  }

  // Accent and width are emitted as classes, not an inline style attribute: the
  // route's CSP sets style-src 'self', which blocks inline styles. Both are fixed
  // sets, so a class per value works and keeps the CSP strict.
  const classes = [
    'micropage-page',
    `micropage-page--${spec.theme.code}`,
    `micropage-page--a${spec.accent.code}`,
    ...(spec.width ? [`micropage-page--${spec.width.code}`] : []),
    ...spec.flags.map((f) => `micropage-page--x${f}`)
  ];

  return {
    html,
    bodyClass: classes.join(' '),
    title: plain(spec.slots[0] ?? '', 80) || spec.template.name,
    description: plain(spec.slots[1] ?? '', 160)
  };
}

// ---------------------------------------------------------------------------
// Machine-readable description (drives /micropage/agents and the docs page)
// ---------------------------------------------------------------------------

export function describeRegistry(origin: string) {
  return {
    version: 1,
    summary: 'Renders a complete webpage from a single URL parameter. Nothing is stored server-side.',
    grammar: {
      shape: '/micropage?p=<head>~<slot>~<slot>...',
      head: 'Dot-separated codes. Namespaced by first letter: t=template, c=theme, w=width, a=accent, x=flags. Order does not matter.',
      slots: 'Everything after the first ~ is slot content, in the order the template declares.',
      rules: [
        'Percent-encode content before putting it in the URL. The separator ~ is literal; a tilde inside content must be written %7E.',
        'An empty slot is written as two consecutive tildes.',
        'Do NOT leave a literal + in content: some clients read it as a space. Write %2B.',
        'A literal # ends the URL and is never sent to the server. Always write %23.',
        'Slot content is markdown-lite: **bold**, _italic_, `code`, and [label](https://url) links.',
        'Only http, https, mailto and tel links are kept; anything else renders as plain text.'
      ]
    },
    limits: LIMITS,
    templates: TEMPLATES.map((t) => ({
      code: t.code,
      name: t.name,
      description: t.description,
      slots: t.slots.map(({ name, kind, description, values }) => ({ name, kind, description, values })),
      example: `${origin}/micropage?p=${encodeURIComponent(t.example).replace(/%7E/g, '~')}`
    })),
    themes: THEMES.map(({ code, name, description }) => ({ code, name, description })),
    widths: WIDTHS.map(({ code, name }) => ({ code, name })),
    accents: ACCENTS.map(({ code, name, hex, on }) => ({ code: 'a' + code, name, hex, textOn: on })),
    flags: FLAGS.map(({ code, name, description }) => ({ code: 'x' + code, name, description }))
  };
}
