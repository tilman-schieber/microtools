/**
 * URL and attribute safety for marked.
 *
 * marked v17 performs no URL sanitisation and does not escape image alt text, so
 * out of the box it will emit:
 *
 *   [x](javascript:alert(1))        -> <a href="javascript:alert(1)">
 *   ![a"onerror=alert(1) x="](y)    -> <img src="y" alt="a"onerror=alert(1) x="">
 *
 * The second is a zero-click XSS: the alt attribute closes early, leaving a bare
 * onerror, and the 404ing src fires it. Both are fixed here by overriding the
 * link and image renderers.
 *
 * IMPORTANT: a renderer override that returns false falls through to marked's
 * own (vulnerable) renderer, so the reject paths below return escaped text and
 * never false.
 */

const ALLOWED_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

/** Characters browsers strip or treat as whitespace inside a URL. */
const URL_NOISE = /[\u0000-\u0020\u007f-\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  colon: ':', tab: '\t', newline: '\n', nbsp: ' '
};

/** Escapes for a double- or single-quoted attribute. Unlike escapeHtml in index.ts, this covers '. */
export function escapeAttr(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeEntitiesOnce(s: string): string {
  return s.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);?/g, (match, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * Returns a URL safe to place in href/src, or null to reject.
 *
 * Entities are decoded before the scheme test because &#106;avascript: reaches the
 * browser as javascript: — a check against the raw string would pass it through.
 */
export function safeUrl(href: unknown): string | null {
  let url = String(href ?? '').replace(URL_NOISE, '');

  // Repeat until stable so nested encodings (&amp;#106;) cannot hide a scheme.
  for (let i = 0; i < 5; i++) {
    const next = decodeEntitiesOnce(url);
    if (next === url) break;
    url = next;
  }
  url = url.replace(URL_NOISE, '');

  if (!url) return null;

  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url);
  if (scheme && !ALLOWED_SCHEMES.has(scheme[1].toLowerCase())) return null;

  return url;
}

/**
 * link/image renderer overrides. `image` deliberately does not read token.tokens:
 * that is the path producing unescaped alt text.
 */
export const safeUrlRenderer = {
  link(this: any, token: { href: string; title?: string | null; tokens: unknown[] }) {
    const text = this.parser.parseInline(token.tokens);
    const url = safeUrl(token.href);
    if (url === null) return text;
    const title = token.title ? ` title="${escapeAttr(token.title)}"` : '';
    return `<a href="${escapeAttr(url)}"${title} rel="nofollow ugc noopener noreferrer">${text}</a>`;
  },

  image(this: any, token: { href: string; title?: string | null; text: string }) {
    const alt = escapeAttr(token.text ?? '');
    const url = safeUrl(token.href);
    if (url === null) return alt;
    const title = token.title ? ` title="${escapeAttr(token.title)}"` : '';
    return `<img src="${escapeAttr(url)}" alt="${alt}" loading="lazy" referrerpolicy="no-referrer"${title}>`;
  }
};
