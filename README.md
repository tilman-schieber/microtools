# Microtools

A self-hosted collection of simple, link-based web utilities. No accounts, no tracking — just create something and share the link.

## Tools

- **Note Sharing** — Create and share plain text or Markdown notes
- **Date Poll** — Doodle-style scheduling with a time grid picker
- **Expense Share** — Split costs in a group with per-participant links and settlement calculation
- **One-Time Secret** — Client-side encrypted messages that self-destruct after one view
- **File Share** — Upload files and share them via link, with configurable expiration
- **Password Generator** — Local-only alphanumeric passwords and XKCD-style passphrases in English or German
- **Clock** — Parameter-based digital, Swiss railway analogue, and countdown clock displays; analogue mode adapts [Swiss-Railway-Clock](https://github.com/manuelmeister/Swiss-Railway-Clock) by Manuel Meister
- **Potluck Planner** — Coordinate who brings what, with real-time claim tracking
- **Micropage** — Build a complete styled page whose entire content lives in the URL; nothing is stored server-side

## Stack

- **Server:** [Fastify](https://fastify.dev/) with EJS templates
- **Database:** SQLite via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- **Frontend:** Server-rendered HTML, [HTMX](https://htmx.org/) for partial updates, vanilla JS
- **Build:** [esbuild](https://esbuild.github.io/) bundles the server into a single file
- **Client-side crypto:** Web Crypto API (AES-256-GCM) for the secrets tool — the server never sees plaintext or the encryption key

## Requirements

- Node.js 20+

## Getting started

```bash
git clone <repo-url> && cd microtools
npm install
```

### Development

```bash
npm run dev
# Server starts on port 3459 by default
# Override with: PORT=3000 npm run dev
```

### Production build

```bash
npm run build        # Bundles to dist/index.mjs, vendors htmx + qrcode to public/
npm run start        # Runs the production bundle
```

## Vendored client-side dependencies

The build script copies [htmx](https://htmx.org/), [qrcode-generator](https://github.com/nicokoenig/qrcode-generator), and the [IBM Plex Sans](https://github.com/IBM/plex) font files (via `@fontsource/ibm-plex-sans`) from `node_modules` into `public/` so they are served locally instead of from CDNs. These generated files are gitignored — run `npm run build` after cloning to produce them.

## Languages

The interface is available in English and German. The language belongs to the viewer, not to the link, because links get passed on: an explicit `?lang=de` (remembered in a `lang` cookie) wins, then the browser's `Accept-Language`, then English. The switcher in the header uses the same `?lang=` parameter. It is left off the one-time secret view, where a reload would destroy the secret.

Every user-facing string lives in `server/locales/`. Templates and server code call `t('key', params)`; parameters are HTML-escaped inside `t()`, so locale files may contain markup but user input never reaches the page unescaped. Keys under `js.` are sent to the browser as `window.T` for the client-side scripts.

Micropage is the exception: a rendered page is a pure function of its URL, so its language is part of the link (`lde`, default `len`) and sets the fixed words a template adds. Slot content is never translated.

### Adding a language

1. Copy `server/locales/de.ts` to `server/locales/<code>.ts` and translate the values. It is typed against `en.ts`, so `npm run check` fails on any missing or misspelled key.
2. Register it in `server/i18n.ts`: the `Lang` type, `LANGS`, `TABLES`, `LOCALES`, and `pluralRules`.
3. Keep established English terms where the language has no natural word of its own.

## Environment variables

| Variable   | Default | Description          |
|------------|---------|----------------------|
| `PORT`     | `3459`  | HTTP listen port     |
| `NODE_ENV` | —       | Set to `production` by the build script |

## Project structure

```
microtools/
├── server/
│   ├── index.ts          # All routes and application logic
│   ├── i18n.ts           # Language resolution, t(), date and money formatting
│   ├── locales/          # en.ts defines the keys, de.ts is typed against it
│   ├── db.ts             # SQLite setup and schema
│   └── objectStore.ts    # Generic CRUD for JSON objects in SQLite
├── views/
│   ├── _head.ejs         # Shared <head> contents (styles, htmx, QR rendering)
│   ├── _header.ejs       # Site header: wordmark plus a per-tool breadcrumb
│   ├── layout.ejs        # Shared HTML shell (used by creation forms)
│   ├── index.ejs         # Landing page
│   ├── 404.ejs           # Not-found page
│   ├── notes/            # Note templates (show, md, new)
│   ├── polls/            # Poll templates (show, new, _container partial)
│   ├── expenses/         # Expense templates (show, participant, new, _entries partial)
│   ├── secrets/          # Secret templates (show, gone, new)
│   ├── files/            # File share templates (show, gone, new)
│   ├── clock/            # Clock config + display templates
│   ├── passwords/        # Password generator template
│   ├── bring/            # Potluck templates (show, new, _list partial)
│   └── micropage/        # Micropage render, docs, builder, error
├── public/
│   ├── style.css         # All styles (single file, no build step)
│   ├── clock-config.js   # Client-side clock link generator
│   ├── clock-display.js  # Client-side clock renderer
│   ├── password-words.js  # Vendored local word lists for the password generator
│   ├── passwords.js      # Client-side password generator logic
│   ├── htmx.min.js       # Vendored from node_modules (gitignored)
│   └── qrcode.min.js     # Vendored from node_modules (gitignored)
├── script/
│   └── build.ts          # esbuild production bundler + vendor script copier
├── data/                 # Runtime data (gitignored)
│   ├── store.db          # SQLite database (auto-created)
│   └── files/            # Uploaded file storage
├── dist/                 # Build output (gitignored)
│   └── index.mjs         # Production bundle
├── package.json
└── tsconfig.json
```

## Architecture notes

**Single-table storage.** All tools share one `objects` table with columns `id`, `type`, `data` (JSON), `created_at`, and `expires_at`. The `objectStore` module provides typed CRUD operations. This keeps things simple — no migrations, no ORM.

**Templates.** Most view templates are standalone HTML documents (with their own `<head>`) rather than using the shared layout. This was a deliberate choice to avoid the limitations of EJS's include system with template literals. Creation form pages (`*/new.ejs`) still use `layout.ejs`.

**HTMX partials.** POST routes return HTML fragments that HTMX swaps into the page. Templates prefixed with `_` (like `_container.ejs`, `_entries.ejs`, `_list.ejs`) are partials rendered after mutations.

**Client-side encryption.** The secrets tool encrypts in the browser using AES-256-GCM. The key is placed in the URL fragment (`#...`), which browsers never send to the server. The server only stores ciphertext.

**File storage.** Uploaded files are stored on disk under `data/files/<share-id>/`. Metadata lives in SQLite. Expired shares are cleaned up both lazily (on access) and periodically (hourly timer).

**URL as storage.** The micropage tool has no database row at all — a page's template, theme and every word of its content are encoded in one `p` query parameter, so the URL *is* the document. Its parser reads `request.raw.url` and splits on `~` *before* percent-decoding, which is what makes `%7E` a literal tilde distinct from the delimiter and stops `+` silently becoming a space. Because it renders attacker-authorable markup on our own origin, `/micropage` sends a strict route-scoped CSP (`script-src 'none'`, `form-action 'none'`) and its query string is redacted from request logs.

**Markdown safety.** `marked` does not sanitize URLs and does not escape image alt text, so `server/safeMarkdown.ts` overrides the `link` and `image` renderers: schemes are allowlisted after entity-decoding, and attributes are escaped. A rejected renderer override must return escaped text rather than `false`, since `false` falls through to marked's own vulnerable renderer. Covered by `npm run test:safety`.

**QR codes.** Share links include an auto-generated QR code rendered client-side using [qrcode-generator](https://github.com/nicokoenig/qrcode-generator), vendored locally from npm. No server-side image generation.

## Deploying

The production build outputs a single `dist/index.mjs` that you can run with `node`. In production you'll want:

1. A reverse proxy (nginx, Caddy, etc.) for TLS termination
2. The `X-Forwarded-Proto` header set so generated URLs use `https://`
3. A process manager (systemd, pm2, etc.) to keep the server running
4. The `data/` directory persisted and backed up (it contains the database and uploaded files)

```bash
npm run build
PORT=3000 npm run start
```

## License

MIT
