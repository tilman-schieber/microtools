# Microtools

A self-hosted collection of simple, link-based web utilities. No accounts, no tracking — just create something and share the link.

## Tools

- **Note Sharing** — Create and share plain text or Markdown notes
- **Date Poll** — Doodle-style scheduling with a time grid picker
- **Expense Share** — Split costs in a group with per-participant links and settlement calculation
- **One-Time Secret** — Client-side encrypted messages that self-destruct after one view
- **File Share** — Upload files and share them via link, with configurable expiration
- **Potluck Planner** — Coordinate who brings what, with real-time claim tracking

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
# Server starts on port 5000 by default
# Override with: PORT=3000 npm run dev
```

### Production build

```bash
npm run build        # Bundles to dist/index.mjs, vendors htmx + qrcode to public/
npm run start        # Runs the production bundle
```

## Vendored client-side dependencies

The build script copies [htmx](https://htmx.org/) and [qrcode-generator](https://github.com/nicokoenig/qrcode-generator) from `node_modules` into `public/` so they are served locally instead of from CDNs. These generated files are gitignored — run `npm run build` after cloning to produce them.

## Environment variables

| Variable   | Default | Description          |
|------------|---------|----------------------|
| `PORT`     | `5000`  | HTTP listen port     |
| `NODE_ENV` | —       | Set to `production` by the build script |

## Project structure

```
microtools/
├── server/
│   ├── index.ts          # All routes and application logic
│   ├── db.ts             # SQLite setup and schema
│   └── objectStore.ts    # Generic CRUD for JSON objects in SQLite
├── views/
│   ├── layout.ejs        # Shared HTML shell (used by creation forms)
│   ├── index.ejs         # Landing page
│   ├── 404.ejs           # Not-found page
│   ├── notes/            # Note templates (show, md, new)
│   ├── polls/            # Poll templates (show, new, _container partial)
│   ├── expenses/         # Expense templates (show, participant, new, _entries partial)
│   ├── secrets/          # Secret templates (show, gone, new)
│   ├── files/            # File share templates (show, gone, new)
│   └── bring/            # Potluck templates (show, new, _list partial)
├── public/
│   ├── style.css         # All styles (single file, no build step)
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
