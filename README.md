# Language Flashcards

A web app for learning vocabulary with flashcards and spaced repetition. Launch languages are English and Dutch, in both directions. Content is pre-made: users add packs or single concepts to their deck rather than writing cards.

Live at **flashcards.hendrikmelse.com** (invite-only).

## Stack

- **Language:** TypeScript on both ends, in an npm workspaces monorepo (Node 22+)
- **API:** Fastify, Drizzle ORM, zod, PostgreSQL
- **Web:** React, Vite, React Router, TanStack Query
- **Scheduling:** FSRS via `ts-fsrs`, behind a swappable `Scheduler` interface
- **Auth:** email and password, cookie sessions (scrypt hashes, session tokens stored hashed)
- **Tests:** Vitest. API tests run against in-memory PGlite, so they need no database

## Repository layout

```
apps/api/         Fastify API (src/auth, content, routes, srs, study, db)
apps/web/         React single-page app
packages/shared/  Types and schemas shared by both apps
deploy/           Production runbook (deploy/README.md) and server-side files
Dockerfile        One image: the API serves /api/* and the built web app
docker-compose.yml  Local Postgres for development
```

## Getting started

```sh
npm install
docker compose up -d db        # Postgres on localhost:5432
cp .env.example .env           # defaults match docker-compose.yml
npm run db:migrate             # create the schema
npm run db:seed                # load the small sample dataset
npm run dev                    # API on :3000 and the web app on Vite's dev port
```

The Vite dev server proxies `/api` to the API, so the browser sees one origin and session cookies work without CORS. The proxy keeps the browser's Host header because the API rejects state-changing requests whose Origin does not match it.

Registration is open in development. In production it is controlled by `REGISTRATION_MODE`.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API and web app together, with reload |
| `npm run dev:api` / `npm run dev:web` | Either one on its own |
| `npm test` | Tests in every workspace |
| `npm run typecheck` | Typecheck every workspace |
| `npm run build` | Build the web app, then bundle the API (esbuild) |
| `npm run db:generate` | Generate a migration after a schema change |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Load the sample data (development only) |

### Configuration

Set in `.env` (see `.env.example`):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `PORT` | API port (default 3000) |
| `REGISTRATION_MODE` | `open`, `allowlist` or `closed`. Production refuses to start unless this is set explicitly |
| `ALLOWED_EMAILS` | Comma-separated emails, used with `allowlist` |
| `NODE_ENV=production` | Enables HSTS and `Secure` cookies |
| `TRUST_PROXY=true` | Rate limits key on the real client IP. Only enable behind a trusted proxy (Caddy), never when the app is exposed directly |
| `WEB_DIST` | Directory of the built web app for the API to serve |
| `MIGRATIONS_DIR` | Directory of migrations, used by the production migrate step |

## How it works

### Data model

Each language's words point at a language-independent **concept** (a word sense), so any language pair is derived through the concept. Adding a language is data, not a schema change.

**Shared content**
- `Language`: code (`en`, `nl`) and name
- `Concept`: a word sense, with a curator-facing gloss such as "run (move fast on foot)"
- `Entry`: a concept's word in one language (lemma, part of speech, and a jsonb `details` for extras such as the Dutch article or plural). A concept can have several entries per language (synonyms)
- `Sentence` and `EntrySentence`: example sentences linked to entries
- `Pack` and `PackConcept`: an ordered list of concepts. Packs are language-agnostic; the user picks the direction when adding one

**Per-user state**
- `User`: email, password hash, timezone, daily new-card limit
- `UserCard`: one concept in one direction for one user, with its SRS state. The active deck is the set of a user's cards. Each direction is scheduled independently. Unique per (user, concept, from, to)
- `ReviewLog`: append-only, one row per answer, with rating, time taken, and state and interval before and after. A unique `client_review_id` per user makes retries safe. Keeping the full log means scheduling can be recomputed or re-tuned later

Translations are not one-to-one (English "run" has many senses; Dutch "kennen" and "weten" both translate "know"), which is why concepts are senses rather than words and packs need curation. A card is valid only if the concept has an entry in both languages; the add-to-deck endpoints enforce this.

### Scheduling

- FSRS with learning steps 1m/10m, relearning 10m, and 90% target retention
- The study day rolls over at 04:00 in the user's timezone, which drives the daily new-card limit
- The SRS engine is a set of pure functions (card state, rating and time in; new state and due date out), which keeps it easy to unit test
- All timestamps are stored in UTC; the user's timezone only matters at the day boundary

