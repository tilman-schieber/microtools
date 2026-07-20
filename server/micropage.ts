/**
 * Micropage — a complete webpage encoded entirely in its URL.
 *
 *   /micropage?p=tsg.cd~BACK IN 10~Back by 14:30
 *                │   │  │          └── slot 2: the smaller note
 *                │   │  └───────────── slot 1: the big line
 *                │   └──────────────── theme: dark
 *                └──────────────────── template: sign
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
  { code: 'ct', name: 'Terminal', description: 'Monospace on near-black, with dashed rules', defaultAccent: 'amb', dark: true },
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

/** Emits an element only when the slot has content, so empty slots vanish rather than render blank. */
function el(tag: string, cls: string, content: string): string {
  return content.trim() ? `<${tag} class="${cls}">${inline(content)}</${tag}>` : '';
}

export const WIFI_SECURITY = ['WPA', 'WEP', 'none'];

/**
 * The WIFI: payload a phone camera reads to offer joining a network.
 *
 *   WIFI:T:WPA;S:My Network;P:secret;;
 *
 * Backslash-escaping is required for \ ; , : and " inside the values, otherwise
 * an SSID containing a semicolon truncates the payload and the code silently
 * encodes the wrong network. An open network omits the P field entirely.
 */
export function wifiPayload(ssid: string, password: string, type: string): string {
  const esc = (v: string) => v.replace(/([\\;,:"])/g, '\\$1');
  const pass = type === 'nopass' ? '' : `P:${esc(password)};`;
  return `WIFI:T:${type};S:${esc(ssid)};${pass};`;
}

/**
 * Three arcs and a dot. Stroked with currentColor and sized in em so it inherits
 * whatever the theme sets, rather than carrying colours of its own.
 */
function wifiIcon(): string {
  return `
      <svg class="mp-wifi-icon" viewBox="0 0 24 24" role="img" aria-label="Wi-Fi"
           fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round">
        <path d="M1.6 8.9a15 15 0 0 1 20.8 0"/>
        <path d="M5.2 12.9a10 10 0 0 1 13.6 0"/>
        <path d="M8.7 16.7a5.2 5.2 0 0 1 6.6 0"/>
        <circle cx="12" cy="20.4" r="1.35" fill="currentColor" stroke="none"/>
      </svg>`;
}

/** Widest bucket the sign stylesheet defines; longer text simply renders smaller. */
export const SIGN_MAX_WIDTH = 44;

/**
 * Rough advance width of a string, in em, for a bold sans face.
 *
 * The sign scales its text to fill the page, which needs the text's width — but
 * the render page runs no JavaScript (script-src 'none'), so nothing can measure
 * it in the browser. A character count alone is poor for a proportional font
 * ("WWW" against "iii"), so characters are weighted into rough classes.
 */
export function estimateEmWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    if (ch === ' ') width += 0.30;
    else if ("iljtfrI!|.,:;'()[]".includes(ch)) width += 0.34;
    else if ('mwMW@%'.includes(ch)) width += 0.95;
    else if (ch >= 'A' && ch <= 'Z') width += 0.68;
    else width += 0.56;
  }
  return Math.max(width, 1);
}

/** Bucketed to an integer so it can be a CSS class: the CSP forbids inline styles. */
function signWidthBucket(text: string): number {
  return Math.min(SIGN_MAX_WIDTH, Math.max(1, Math.ceil(estimateEmWidth(text))));
}

export const TEMPLATES: TemplateDef[] = [
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
    code: 'tsg',
    name: 'Sign',
    description: 'One line of text scaled to fill the page. For printing and taping to a door.',
    slots: [
      { name: 'text', kind: 'inline', description: 'The single line, kept short' },
      { name: 'note', kind: 'inline', description: 'Smaller line beneath' }
    ],
    example: 'tsg.cl.alob~BACK IN 10 MIN~Back by 14:30',
    render: (s) => {
      const text = (s[0] ?? '').trim();
      const note = s[1] ?? '';
      if (!text) {
        return `<section class="mp-sign"><p class="mp-lede">Add a line of text for the sign.</p></section>`;
      }
      return `
      <section class="mp-sign">
        <div class="mp-sign-text mp-sign-text--w${signWidthBucket(text)}">${inline(text)}</div>
        ${el('p', 'mp-sign-note', note)}
      </section>`;
    }
  },
  {
    code: 'twf',
    name: 'WiFi',
    description: 'A network name, password, and a QR code that joins the network when scanned.',
    slots: [
      { name: 'network', kind: 'inline', description: 'The SSID, exactly as broadcast' },
      { name: 'password', kind: 'inline', description: 'The passphrase; leave empty for an open network' },
      { name: 'security', kind: 'enum', description: 'Encryption', values: WIFI_SECURITY }
    ],
    example: 'twf.cl.asky~Guest WiFi~hunter2hunter2~WPA',
    render: (s) => {
      const ssid = (s[0] ?? '').trim();
      const password = (s[1] ?? '').trim();
      const chosen = (s[2] ?? '').trim();
      const security = WIFI_SECURITY.includes(chosen) ? chosen : (password ? 'WPA' : 'none');

      if (!ssid) {
        return `<section class="mp-wifi">${wifiIcon()}
          <p class="mp-lede">Add a network name to generate a join code.</p></section>`;
      }

      const type = security === 'none' ? 'nopass' : security;
      const payload = wifiPayload(ssid, password, type);

      let svg: string;
      try {
        const qr = qrcode(0, 'M');
        qr.addData(payload);
        qr.make();
        svg = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
      } catch {
        throw new SpecError(
          'That network name and password are too long for a QR code.',
          'Shorten them, or drop the password and share it separately.'
        );
      }

      const rows = [
        `<div><dt>Network</dt><dd class="mp-wifi-value">${escapeAttr(ssid)}</dd></div>`,
        type === 'nopass'
          ? `<div><dt>Password</dt><dd class="mp-wifi-value">None — open network</dd></div>`
          : `<div><dt>Password</dt><dd class="mp-wifi-value">${escapeAttr(password)}</dd></div>`
      ].join('');

      return `
      <section class="mp-wifi">
        ${wifiIcon()}
        <h1 class="mp-title">${inline(ssid)}</h1>
        <div class="mp-qr-frame">${svg}</div>
        <p class="mp-wifi-hint">Point a camera at the code to join</p>
        <dl class="mp-wifi-details">${rows}</dl>
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
    `micropage-page--${spec.template.code}`,
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
    version: 2,
    summary:
      'Builds a complete, styled webpage out of one URL parameter. Nothing is stored: ' +
      'the URL is the document, so the link is the only artefact and it can be shared, ' +
      'bookmarked or edited by hand. Pages carry no JavaScript.',
    howToUse:
      'Pick a template, then supply its slots in order. Compose the URL as ' +
      '/micropage?p=<template>.<theme>[.<width>][.a<accent>][.x<flags>]~<slot1>~<slot2>. ' +
      'Percent-encode each slot separately, then join with literal ~ characters. ' +
      'Read the encoding rules below before generating a link by hand: three of them ' +
      'silently corrupt content rather than erroring.',
    grammar: {
      shape: '/micropage?p=<head>~<slot>~<slot>...',
      head:
        'Dot-separated codes, namespaced by first letter: t=template, c=theme, w=width, ' +
        'a=accent, x=flags. Order does not matter. Only the template code is required; ' +
        'everything else falls back to a default.',
      slots:
        'Everything after the first ~ is slot content, positionally matched to the slots ' +
        'the chosen template declares. Extra slots are ignored; missing ones are omitted ' +
        'from the page rather than rendered blank.',
      rules: [
        'Percent-encode each slot. The ~ between slots must stay literal; a tilde INSIDE content must be written %7E, or it will be read as a slot separator.',
        'An empty slot is two consecutive tildes.',
        'Never leave a literal + in content: write %2B. Some clients decode a bare + as a space, so "C++" silently becomes "C  ".',
        'Never leave a literal # in content: write %23. Everything after a # is a URL fragment, is never sent to the server, and is lost with no error.',
        'Slot content is markdown-lite: **bold**, _italic_, `code`, [label](https://url) links, and line breaks. The Article body slot also takes headings, lists, quotes and code blocks.',
        'Only http, https, mailto and tel links survive; any other scheme renders as plain text. Raw HTML is escaped, never rendered.',
        'Keep the whole link under the length limit below. It is set so every page stays QR-encodable.'
      ]
    },
    notes: [
      'Slot order for a given template is fixed permanently, because a shared link has no stored record to migrate.',
      'The Sign template scales its text to fill the page, so it works best with a handful of words.',
      'The QR template renders the code server-side as inline SVG, always dark on white so it scans on any theme.'
    ],
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
