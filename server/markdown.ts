import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import markedKatex from 'marked-katex-extension';
import hljs from 'highlight.js';
import { safeUrlRenderer } from './safeMarkdown';
import { escapeHtml } from './i18n';

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

/** Render a note's Markdown to safe HTML. */
export function renderMarkdown(text: string): string {
  return marked(text) as string;
}
