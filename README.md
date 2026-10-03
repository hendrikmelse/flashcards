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
content/          Reviewed content (JSON), the source of truth: concepts/ (words) and packs/
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
| `npm run content:check` | Validate the files in `content/` (no database needed) |
| `npm run content:import` | Import the content files into the database |

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
- `Concept`: a word sense, with a permanent `key` (such as `dog`) that the content files and packs refer to, and a curator-facing gloss such as "run (move fast on foot)"
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
| `GET /packs`, `GET /packs/:id` | Public browsing; each pack lists its category. With `fromLanguage` and `toLanguage` it adds availability and, when logged in, what is already in the deck |
| `POST /packs/:id/add`, `POST /concepts/:id/add` | Add to the deck for a direction. Idempotent; skips concepts missing an entry in either language |
| `GET /deck` | Progress summary and a page of cards, filterable by direction, stage (new, learning, review) and a search word, sortable by date added, next due, status, interval, lapses or the prompt word. Each card says whether its reverse (same word, other direction) is in the deck, and `missingMirror=1` keeps only those without one |
| `POST /deck/mirrors` | Adds the reverse card for every card in a view of the deck (direction, stage and search, as in `GET /deck`) that has none. Idempotent |
| `GET /study` | Read-only batch. Due learning and review cards (learning ones within 20 minutes) ranked by how likely each is to have been forgotten, with new cards (up to the daily limit) spread through the first half of the queue. Learning cards are held back until 15 minutes after the last answer (the gap between sessions); `early=1` lets the next session start in the last 5 minutes of that wait |
| `GET /study/counts` | The counts of learning, review and new cards, for the dashboard, plus `nextSession` (when the held-back cards open and how many will be ready) while a session gap is running, and `tomorrow` (how many cards will be waiting by the end of tomorrow's study day) |
| `GET /settings`, `PATCH /settings` | The account's email, name, time zone and daily new-card limit; all but the email can be changed. A new time zone moves due review cards to the start of the same day there |
| `GET /stats` | Reviews today, when the next card is due, and a per-direction breakdown of the deck, including what is ready to study in each |
| `POST /reviews` | Transactional. A card in review comes due at the start of a study day (04:00 in the user's time zone) and the scheduler counts whole days between reviews; cards still learning keep real-time steps. Locks the card, runs FSRS, updates state and appends to the log. Idempotent via `clientReviewId` |

### Production hardening

Helmet headers (CSP, HSTS), an Origin check on state-changing requests, `Secure` cookies, hourly cleanup of expired sessions, and graceful shutdown on SIGTERM.

## Content

Content is authored as reviewed JSON files and imported into the database. The files are the source of truth; the importer makes the database match them. There are two kinds:

- `content/concepts/*.json` is the word library: `{ "concepts": [ { "key", "gloss", "entries" } ] }`. How the library is split across files (currently by topic) is only for organizing
- `content/packs/*.json` defines packs: `{ "slug", "name", "category", "description", "concepts": [key, ...] }`, an ordered list of concept keys with no word data. The `category` is one of `common` (the most frequent words), `topic`, `verbs` or `grammar` (the small words that hold sentences together); the pack browser can filter by it, and the tests require every category to have at least five packs. Because packs only refer to concepts, the same word can be in any number of packs

A concept's **key** (lowercase words joined by hyphens, such as `dog` or `know-fact`) is its permanent identity. Packs refer to it, and the gloss is free text you can reword. Keys must be unique across all files, and a pack that lists an unknown key is an error.

- Each concept has entries in `en` and `nl` (each with a lemma, part of speech, optional `details` and example sentences). Nouns in both languages need a `details.plural`, or `uncountable: true`, and Dutch nouns also need `details.article` (`de` or `het`). Verbs carry their principal parts: English `past` and `participle`; Dutch `pastSingular`, `pastPlural`, `participle` and `auxiliary` (`hebben`, `zijn` or `hebben/zijn`). A verb whose present tense is irregular also has `present`, keyed by pronoun (`ik, jij, hij, wij` / `I, you, he, we`); `defective: true` exempts verbs that lack forms (English "can", "must"). The study card shows noun plurals and verb forms on the back only
- Example sentences are written as parallel English and Dutch pairs, because the study card shows sentences for the front and the back language
- `npm run content:check` validates every file without a database. Errors block the import; warnings (for example a sentence that does not contain its lemma, or a concept that is in no pack) are for a reviewer to look at
- `npm run content:import` imports into the database in `.env` (run `db:migrate` first, and `db:seed` for the languages). It is idempotent and runs in one transaction: a rerun updates in place, entries or sentences removed from a file are removed from the database, and each pack is rewritten to exactly the listed concepts. User cards are untouched
- The importer never deletes a concept or pack that the files stop mentioning, because user cards cascade-delete with their concept. It reports them instead, and cleanup is manual
- In production the image contains the files; import them with the command in the runbook's "Importing content" section

The library has about 5,900 concepts in 88 packs:

- **Frequency bands** (`top-1-500` through `top-4501-5000`): the 5,000 most common Dutch content words (nouns, verbs, adjectives, adverbs), 500 at a time, easiest first. Words that are not content words are in separate packs and left out of the bands: pronouns and determiners, prepositions, conjunctions and question words, pronominal adverbs, numbers, everyday adverbs, particles and discourse words
- **Topic packs** (about 70, 40 to 130 words each): food and drink (basic and advanced), Dutch culture, countries and languages, everyday phrases, family, home, town, travel, work, health, nature, animals, and so on. Large topics are split into levels (`-1`, `-2`, ...). A concept can be in a band and in a topic pack
- `starter` (the original 259 beginner words), plus `food-and-eating` and `common-verbs`

Parts of speech are noun, verb, adjective, adverb, pronoun, preposition, conjunction, interjection, numeral, determiner, particle, phrase and proper noun (a name without a Dutch article, such as a country). Keys and glosses are English only, so they stay meaningful when more languages are added. Where one English word has several senses or parts of speech, the key says which in English (`water-noun`, `water-verb`, `bank-river`, `bank-money`); `content:check` and the tests reject keys that end in a Dutch word.

**Word selection and attribution.** Which words to include was chosen using the SUBTLEX-NL frequency list (Keuleers, Brysbaert & New, 2010, *Behavior Research Methods*; CC BY-NC-SA 4.0). It was used only to pick and order words. None of its data is in this repository.

**Review status.** All entries, translations and sentences were written by Claude and checked by the validator, not by a Dutch speaker. `content/review-notes.md` lists the items Claude was least sure of, for a native-speaker pass.

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

**Built:** auth with invite-only registration, a settings page (name, daily new cards, time zone), an optional name at sign-up shown in the top corner, the content model and importer (about 5,900 concepts in 88 packs, in four categories), the pack browser with pack and word search, the deck viewer (search, filters, sorting, adding reverse cards), the dashboard, study sessions (FSRS scheduling, queue ordered by chance of forgetting, a 15-minute gap between sessions, a pause before a missed card repeats), the explainer page, and production deployment with CI and nightly backups.

### Before anyone other than the owner uses it

1. ~~**Time zones.**~~ Done: new accounts take the browser's time zone, and the settings page changes it (review cards move to the start of the same day in the new zone). Accounts created earlier are still on UTC until their owner picks a zone in Settings; the page suggests the browser's.
2. **Push and deploy.** Production runs an old build. Pushing `main` deploys it, and the new migrations (`concept_key`, `pack_category`) must apply cleanly.
3. **Check the Docker image builds.** `content/` was added to the image after the last verified build; CI builds it on push, but it is untested.
4. **Import the content into production** (manual, see the runbook). Do any final key renames first: once users have cards, concept keys are permanent.
5. **Native Dutch review of the content.** Nothing has been checked by a Dutch speaker. Work through `content/review-notes.md` (about 50 items) and spot-check the frequency bands.
6. **Offsite database backups with a failure alert, and a tested restore.** The first unattended backup run is also unverified.
7. **A real browser pass on the live site** over HTTPS (registering, studying, the Content-Security-Policy, a phone).

### Should have for friends and family

- Password reset and email verification (needs an email provider)
- ~~Settings: daily new-card limit and time zone~~ (done); account deletion, data export and changing your password (still to do)
- A "report a problem with this card" button, since the content is unreviewed
- First-run guidance: suggest the starter pack, and explain directions and the answer buttons
- Rate limits on the public pack and search endpoints (only sign-in and sign-up are limited)
- Uptime monitoring and error tracking
- Mobile and accessibility pass (there are only two small-screen layout rules today)

### Before a wider launch

- Invite codes instead of the email allowlist, which reveals whether an address is on it
- Privacy policy and terms
- End-to-end browser tests (today everything is unit and API tests)
- Verify updating a running production deploy, and a production rollback (both only verified locally)

### After launch

A stats page (reviews per day, retention; `GET /stats` already serves the dashboard), optimistic updates on answers, removing cards from the deck, audio, and more languages or levels. Possibly later: user-created cards, images, social features, native apps and offline mode, Anki/CSV import, FSRS parameter tuning from the review history.

### Housekeeping

- The study rules changed a lot recently (the 15-minute gap, where a missed card returns, how new cards are spread, start-of-day due times). Use them for a while before others do, then tune the constants.
- Update this list as items are done.

## Notes

- SRS correctness is the heart of the app. Test it thoroughly and keep the review log.
- Content quality and quantity matter as much as the code.
- Privacy: hashed passwords, HTTPS only, and eventually account deletion and export.
