// ============================================================
//  i18n — every user-facing string goes through t()
// ============================================================
//  Locale files may contain markup and HTML entities: they are
//  written by us and are trusted. Parameters never are: t()
//  HTML-escapes every value it substitutes, so the result is
//  always safe to emit unescaped (<%- t('key', { name }) %>).
//
//  Language belongs to the viewer, not to the link, because
//  links get passed on: ?lang= → cookie → Accept-Language → en.
// ============================================================
import en from './locales/en';
import de from './locales/de';

export type Lang = 'en' | 'de';
export type Key = keyof typeof en;
export type Params = Record<string, string | number>;

export const LANGS: Lang[] = ['en', 'de'];
export const DEFAULT_LANG: Lang = 'en';

const TABLES: Record<Lang, Record<string, string>> = { en, de };
// en-US rather than en-GB: it is what the English pages have always shown
const LOCALES: Record<Lang, string> = { en: 'en-US', de: 'de-DE' };
const pluralRules: Record<Lang, Intl.PluralRules> = {
  en: new Intl.PluralRules('en'),
  de: new Intl.PluralRules('de')
};

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as string[]).includes(value);
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function lookup(lang: Lang, key: string): string {
  // A missing translation falls back to English; a missing key shows itself
  // loudly in development but never crashes a page.
  return TABLES[lang][key] ?? TABLES[DEFAULT_LANG][key] ?? key;
}

function fill(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? escapeHtml(String(params[name])) : whole
  );
}

export interface I18n {
  lang: Lang;
  locale: string;
  /** Translated string, parameters HTML-escaped. Safe to emit unescaped. */
  t: (key: Key | string, params?: Params) => string;
  /** Plural-aware: picks `<key>.one` / `<key>.other` and passes {n}. */
  tn: (key: string, n: number, params?: Params) => string;
  fmtDate: (value: string | number | Date, style?: 'short' | 'long') => string;
  fmtMoney: (amount: number, symbol: string) => string;
}

const DATE_STYLES: Record<'short' | 'long', Intl.DateTimeFormatOptions> = {
  short: { weekday: 'short', month: 'short', day: 'numeric' },
  long: { year: 'numeric', month: 'long', day: 'numeric' }
};

function build(lang: Lang): I18n {
  const locale = LOCALES[lang];
  const number = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const t = (key: string, params?: Params) => fill(lookup(lang, key), params);
  return {
    lang,
    locale,
    t,
    tn: (key, n, params) => t(`${key}.${pluralRules[lang].select(n) === 'one' ? 'one' : 'other'}`, { ...params, n }),
    fmtDate: (value, style = 'short') => {
      // A bare YYYY-MM-DD is a calendar day, not an instant: pin it to local
      // midnight so it cannot slip a day across time zones.
      const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? new Date(value + 'T00:00:00')
        : new Date(value);
      return date.toLocaleDateString(locale, DATE_STYLES[style]);
    },
    // The currency is stored as a bare symbol chosen by the group, so this is
    // placement and decimal mark only: €84.50 in English, 84,50 € in German.
    fmtMoney: (amount, symbol) =>
      lang === 'de' ? `${number.format(amount)} ${symbol}` : `${symbol}${number.format(amount)}`
  };
}

const INSTANCES: Record<Lang, I18n> = { en: build('en'), de: build('de') };

export function i18n(lang: Lang): I18n {
  return INSTANCES[lang];
}

// ---------------------------------------------------------------------------
// Resolving the viewer's language
// ---------------------------------------------------------------------------

export const LANG_COOKIE = 'lang';

function fromCookie(header: string | undefined): Lang | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, value] = part.trim().split('=');
    if (name === LANG_COOKIE && isLang(value)) return value;
  }
  return null;
}

function fromAcceptLanguage(header: string | undefined): Lang | null {
  if (!header) return null;
  const ranked = header
    .split(',')
    .map((entry) => {
      const [tag, ...rest] = entry.trim().split(';');
      const q = rest.map((r) => r.trim()).find((r) => r.startsWith('q='));
      return { base: tag.toLowerCase().split('-')[0], q: q ? parseFloat(q.slice(2)) || 0 : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { base } of ranked) {
    if (isLang(base)) return base;
  }
  return null;
}

export function resolveLang(headers: { cookie?: string; 'accept-language'?: string }): Lang {
  return fromCookie(headers.cookie) ?? fromAcceptLanguage(headers['accept-language']) ?? DEFAULT_LANG;
}

/** Set-Cookie value for an explicit choice. Functional only: one word, no identifier. */
export function langCookie(lang: Lang): string {
  return `${LANG_COOKIE}=${lang}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

// ---------------------------------------------------------------------------
// Strings for client-side scripts
// ---------------------------------------------------------------------------

/**
 * The `js.*` keys of a language as a plain object (`js.copied` → `copied`), plus
 * `_lang` and `_locale`. Emitted once per page as window.T. These strings are
 * assigned via textContent as often as innerHTML, so they hold no markup.
 */
const clientCache = new Map<Lang, string>();

export function clientStrings(lang: Lang): string {
  let json = clientCache.get(lang);
  if (!json) {
    const out: Record<string, string> = { _lang: lang, _locale: LOCALES[lang] };
    for (const key of Object.keys(TABLES[DEFAULT_LANG])) {
      if (key.startsWith('js.')) out[key.slice(3)] = lookup(lang, key);
    }
    // Keys that only exist in a translation (builder labels that English takes
    // straight from the micropage registry)
    for (const key of Object.keys(TABLES[lang])) {
      if (key.startsWith('js.') && !(key.slice(3) in out)) out[key.slice(3)] = TABLES[lang][key];
    }
    // Emitted inside <script>: keep a stray "</script>" or "<!--" from ending it
    json = JSON.stringify(out).replace(/</g, '\\u003c');
    clientCache.set(lang, json);
  }
  return json;
}
