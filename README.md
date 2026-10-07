# Language Flashcards

A web app for learning vocabulary with flashcards and spaced repetition. The launch languages are English and Dutch, in both directions. Content is pre-made: users add packs or single words to their deck rather than writing cards.

Live at **flashcards.hendrikmelse.com** (anyone can sign up).

## Features

- **Spaced repetition** with FSRS: each card is shown just before it would be forgotten, and each direction of a word is scheduled on its own. A study session mixes due reviews, cards still being learned, and a daily allowance of new cards.
- **A library of about 6,000 words in 90 packs:** the 5,000 most common Dutch words in bands of 500, plus topic, verb, and grammar packs. Users browse packs, search for single words in either language, and add them to their deck.
- **A deck viewer** with search, filters by direction and stage, and sorting, and a dashboard showing what is ready to study.
- **Accounts** with email and password, email verification, password reset, and open registration (which can be limited to an allowlist of emails or closed). Users can change their details, choose what the cards show, export everything held about them, and delete their account.
- **Reports and feedback:** users report problems with a word, send bug reports and feature suggestions, and request packs. Each is a conversation with the owner, who answers from an admin dashboard. See [Reports and admins](#reports-and-admins).
- **Accessible and responsive:** a phone layout, keyboard use throughout, a skip link, `lang` attributes on card text, and reduced-motion support.

## Stack

- **Language:** TypeScript on both ends, in an npm workspaces monorepo (Node 22+)
- **API:** Fastify, Drizzle ORM, zod, PostgreSQL
- **Web:** React, Vite, React Router, TanStack Query
- **Scheduling:** FSRS via `ts-fsrs`, behind a swappable `Scheduler` interface
- **Auth:** email and password, cookie sessions (scrypt hashes, session tokens stored hashed)
- **Email:** [Resend](https://resend.com)
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

Registration is open in development. In production it is controlled by `REGISTRATION_MODE`. To load the full word library into your development database, run `npm run content:import` after `db:seed`.

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
| `npm run user-role -w @flashcards/api -- <email> <user\|admin>` | Make an account an admin (or a user again) |
| `npm run reports -w @flashcards/api` | List open reports (`-- --all` includes resolved ones). `-- reply <id> "text"` replies to one, and `-- resolve <id> [-m "text"]` resolves it, optionally with a reply |

### Configuration

Set in `.env` (see `.env.example`):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `PORT` | API port (default 3000) |
| `REGISTRATION_MODE` | `open`, `allowlist`, or `closed`. Production refuses to start unless this is set explicitly |
| `ALLOWED_EMAILS` | Comma-separated emails, used with `allowlist` |
| `RESEND_API_KEY`, `MAIL_FROM`, `PUBLIC_URL` | Email (verification, password reset) goes out through Resend. `MAIL_FROM` is the sender (`Name <noreply@mail.example.com>`) and `PUBLIC_URL` is where the app is reached from outside (links in emails start with it). Production refuses to start without all three. In development, without them, each email is printed to the API's console and `PUBLIC_URL` defaults to Vite's address |
| `REPORT_NOTIFY_EMAIL` | Optional. Where to email each report and comment as it comes in (sent from `MAIL_FROM`, best effort). Without it, reports are only stored |
| `NODE_ENV=production` | Enables HSTS and `Secure` cookies |
| `TRUST_PROXY=true` | Rate limits key on the real client IP. Only enable behind a trusted proxy such as Caddy, never when the app is exposed directly |
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
- `Pack` and `PackConcept`: an ordered list of concepts. Packs are language-agnostic. The Add words pages show words English to Dutch and add them in both directions; the API can also add a single direction

**Per-user state**
- `User`: email (and when it was confirmed), password hash, account type (`user` or `admin`), time zone, daily new-card limit, and display settings
- `EmailToken`: a one-time link sent by email, for confirming an address, resetting a password, or confirming a new address. Only the hash of the token is stored. A reset link lasts an hour, the others three days, and a new email of one kind cancels the earlier one
- `UserCard`: one concept in one direction for one user, with its SRS state. The active deck is the set of a user's cards. Each direction is scheduled independently. Unique per (user, concept, from, to). The cards of a **language pair** (both directions, such as `en-nl`) are a deck of their own
- `ReviewLog`: append-only, one row per answer, with rating, time taken, and state and interval before and after. A unique `client_review_id` per user makes retries safe. Keeping the full log means scheduling can be recomputed or re-tuned later
- `Report` (table `card_reports`): what a user sent in, of a `kind`: a problem with a word (`card`, with the word, the direction it was shown in, and what was wrong), a `bug`, a `suggestion`, or a `pack_request` (these have a title and details instead). It is open until an admin resolves it, and it outlives its sender's account
- `ReportComment`: one message in a report's conversation, either from the sender (while it is open) or an admin's reply (`fromAdmin`)

Translations are not one-to-one (English "run" has many senses; Dutch "kennen" and "weten" both translate "know"), which is why concepts are senses rather than words and packs need curation. A card is valid only if the concept has an entry in both languages; the add-to-deck endpoints enforce this.

### Scheduling

- FSRS with learning steps of 1 and 10 minutes, a relearning step of 10 minutes, and a 90% target retention
- The study day rolls over at 04:00 in the user's time zone, which drives the daily new-card limit. The limit is worked out for each language pair, so studying one pair never uses up another. Only new cards whose first answer is Again or Hard count against it: one marked Good or Easy is already known, so it is free
- A card answered Again returns later in the same session, about halfway through what is left
- The SRS engine is a set of pure functions (card state, rating, and time in; new state and due date out), which keeps it easy to unit test
- All timestamps are stored in UTC; the user's time zone only matters at the day boundary

### Reports and admins

Users can send in four kinds of reports: a problem with a word (from the study screen or the card view), a bug, a feature suggestion, and a request for a pack (from a pack search that found nothing). The first three are sent from the Reports page, which the flag button in the header opens; it lists everything the user has sent, with its status and conversation, and can be filtered and sorted. A report is a conversation: while it is open its sender can add comments, and an admin replies. An admin can resolve a report once it has been replied to, and reopen it later. Each report and comment is emailed to `REPORT_NOTIFY_EMAIL` when that is set.

Every account is a user unless it is made an admin with `npm run user-role` (the app never changes an account's type itself). Admins get an Admin dashboard, from the shield button next to the flag: usage statistics (accounts, accounts that studied in the last 7 days, and reviews, all time and in the last 7 days) and the open reports by type, with a button to the Manage reports page, where everyone's reports can be read, answered, and resolved. To anyone else `/admin` is a 404, and the admin routes refuse them on the server. The same can be done from the command line with `reports.js` (see `deploy/README.md`).

### API

All routes live under `/api`. Routes that need a login say so; the rest are public.

| Route | Purpose |
|---|---|
| `GET /health`, `GET /ready` | Liveness; readiness (checks the database) |
| `POST /auth/register`, `/auth/login`, `/auth/logout`; `GET /auth/me` | Sign up, sign in, and out; the current user. Rate limited on register and login |
| `POST /auth/forgot-password`, `POST /auth/reset-password` | Password reset by email. The first always answers 204, whether or not the address has an account, and sends at most one email a minute for an address. The second takes the token from the link and a new password, works once, and signs the account out everywhere |
| `POST /auth/verify-email` | Opens a link from a verification email, or from the one sent to a new address (which is when the address changes). Needs no login |
| `GET /languages` | Available languages |
| `GET /packs`, `GET /packs/:id` | Pack browsing. With `fromLanguage` and `toLanguage` it lists only the packs that teach the `to` language or suit any language, gives each pack's name and description in the `from` language where it has them (the pack file's English text otherwise), and adds availability and, when logged in, what is already in the deck |
| `GET /concepts/search`, `GET /concepts/:id` | Word search in either language; one word as a card in a direction, with both sides' entries and all example sentences |
| `POST /packs/:id/add`, `POST /concepts/:id/add` | Login. Add to the deck for a direction, and with `bothDirections: true` for its opposite too (the web app always does). Idempotent; skips concepts missing an entry in either language |
| `GET /deck`, `GET /deck/:id` | Login. A progress summary and a page of cards for one language pair (`pair=en-nl`, either order; without it, every deck), filterable by direction, stage, and a search word, and sortable; one card in full |
| `GET /study`, `GET /study/counts` | Login. A batch of cards to study, and the counts of learning, review, and new cards (plus how many will be waiting by the end of tomorrow's study day). The batch ranks due cards by how likely each is to have been forgotten and spreads new cards, up to the daily limit, through the first half of the queue. A new word is not offered in both directions on one day while there is another new word to show. The response also says whether this is the user's first session (`firstSession`) and how many new cards wait behind the daily limit (`moreNew`): one answered Good or Easy on its first look does not use the limit, so it brings another into the session |
| `POST /reviews` | Login. Records an answer: locks the card, runs FSRS, updates its state, and appends to the log. A card in review comes due at the start of a study day, and the scheduler counts whole days between reviews; cards still learning keep real-time steps. Idempotent via `clientReviewId` |
| `GET /stats` | Login. When the next card is due, and the directions the deck has cards in |
| `GET /settings`, `PATCH /settings` | Login. The account's email, name, time zone, daily new-card limit, the language direction being learned, card display options, and whether the Add words explainer has been dismissed. All but the email can be changed. A new time zone moves due review cards to the start of the same day there |
| `POST /account/password`, `POST /account/email`, `POST /account/verification` | Login. Change the password (signs out every other session); ask for a new email address (a link is sent to it, and the address changes only when it is opened); send the verification email again. The first two need the current password |
| `POST /account/delete`, `GET /account/export` | Login. Delete the account with its cards, review history, and sessions (needs the password); download everything held about the user as JSON (never the password) |
| `POST /concepts/:id/report` | Login. Report a problem with a word (a wrong translation, forms, or sentence, or something else, with optional details) |
| `POST /reports` | Login. Send a bug report, a feature suggestion, or a pack request (a `kind` of `bug`, `suggestion`, or `pack_request`, a `title`, and a `note`; a pack request needs only the title) |
| `GET /reports`, `POST /reports/:id/comments` | Login. The user's own reports, newest first, each with its status and conversation; add a comment to one while it is open (409 once resolved) |
| `GET /admin/stats`, `GET /admin/reports` | Admin. The dashboard's numbers; everyone's reports, with who sent each and their account type |
| `POST /admin/reports/:id/comments`, `PATCH /admin/reports/:id` | Admin. Reply to a report; resolve it (409 until it has been replied to) or reopen it |

Rate limits are per client. Word search is limited to 120 a minute, and the language and pack lists and pack pages to 240. The routes that sign people up and in, change an account, or send a report or comment are limited to 10 a minute.

### Production hardening

Helmet headers (CSP, HSTS), an Origin check on state-changing requests, `Secure` cookies, hourly cleanup of expired sessions and email tokens, and graceful shutdown on SIGTERM.

## Content

Content is authored as reviewed JSON files and imported into the database. The files are the source of truth; the importer makes the database match them. There are three kinds:

- `content/concepts/*.json` is the word library: `{ "concepts": [ { "key", "gloss", "entries" } ] }`. How the library is split across files (currently by topic) is only for organizing
- `content/packs/*.json` defines packs: `{ "slug", "name", "category", "target"?, "description", "concepts": [key, ...] }`, an ordered list of concept keys with no word data. The `category` is one of `common` (the most frequent words), `topic`, `verbs`, or `grammar` (the small words that hold sentences together); the pack browser can filter by it. Because packs only refer to concepts, the same word can be in any number of packs
- `content/languages/<code>/*.json` (optional) adds one language's part of the content: `{ "language": "fr", "concepts": [ { "key", "entries": [ ... ] } ], "packs": [ { "slug", "name", "description"? } ] }`, with either or both lists. `concepts` are that language's entries for concepts defined in `content/concepts`, and `packs` are the names and descriptions of packs in that language. This is how a language beyond English and Dutch is added: it keeps that language's words, review notes, and licensing apart from the shared files, and covers only the concepts it has words for. The pack files are written in English, so a learner reading a language with no text for a pack sees the English one

A concept's **key** (lowercase words joined by hyphens, such as `dog` or `know-fact`) is its permanent identity. Packs refer to it, and the gloss is free text you can reword. Keys must be unique across all files, and a pack that lists an unknown key is an error. Keys and glosses are English only, so they stay meaningful when more languages are added. Where one English word has several senses or parts of speech, the key says which (`water-noun`, `water-verb`, `bank-river`, `bank-money`).

- Each concept has entries in `en` and `nl` (each with a lemma, part of speech, optional `details`, and example sentences). Nouns in both languages need a `details.plural`, or `uncountable: true`, and Dutch nouns also need `details.article` (`de` or `het`). Verbs carry their principal parts: English `past` and `participle`; Dutch `pastSingular`, `pastPlural`, `participle`, and `auxiliary` (`hebben`, `zijn`, or `hebben/zijn`). A verb whose present tense is irregular also has `present`, keyed by pronoun (`ik, jij, hij, wij` / `I, you, he, we`); `defective: true` exempts verbs that lack forms (English "can", "must"). The study card shows noun plurals and verb forms on the back only
- Example sentences are written as parallel English and Dutch pairs, because the study card shows sentences for the front and the back language
- `npm run content:check` validates every file without a database. Errors block the import; warnings (for example a sentence that does not contain its lemma, or a concept that is in no pack) are for a reviewer to look at
- `npm run content:import` imports into the database in `.env` (run `db:migrate` first, and `db:seed` for the languages). It is idempotent and runs in one transaction: a rerun updates in place, entries or sentences removed from a file are removed from the database, and each pack is rewritten to exactly the listed concepts. User cards are untouched
- The importer never deletes a concept or pack that the files stop mentioning, because user cards cascade-delete with their concept. It reports them instead, and cleanup is manual
- In production the image contains the files; import them with the command in the runbook's "Importing content" section

The library has about 6,000 concepts in 90 packs:

- **Frequency bands** (`top-1-500` through `top-4501-5000`): the 5,000 most common Dutch content words (nouns, verbs, adjectives, adverbs), 500 at a time, easiest first. Words that are not content words are in separate packs and left out of the bands: pronouns and determiners, prepositions, conjunctions and question words, pronominal adverbs, numbers, everyday adverbs, and particles and discourse words
- **Topic packs** (about 70, 40 to 130 words each): food and drink, Dutch culture, countries and languages, everyday phrases, family, home, town, travel, work, health, nature, animals, and so on. Large topics are split into levels (`-1`, `-2`, ...). A concept can be in a band and in a topic pack
- `starter` (the original 259 beginner words), plus `food-and-eating` and `common-verbs`

**Word selection and attribution.** Which words to include was chosen using the SUBTLEX-NL frequency list (Keuleers, Brysbaert & New, 2010, *Behavior Research Methods*; CC BY-NC-SA 4.0). It was used only to pick and order words. None of its data is in this repository.

**Review status.** All entries, translations, and sentences were written by Claude and checked by the validator. The words Claude was least sure of (about 50) were reviewed by a native Dutch speaker and corrected; the rest of the content has not been read through by one. Users can report a problem with any word from its card.

### Decks per language pair

Every request about the deck (`GET /deck`, `/study`, `/study/counts`, and `/stats`) takes an optional `pair`, such as `pair=en-nl`, which covers both directions of the pair. Without it a request covers every deck as one. Only `GET /deck` can also be narrowed to one direction, with `fromLanguage` and `toLanguage`: a session always studies a whole pair. The web app always sends the pair being learned, from `useActiveLanguages` (`apps/web/src/hooks/useActiveLanguages.tsx`). The direction is an account setting (`direction` in `GET`/`PATCH /settings`, and on the user in `/auth/me`, English to Dutch until chosen), so it is the same on every device. Every query about the deck includes the pair in its cache key, remembered filters are kept for each pair, and the page behind the top bar starts afresh when the direction changes. Nothing in the interface changes the direction yet.

### Adding a language

English and Dutch are not hardcoded in the app's logic; the places that name them are all in one of these:

1. **`packages/shared/src/languages.ts`** is the list of supported languages, the languages every word must have (`REQUIRED_LANGUAGES`), and the direction the Add words pages show (`ADD_WORDS_DIRECTION`). Add the code and name there. Input validation, the `seed-languages` command, and the Add words pages all follow it. Make a new language optional in the content (leave it out of `REQUIRED_LANGUAGES`), so the existing words stay valid.
2. **Run `seed-languages`** on each database (see the deploy runbook). It only inserts the languages that are missing.
3. **Flag (optional):** add it to `FLAGS` in `apps/web/src/components/LanguageFlag.tsx`. Without one, the language code is shown in a small box.
4. **Word forms (optional):** `LANGUAGE_FORMS` in `packages/shared/src/forms.ts` says which verb forms the language has and how they are shown on a card. Without an entry, only noun plurals are shown.
5. **Content checks (optional):** `LANGUAGE_RULES` in `apps/api/src/content/content-schema.ts` holds checks specific to a language (the Dutch article, which regular verb forms are not stored). Without an entry, only the checks that apply to every language run.
6. **Content:** add entries for the language in `content/languages/<code>/` (see Content above). A word becomes a card in a direction when both of its languages have an entry for it, so a new language grows by adding entries, not by changing anything else. Packs of topics work for any language as its entries arrive; give a pack a `target` only when it teaches one language (a frequency list, that language's grammar words), as the Dutch frequency bands, grammar packs, and Dutch culture pack do. A learner is shown a pack with no `target`, or one that teaches the language they are learning (the `to` of their direction). Pack names and descriptions are written in English in the pack files; add them in the languages learners read in the language files, for example the French name of the Dutch culture pack in `content/languages/fr/`.

What stays English on purpose: the app's own text, and `Intl` formatting of dates (`apps/web/src/lib/relativeTime.ts`), which follow the interface language, not the languages being learned.

## Deployment

One Docker image: the API serves `/api/*` and the built web app (falling back to `index.html` for client routes), so everything is same-origin. Caddy terminates HTTPS and proxies to the container. Postgres runs as a separate container on an internal Docker network and is never exposed.

**Integrations**
- **Hosting:** a VPS (Ubuntu 24.04) running Docker Compose, with one shared Caddy and one shared Postgres (a database and user per app)
- **CI and deploys:** GitHub Actions (`.github/workflows/ci.yml`) typechecks, tests, and builds on every push, builds the Docker image, pushes it to the GitHub Container Registry from `main`, and deploys over SSH. The deploy key is restricted to one validated command. Markdown-only and `deploy/**`-only pushes skip builds and deploys
- **Email:** Resend, for verification, password reset, and report notifications
- **Backups:** a nightly `pg_dump` (14 days kept on the server), copied encrypted to Backblaze B2 with `restic`, with a Healthchecks.io alert if a night is missed or fails
- **Uptime:** UptimeRobot checks `/api/ready` (the app and the database) and the home page every 5 minutes

**How it runs**
- **Deploys:** images are tagged by git SHA. `deploy.sh` migrates, restarts, waits until the app is healthy and can reach the database (`/api/ready`), and rolls back automatically if not. Only the current and previous image are kept
- **Server security:** a non-root user, SSH keys only, a firewall allowing only ports 22, 80, and 443, fail2ban, and unattended upgrades
- **Logs:** container logs go to the host's journal, which is capped and survives deploys
- **Access:** sign-up is open (`REGISTRATION_MODE=open`). It can be limited to the emails in `ALLOWED_EMAILS` (`allowlist`) or closed (`closed`)
- **Production data:** a separate `seed-languages` command creates the languages without the development sample data

The full runbook, including server setup, rollback, backups and restores, and who can register, is in [`deploy/README.md`](deploy/README.md).

## Roadmap

Before a wider launch:

- Native Dutch review of the whole library, not only the flagged words
- Protection against abuse of open sign-up, such as requiring a confirmed email address before the app can be used
- A privacy policy and terms
- Error tracking, and end-to-end browser tests (today everything is unit and API tests)
- A screen reader pass over the whole app

Later: a stats page (reviews per day, retention), optimistic updates on answers, removing cards from the deck, audio, and more languages and levels. Possibly: user-created cards, images, native apps and offline mode, Anki and CSV import, and FSRS parameter tuning from the review history.

## Principles

- SRS correctness is the heart of the app. Test it thoroughly and keep the review log.
- Content quality and quantity matter as much as the code.
- Privacy: passwords are hashed, traffic is HTTPS only, and users can export or delete their data from the settings.
