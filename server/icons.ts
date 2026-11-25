// The few small icons the tools use instead of emoji. Drawn on the same
// 24-unit grid with round ends as the landing page's tool icons, and coloured
// by `currentColor`, so CSS decides the colour. Views call icon('yes'); the
// browser gets the same markup as window.ICONS for script-built cells.

const SHAPES = {
  // Poll answers. Yes is the one that should stand out: a filled disc. Maybe is
  // the same check in an open ring. No is a quiet cross with no ring at all.
  yes: '<circle cx="12" cy="12" r="9.5" fill="currentColor" stroke="none"/><path d="M8 12.4l2.7 2.7L16 9.6" stroke="#fff" stroke-width="2"/>',
  maybe: '<circle cx="12" cy="12" r="8.75" stroke-width="1.5"/><path d="M8.4 12.4l2.5 2.5 4.7-5" stroke-width="1.75"/>',
  no: '<path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke-width="2"/>',
  // A bare check, for a selected slot in the poll's time grid
  check: '<path d="M6 12.5l4 4L18 8.5" stroke-width="2.25"/>',
  // Close / remove
  x: '<path d="M7 7l10 10M17 7L7 17" stroke-width="1.75"/>',
} as const;

export type IconName = keyof typeof SHAPES;

const svg = (name: IconName) =>
  `<svg class="icon icon-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${SHAPES[name]}</svg>`;

const RENDERED = Object.fromEntries(Object.keys(SHAPES).map((n) => [n, svg(n as IconName)])) as Record<IconName, string>;

/** Inline SVG markup for an icon; decorative, so pair it with text or an aria-label */
export function icon(name: IconName): string {
  return RENDERED[name];
}

/** All icons as a JSON object literal, safe inside a <script> element */
export const ICONS_JSON = JSON.stringify(RENDERED).replace(/</g, '\\u003c');

/**
 * The favicon: four rounded tiles, one of them in the accent colour, for a
 * small collection of tools. A data URI, so no request and no file to cache.
 */
export const FAVICON = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<rect x="3" y="3" width="12" height="12" rx="3" fill="#2d5f73"/>' +
  '<rect x="17" y="3" width="12" height="12" rx="3" fill="#1c1c1a"/>' +
  '<rect x="3" y="17" width="12" height="12" rx="3" fill="#1c1c1a"/>' +
  '<rect x="17" y="17" width="12" height="12" rx="3" fill="#1c1c1a"/>' +
  '</svg>'
);