### API

All routes live under `/api`.

| Route | Purpose |
|---|---|
| `GET /health`, `GET /ready` | Liveness; readiness (checks the database) |
| `POST /auth/register`, `/auth/login`, `/auth/logout`; `GET /auth/me` | Auth, with rate limiting on login and register |
| `GET /languages` | Available languages |
| `GET /packs`, `GET /packs/:id` | Public browsing. With `fromLanguage` and `toLanguage` it adds availability and, when logged in, what is already in the deck |
| `POST /packs/:id/add`, `POST /concepts/:id/add` | Add to the deck for a direction. Idempotent; skips concepts missing an entry in either language |
| `GET /deck` | Progress summary and a page of cards, filterable by direction |
| `GET /study` | Read-only batch: learning cards due within 20 minutes, overdue reviews, then new cards up to the daily limit |
| `POST /reviews` | Transactional. Locks the card, runs FSRS, updates state and appends to the log. Idempotent via `clientReviewId` |

### Production hardening

Helmet headers (CSP, HSTS), an Origin check on state-changing requests, `Secure` cookies, hourly cleanup of expired sessions, and graceful shutdown on SIGTERM.

## Deployment

One Docker image: the API serves `/api/*` and the built web app (falling back to `index.html` for client routes), so everything is same-origin. Caddy terminates HTTPS and proxies to the container. Postgres runs as a separate container on an internal Docker network and is never exposed.

- **Host:** an IONOS VPS (Ubuntu 24.04, x86) running Docker Compose. One shared Caddy and one shared Postgres (a database and user per app) so more apps can be added cheaply
- **CI** (`.github/workflows/ci.yml`): typecheck, tests and build on every push; Docker build on every run; image pushed to GHCR from `main`; deploy over SSH. Markdown-only and `deploy/**`-only pushes skip builds and deploys. The workflow can be run by hand to redeploy
- **Deploys:** images are tagged by git SHA. `deploy.sh` migrates, restarts, health-checks and rolls back automatically. Only the current and previous image are kept
- **Security:** a non-root user, SSH keys only, firewall (only ports 22, 80 and 443), fail2ban, unattended upgrades. The CI deploy key is restricted to one validated command
- **Logs:** container logs go to the host journal (capped at 500 MB / 30 days), so they survive deploys
- **Backups:** nightly `pg_dump` at 03:00 Pacific via a systemd timer, 14 days kept, restore drill verified. Nothing alerts on a failed backup yet
- **Access:** invite-only through `REGISTRATION_MODE=allowlist` and `ALLOWED_EMAILS`
- **Production data:** a separate `seed-languages` command creates the languages without sample data

The full runbook, including server setup, rollback, backups and how to invite someone, is in [`deploy/README.md`](deploy/README.md).

## Status and roadmap

**Done:** backend (auth, content model, packs, deck, study queue, reviews), frontend (auth, dashboard, pack browser, study session with 1-4 keys and learning cards returning within the session), and production deployment with CI and nightly backups.

**Before anyone other than the owner uses it**
- Offsite database backups and a tested restore, plus an alert when a backup fails
- Email verification and password reset (needs an email provider)
- Replace the email allowlist with invite codes, so outsiders cannot probe which addresses are allowed
- Run the production CSP through a real browser pass

**Content (the product)**
- Decide on sourcing: open datasets (Wiktionary, Open Multilingual WordNet, Tatoeba), AI drafts with review, or hand-authored
- Write an import script and a pack curation workflow. Production currently has the languages but no packs

**Features still to build**
- `GET /stats` and a stats page (cards learned, reviews per day, retention, streak)
- My deck page (list and search cards)
- Settings (daily limits, account)
- Responsive polish, accessibility basics, optimistic updates on review submission
- Account deletion and export

**Hardening:** uptime monitoring and error tracking.

**Out of scope for v1, possible later:** user-created cards, audio and images, social features, native apps and offline mode, Anki/CSV import, more languages, FSRS parameter tuning from the review history.

## Notes

- SRS correctness is the heart of the app. Test it thoroughly and keep the review log.
- Content quality and quantity matter as much as the code.
- Privacy: hashed passwords, HTTPS only, and eventually account deletion and export.
