import { Marked } from 'marked';
import { safeUrlRenderer } from '../server/safeMarkdown';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const m = new Marked();
m.use({ renderer: { html(t: { text: string }) { return escapeHtml(t.text); }, ...safeUrlRenderer } });

/**
 * Extracts the real attribute names from every tag, by walking quote state rather
 * than pattern-matching. Regex heuristics do not work here: `alt="a&quot;onerror=..."`
 * is inert but contains the substring `onerror=`, while `"y" alt=` is a perfectly
 * normal attribute boundary. Only tracking whether we are inside a quoted value
 * distinguishes them.
 */
function attributeNames(html: string): string[] {
  const names: string[] = [];
  for (const tag of html.match(/<[a-zA-Z][^>]*>/g) ?? []) {
    let i = tag.search(/\s/);
    if (i < 0) continue;
    while (i < tag.length) {
      while (i < tag.length && /[\s/>]/.test(tag[i])) i++;
      let name = '';
      while (i < tag.length && !/[\s=/>]/.test(tag[i])) name += tag[i++];
      while (i < tag.length && /\s/.test(tag[i])) i++;
      if (tag[i] === '=') {
        i++;
        while (i < tag.length && /\s/.test(tag[i])) i++;
        const quote = tag[i];
        if (quote === '"' || quote === "'") {
          i++;
          while (i < tag.length && tag[i] !== quote) i++;
          i++;
        } else {
          while (i < tag.length && !/[\s>]/.test(tag[i])) i++;
        }
      }
      if (name) names.push(name.toLowerCase());
    }
  }
  return names;
}

/** True if any tag carries an event-handler attribute — the actual breakout signature. */
function hasEventHandler(html: string): boolean {
  return attributeNames(html).some((n) => n.startsWith('on'));
}

// Each case: [description, markdown, forbidden patterns]
const cases: [string, string, (string | RegExp)[]][] = [
  ['image alt breakout (zero-click)', '![a"onerror=alert(1) x="](y)', ['EVENT_HANDLER']],
  ['image title breakout', '![a](y "t\\" onload=alert(1) x=\\"")', ['EVENT_HANDLER']],
  ['link title breakout', '[a](https://ok.dev "t\\" onmouseover=alert(1) x=\\"")', ['EVENT_HANDLER']],
  ['javascript link', '[x](javascript:alert(1))', ['href="javascript:']],
  ['javascript mixed case', '[x](JaVaScRiPt:alert(1))', [/href="\s*javascript:/i]],
  ['javascript leading space', '[x](  javascript:alert(1)  )', [/href="\s*javascript:/i]],
  ['entity-encoded scheme', '[x](&#106;avascript:alert(1))', [/href="[^"]*javascript:/i, 'href="&#106;']],
  ['nested entity scheme', '[x](&amp;#106;avascript:alert(1))', [/href="[^"]*javascript:/i]],
  ['data text/html', '[x](data:text/html,<script>alert(1)</script>)', ['href="data:text/html']],
  ['vbscript', '[x](vbscript:msgbox(1))', [/href="\s*vbscript:/i]],
  ['reference definition', '[a][r]\n\n[r]: javascript:alert(1)', [/href="[^"]*javascript:/i]],
  ['autolink', '<javascript:alert(1)>', [/href="[^"]*javascript:/i]],
  ['image javascript src', '![alt](javascript:alert(1))', [/src="[^"]*javascript:/i]],
  ['raw html', '<img src=x onerror=alert(1)>', ['<img src=x']],
  ['tab-split scheme', '[x](java\tscript:alert(1))', [/href="[^"]*javascript:/i]],
  ['newline-split scheme', '[x](java\nscript:alert(1))', [/href="[^"]*javascript:/i]],
];

let failed = 0;
for (const [desc, md, forbidden] of cases) {
  const outBlock = m.parse(md);
  const outInline = m.parseInline(md);
  for (const [mode, out] of [['block', outBlock], ['inline', outInline]]) {
    for (const bad of forbidden) {
      const hit = bad === 'EVENT_HANDLER' ? hasEventHandler(out)
        : typeof bad === 'string' ? out.includes(bad) : bad.test(out);
      if (hit) {
        console.log(`FAIL [${mode}] ${desc}\n     matches ${bad}\n     in ${out.trim()}`);
        failed++;
      }
    }
  }
}

// Positive cases: legitimate content must survive
const positives = [
  ['https link', '[ok](https://example.com/a?b=1&c=2)', 'href="https://example.com/a?b=1&amp;c=2"'],
  ['mailto', '[mail](mailto:a@b.dev)', 'href="mailto:a@b.dev"'],
  ['relative link', '[rel](/notes/new)', 'href="/notes/new"'],
  ['anchor', '[top](#section)', 'href="#section"'],
  ['https image', '![logo](https://example.com/l.png)', 'src="https://example.com/l.png"'],
  ['bold', '**bold**', '<strong>bold</strong>'],
];
for (const [desc, md, expected] of positives) {
  const out = m.parseInline(md);
  if (!out.includes(expected)) {
    console.log(`FAIL positive ${desc}\n     expected ${JSON.stringify(expected)}\n     got ${out}`);
    failed++;
  }
}

// Rejected links must degrade to readable text, never vanish or return false
const degraded = m.parseInline('[click me](javascript:alert(1))');
if (!degraded.includes('click me')) {
  console.log(`FAIL rejected link lost its text: ${degraded}`);
  failed++;
}

console.log(failed === 0
  ? `\nAll ${cases.length + positives.length + 1} checks passed.`
  : `\n${failed} FAILURES`);
process.exit(failed === 0 ? 0 : 1);
