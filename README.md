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
| `npm run user-role -w @flashcards/api -- <email> <user|admin>` | Make an account an admin (or a user again). Everyone is a user by default; admins get the Admin dashboard |
| `npm run reports -w @flashcards/api` | List the problems users reported with words (`-- --all` includes handled ones; `-- resolve <id> [-m "response"]` marks reports handled, with a response the reporter can read; `-- reply <id> "response"` responds without resolving) |

### Configuration

Set in `.env` (see `.env.example`):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `PORT` | API port (default 3000) |
| `REGISTRATION_MODE` | `open`, `allowlist`, or `closed`. Production refuses to start unless this is set explicitly |
| `ALLOWED_EMAILS` | Comma-separated emails, used with `allowlist` |
| `RESEND_API_KEY`, `MAIL_FROM`, `PUBLIC_URL` | Email (verification, password reset) goes out through [Resend](https://resend.com). `MAIL_FROM` is the sender (`Name <noreply@mail.example.com>`) and `PUBLIC_URL` is where the app is reached from outside (links in emails start with it). Production refuses to start without all three; in development, without them, each email is printed to the API's console and `PUBLIC_URL` defaults to Vite's address |
| `REPORT_NOTIFY_EMAIL` | Optional. Where to email each report, bug report, suggestion, pack request, and comment as it comes in (sent from `MAIL_FROM`, best effort). Without it, reports are only stored |
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
- `Pack` and `PackConcept`: an ordered list of concepts. Packs are language-agnostic. The Add words pages show words English to Dutch and add them in both directions; the API can also add a single direction

**Per-user state**
- `User`: email (and when it was confirmed), password hash, account type (`user` or `admin`), timezone, daily new-card limit
- `EmailToken`: a one-time link sent by email, for confirming an address, resetting a password, or confirming a new address. Only the hash of the token is stored; a reset link lasts an hour, the others three days, and a new email of one kind cancels the earlier one
- `UserCard`: one concept in one direction for one user, with its SRS state. The active deck is the set of a user's cards. Each direction is scheduled independently. Unique per (user, concept, from, to). The cards of a **language pair** (both directions, such as `en-nl`) are a deck of their own
- `Report` (table `card_reports`): what a user sent in, of a `kind`: a problem with a word (`card`, with the word, the direction it was shown in, and what was wrong), a `bug`, a `suggestion`, or a `pack_request` (these have a title and details instead). It is open until an admin resolves it, and it outlives its sender's account
- `ReportComment`: one message in a report's conversation, either from the sender (while it is open) or an admin's reply (`fromAdmin`)
- `ReviewLog`: append-only, one row per answer, with rating, time taken, and state and interval before and after. A unique `client_review_id` per user makes retries safe. Keeping the full log means scheduling can be recomputed or re-tuned later

Translations are not one-to-one (English "run" has many senses; Dutch "kennen" and "weten" both translate "know"), which is why concepts are senses rather than words and packs need curation. A card is valid only if the concept has an entry in both languages; the add-to-deck endpoints enforce this.

### Scheduling

- FSRS with learning steps 1m/10m, relearning 10m, and 90% target retention
- The study day rolls over at 04:00 in the user's timezone, which drives the daily new-card limit. The limit is worked out for each language pair, so studying one pair never uses up another. Only new cards whose first answer is Again or Hard count against it: one marked Good or Easy is already known, so it is free
- The SRS engine is a set of pure functions (card state, rating, and time in; new state and due date out), which keeps it easy to unit test
- All timestamps are stored in UTC; the user's timezone only matters at the day boundary

### Reports and admins

Users can send in four kinds of reports: a problem with a word (from the study screen or the card view), a bug, a feature suggestion, and a request for a pack (from a pack search that found nothing). The first three are sent from the Reports page, which the flag button in the header opens; it lists everything the user has sent, with its status and conversation, and can be filtered and sorted. A report is a conversation: while it is open its sender can add comments, and an admin replies. An admin can resolve a report once it has been replied to, and reopen it later. Each report and comment is emailed to `REPORT_NOTIFY_EMAIL` when that is set.

Every account is a user unless it is made an admin with `npm run user-role` (the app never changes an account's type itself). Admins get an Admin dashboard, from the shield button next to the flag: usage statistics (accounts, accounts that studied in the last 7 days, and reviews, all time and in the last 7 days) and the open reports by type, with a button to the Manage reports page, where everyone's reports can be read, answered, and resolved. To anyone else `/admin` is a 404, and the admin routes refuse them on the server. The same can be done from the command line with `reports.js` (see `deploy/README.md`).

### API

All routes live under `/api`.

| Route | Purpose |
|---|---|
| `GET /health`, `GET /ready` | Liveness; readiness (checks the database) |
| `POST /auth/register`, `/auth/login`, `/auth/logout`; `GET /auth/me` | Auth, with rate limiting on login and register |
| `GET /languages` | Available languages. This and the other public reads are rate limited per client: word search to 120 a minute, the language and pack lists and pack pages to 240 |
| `GET /packs`, `GET /packs/:id` | Public browsing; each pack lists its category and the language it teaches (`target`). With `fromLanguage` and `toLanguage` it lists only the packs that teach the `to` language or suit any language, gives each pack's name and description in the `from` language where it has them (the pack file's English text otherwise), and adds availability and, when logged in, what is already in the deck |
| `GET /deck/:id` | One of the user's cards in full: both sides' words and forms, and every example sentence |
| `POST /concepts/:id/report` | Report a problem with a word (wrong translation, forms, or sentence, or something else, with optional details). Stored for the owner to read with `npm run reports`, and emailed to `REPORT_NOTIFY_EMAIL` when that is set; rate limited like login |
| `POST /reports` | Send a bug report, a feature suggestion, or a pack request (a `kind` of `bug`, `suggestion`, or `pack_request`, a `title`, and a `note`). Stored and emailed like word problems; rate limited like login |
| `POST /reports/:id/comments` | Add a comment (`body`) to one of the user's own reports while it is open (409 once resolved). The owner is emailed about it |
| `GET /admin/stats` | Admins only: accounts, accounts that studied in the last 7 days, reviews (all time and last 7 days), and open reports in total and by type |
| `GET /admin/reports` | Admins only (403 for others): everyone's reports, bugs, and suggestions, newest first, each with who sent it and their account type |
| `POST /admin/reports/:id/comments` | Admins only: reply (`body`) to a report; the reply is a message in the conversation the sender sees |
| `PATCH /admin/reports/:id` | Admins only: `resolved` true resolves a report (409 until it has been replied to), false reopens it |
| `GET /reports` | The reports, bugs, and suggestions the signed-in user has sent, newest first, each with its status (`open` or `resolved`) and the conversation (the sender's comments and the owner's replies, oldest first) |
| `POST /packs/:id/add`, `POST /concepts/:id/add` | Add to the deck for a direction, and with `bothDirections: true` for its opposite too (the web app always does). Idempotent; skips concepts missing an entry in either language. Counts are in cards |
| `GET /concepts/:id` | Public. A word as a card in a direction (`fromLanguage`, `toLanguage`): both sides' entries and all example sentences. Used by the card view on the Add words pages |
| `GET /deck` | Progress summary and a page of cards, for one language pair (`pair=en-nl`, either order; without it, every deck), filterable by direction, stage (new, learning, review), and a search word, sortable by date added, next due, status, or the prompt word. |
| `GET /study` | Read-only batch. Due learning and review cards ranked by how likely each is to have been forgotten, with new cards (up to the daily limit) spread through the first half of the queue. A word is not offered both ways on one day while there is another new word to show: a session takes one direction of each new word before any second direction (so words added one at a time are not paired), and a new card whose reverse was first shown today goes to the back of the new cards. The response also says whether this is the user's very first session (`firstSession`) and how many new cards wait behind the daily limit (`moreNew`): a new card answered Good or Easy on its first look does not use the limit, so each one brings another into the session, and the "left" counter on the study page counts them. Nothing is held back between sessions: what is due, or nearly due, is offered as soon as it is asked for |
| `GET /study/counts` | The counts of learning, review, and new cards, for the dashboard, plus `tomorrow` (how many cards will be waiting by the end of tomorrow's study day) |
| `GET /settings`, `PATCH /settings` | The account's email, name, time zone, daily new-card limit, the language direction being learned, card display options (example sentences, word forms), and whether the Add words explainer has been dismissed (`addWordsIntroSeen`, shown once per account); all but the email can be changed. A new time zone moves due review cards to the start of the same day there |
| `POST /auth/forgot-password`, `POST /auth/reset-password` | Password reset by email. The first always answers 204, whether or not the address has an account, and sends nothing more often than once a minute for an address. The second takes the token from the link and a new password, works once, and signs the account out everywhere. Rate limited like login |
| `POST /auth/verify-email` | Opens a link from a verification email, or from the one sent to a new address (which is when the address changes). Needs no login. Rate limited like login |
| `POST /account/password`, `POST /account/email`, `POST /account/verification` | Change the password (signs out every other session); ask for a new email address (answers 202 and emails a link to the new address, and the address changes only when it is opened); send the verification email again. All need a login, the first two need the current password, and all are rate limited like login |
| `POST /account/delete` | Deletes the account with its cards, review history, and sessions. Needs the password |
| `GET /account/export` | Everything held about the user as a JSON download: account details (never the password), every card with its schedule, and the full review history |
| `GET /stats` | When the next card is due, and the directions the deck has cards in, with how many |
| `POST /reviews` | Transactional. A card in review comes due at the start of a study day (04:00 in the user's time zone) and the scheduler counts whole days between reviews; cards still learning keep real-time steps. Locks the card, runs FSRS, updates state, and appends to the log. Idempotent via `clientReviewId` |

### Production hardening

Helmet headers (CSP, HSTS), an Origin check on state-changing requests, `Secure` cookies, hourly cleanup of expired sessions, and graceful shutdown on SIGTERM.

## Content

Content is authored as reviewed JSON files and imported into the database. The files are the source of truth; the importer makes the database match them. There are three kinds:

- `content/concepts/*.json` is the word library: `{ "concepts": [ { "key", "gloss", "entries" } ] }`. How the library is split across files (currently by topic) is only for organizing
- `content/languages/<code>/*.json` (optional) adds one language's part of the content: `{ "language": "fr", "concepts": [ { "key", "entries": [ ... ] } ], "packs": [ { "slug", "name", "description"? } ] }`, with either or both lists. `concepts` are that language's entries for concepts defined in `content/concepts`, in the same shape as in a concept file; `packs` are the names and descriptions of packs in that language, for people who read it. `language` must match the folder. This is how a language beyond English and Dutch is added: it keeps that language's words, review notes, and licensing apart from the shared files, and covers only the concepts it has words for. Each concept and language is defined in exactly one place, so a language file cannot repeat what the concept files already hold, and it can only refer to keys that exist. The importer merges the entries into the concepts, so removing an entry from a language file removes it from the database like any other. Pack texts are rewritten the same way on each import. The pack files are written in English (`PACK_TEXT_LANGUAGE`), so a language file cannot have English texts, and a learner reading a language with no text for a pack sees the English one
- `content/packs/*.json` defines packs: `{ "slug", "name", "category", "target"?, "description", "concepts": [key, ...] }`, an ordered list of concept keys with no word data. The `category` is one of `common` (the most frequent words), `topic`, `verbs`, or `grammar` (the small words that hold sentences together); the pack browser can filter by it, and the tests require every category to have at least five packs. Because packs only refer to concepts, the same word can be in any number of packs

A concept's **key** (lowercase words joined by hyphens, such as `dog` or `know-fact`) is its permanent identity. Packs refer to it, and the gloss is free text you can reword. Keys must be unique across all files, and a pack that lists an unknown key is an error.

- Each concept has entries in `en` and `nl` (each with a lemma, part of speech, optional `details`, and example sentences). Nouns in both languages need a `details.plural`, or `uncountable: true`, and Dutch nouns also need `details.article` (`de` or `het`). Verbs carry their principal parts: English `past` and `participle`; Dutch `pastSingular`, `pastPlural`, `participle`, and `auxiliary` (`hebben`, `zijn`, or `hebben/zijn`). A verb whose present tense is irregular also has `present`, keyed by pronoun (`ik, jij, hij, wij` / `I, you, he, we`); `defective: true` exempts verbs that lack forms (English "can", "must"). The study card shows noun plurals and verb forms on the back only
- Example sentences are written as parallel English and Dutch pairs, because the study card shows sentences for the front and the back language
- `npm run content:check` validates every file without a database. Errors block the import; warnings (for example a sentence that does not contain its lemma, or a concept that is in no pack) are for a reviewer to look at
- `npm run content:import` imports into the database in `.env` (run `db:migrate` first, and `db:seed` for the languages). It is idempotent and runs in one transaction: a rerun updates in place, entries or sentences removed from a file are removed from the database, and each pack is rewritten to exactly the listed concepts. User cards are untouched
- The importer never deletes a concept or pack that the files stop mentioning, because user cards cascade-delete with their concept. It reports them instead, and cleanup is manual
- In production the image contains the files; import them with the command in the runbook's "Importing content" section

The library has about 6,000 concepts in 89 packs:

- **Frequency bands** (`top-1-500` through `top-4501-5000`): the 5,000 most common Dutch content words (nouns, verbs, adjectives, adverbs), 500 at a time, easiest first. Words that are not content words are in separate packs and left out of the bands: pronouns and determiners, prepositions, conjunctions and question words, pronominal adverbs, numbers, everyday adverbs, and particles and discourse words
- **Topic packs** (about 70, 40 to 130 words each): food and drink (basic and advanced), Dutch culture, countries and languages, everyday phrases, family, home, town, travel, work, health, nature, animals, and so on. Large topics are split into levels (`-1`, `-2`, ...). A concept can be in a band and in a topic pack
- `starter` (the original 259 beginner words), plus `food-and-eating` and `common-verbs`

Parts of speech are noun, verb, adjective, adverb, pronoun, preposition, conjunction, interjection, numeral, determiner, particle, phrase, and proper noun (a name without a Dutch article, such as a country). Keys and glosses are English only, so they stay meaningful when more languages are added. Where one English word has several senses or parts of speech, the key says which in English (`water-noun`, `water-verb`, `bank-river`, `bank-money`); `content:check` and the tests reject keys that end in a Dutch word.

**Word selection and attribution.** Which words to include was chosen using the SUBTLEX-NL frequency list (Keuleers, Brysbaert & New, 2010, *Behavior Research Methods*; CC BY-NC-SA 4.0). It was used only to pick and order words. None of its data is in this repository.

**Review status.** All entries, translations and sentences were written by Claude and checked by the validator. The words Claude was least sure of (about 50) were reviewed by a native Dutch speaker and corrected; the rest of the content has not been read through by one.

### Decks per language pair

Every request about the deck (`GET /deck`, `/study`, `/study/counts`, and `/stats`) takes an optional `pair`, such as `pair=en-nl`, which covers both directions of the pair. Without it a request covers every deck as one. Only `GET /deck` can also be narrowed to one direction, with `fromLanguage` and `toLanguage`: a session always studies a whole pair. The web app always sends the pair being learned, from `useActiveLanguages` (`apps/web/src/hooks/useActiveLanguages.tsx`), which is also where a language switcher would change it: the direction is an account setting (`direction` in `GET`/`PATCH /settings`, and on the user in `/auth/me`, English to Dutch until chosen), so it is the same on every device and arrives with the signed-in user, every query about the deck includes the pair in its cache key, remembered filters are kept for each pair, and the page behind the top bar starts afresh when the direction changes. Nothing changes the direction yet.

### Adding a language

English and Dutch are not hardcoded in the app's logic; the places that name them are all in one of these:

1. **`packages/shared/src/languages.ts`** is the list of supported languages, the languages every word must have (`REQUIRED_LANGUAGES`), and the direction the Add words pages show (`ADD_WORDS_DIRECTION`). Add the code and name there. Input validation, the `seed-languages` command, and the Add words pages all follow it. Make a new language optional in the content (leave it out of `REQUIRED_LANGUAGES`), so the existing words stay valid.
2. **Run `seed-languages`** on each database (see the deploy runbook). It only inserts the languages that are missing.
3. **Flag (optional):** add it to `FLAGS` in `apps/web/src/components/LanguageFlag.tsx`. Without one, the language code is shown in a small box.
4. **Word forms (optional):** `LANGUAGE_FORMS` in `packages/shared/src/forms.ts` says which verb forms the language has and how they are shown on a card. Without an entry, only noun plurals are shown.
5. **Content checks (optional):** `LANGUAGE_RULES` in `apps/api/src/content/content-schema.ts` holds checks specific to a language (the Dutch article, which regular verb forms are not stored). Without an entry, only the checks that apply to every language run.
6. **Content:** add entries for the language in `content/languages/<code>/` (see Content above). A word becomes a card in a direction when both of its languages have an entry for it, so a new language grows by adding entries, not by changing anything else. Packs of topics work for any language as its entries arrive; give a pack a `target` only when it teaches one language (a frequency list, that language's grammar words), as the Dutch frequency bands, grammar packs, and Dutch culture pack do. A learner is shown a pack with no `target`, or one that teaches the language they are learning (the `to` of their direction). Pack names and descriptions are written in English in the pack files; add them in the languages learners read in the language files, for example the French name of the Dutch culture pack in `content/languages/fr/`. Anyone reading a language that has no text for a pack sees the English one.

What stays English on purpose: the app's own text, and `Intl` formatting of dates (`apps/web/src/lib/relativeTime.ts`), which follow the interface language, not the languages being learned. The dev-only sample data in `apps/api/src/db/seed.ts` and the content files are English and Dutch because that is the content.

## Deployment

One Docker image: the API serves `/api/*` and the built web app (falling back to `index.html` for client routes), so everything is same-origin. Caddy terminates HTTPS and proxies to the container. Postgres runs as a separate container on an internal Docker network and is never exposed.

- **Host:** an IONOS VPS (Ubuntu 24.04, x86) running Docker Compose. One shared Caddy and one shared Postgres (a database and user per app) so more apps can be added cheaply
- **CI** (`.github/workflows/ci.yml`): typecheck, tests, and build on every push; Docker build on every run; image pushed to GHCR from `main`; deploy over SSH. Markdown-only and `deploy/**`-only pushes skip builds and deploys. The workflow can be run by hand to redeploy
- **Deploys:** images are tagged by git SHA. `deploy.sh` migrates, restarts, waits until the app is healthy and can reach the database (`/api/ready`), and rolls back automatically if not. Only the current and previous image are kept
- **Security:** a non-root user, SSH keys only, firewall (only ports 22, 80, and 443), fail2ban, unattended upgrades. The CI deploy key is restricted to one validated command
- **Logs:** container logs go to the host journal (capped at 500 MB / 30 days), so they survive deploys
- **Backups:** nightly `pg_dump` at 03:00 Pacific via a systemd timer, 14 days kept locally, then copied encrypted to Backblaze B2 with `restic` (7 daily, 4 weekly, 6 monthly), a Healthchecks.io alert if a night is missed or fails, restore drill verified from the offsite copy
- **Uptime:** UptimeRobot checks `/api/ready` (app and database) and the home page every 5 minutes and emails on failure (tested with a deliberately bad release); see the runbook's section 8
- **Access:** invite-only through `REGISTRATION_MODE=allowlist` and `ALLOWED_EMAILS`
- **Production data:** a separate `seed-languages` command creates the languages without sample data

The full runbook, including server setup, rollback, backups, and how to invite someone, is in [`deploy/README.md`](deploy/README.md).

## Status and roadmap

**Built:** auth with invite-only registration, a tabbed settings page (profile and email, study options, theme, password, data export, and account deletion), an optional name at sign-up shown in the top corner, the content model and importer (about 6,000 concepts in 89 packs, in four categories), the pack browser with pack and word search, the deck viewer (search, filters, sorting, adding words in both directions), the dashboard, study sessions (FSRS scheduling, queue ordered by chance of forgetting, a pause before a missed card repeats), the explainer page, reports and feedback (bugs, suggestions, and pack requests) with an admin dashboard, and production deployment with CI and nightly backups.

### Before anyone other than the owner uses it

1. ~~**Time zones.**~~ Done: new accounts take the browser's time zone, and the settings page changes it (review cards move to the start of the same day in the new zone). Production has no accounts yet, so there is nothing to migrate.
2. ~~**Push and deploy.**~~ Done 2026-10-04: production runs the current build, migrations included.
3. ~~**Check the Docker image builds.**~~ Done: CI builds the image and production has been running it since 2026-10-04.
4. ~~**Import the content into production**~~ Done 2026-10-04, along with removing the retired concepts.
5. **Native Dutch review of the content.** The words flagged as uncertain were reviewed and fixed, and a native speaker looked through a few packs online (2026-10-04) and found no issues. That is a spot check, not a full read-through; more can be done before a wider launch.
6. ~~**A real browser pass on the live site**~~ Done 2026-10-04 over HTTPS: no console errors, and zoom and keyboard-only use worked.

### Should have for friends and family

- ~~Password reset and email verification~~ (built: email goes out through Resend; a new account gets a confirmation link and a reminder under the top bar until it is opened, "Forgot your password?" is on the login page, and a new email address only takes effect when the link sent to it is opened). **Not live until** the Resend key and the sending domain are set up on the server and a real reset and verification have been tried end to end (runbook, "Email"). Confirming the address does not block anything yet
- ~~Settings: name, email, password, daily new-card limit, time zone, theme, data export, and account deletion~~ (done). The theme is kept per device, not per account; everything else, including what the study cards show, follows the account
- ~~A "report a problem with this card" button, since the content is unreviewed~~ (done: in the study screen and the card view; each report is emailed to `REPORT_NOTIFY_EMAIL` when it is set, and is answered in the admin dashboard or with `npm run reports`; see `deploy/README.md`)
- ~~First-run guidance~~ (done: an empty dashboard points to the starter words and explains adding words and the answer buttons; the very first study session opens with a short explanation of how the cards and answer buttons work). Every page header (dashboard, My deck, Add words) has a "Start studying" button with the number of cards ready (disabled, saying "No cards ready to study", when there are none), above its navigation buttons, and the main navigation has a Study tab
- ~~Rate limits on the public pack and search endpoints~~ (done: per client, 120 searches and 240 pack or language reads a minute). Signed-in endpoints (deck, study) are not limited
- ~~Uptime monitoring~~ (done: UptimeRobot, see the runbook). Error tracking is still to do
- ~~Mobile and accessibility pass~~ (mostly done: the phone layout; card words, forms, and sentences carry `lang` and `dir` through `langAttrs` in `components/entries.ts` (a new language needs no change there); a title per page, a skip link and focus moved to the content after each navigation; the answer read when it appears; number-key rating shortcuts that can be turned off in the settings (per device); form errors tied to their fields; axe checks on every page in `Accessibility.test.tsx`. Zoom, keyboard-only use, colour contrast, and touch target sizes were checked by hand in a browser. Still to do by hand, later: a screen reader run (NVDA))

### Before a wider launch

- Invite codes instead of the email allowlist, which reveals whether an address is on it
- Privacy policy and terms
- End-to-end browser tests (today everything is unit and API tests)

### After launch

A stats page (reviews per day, retention; `GET /stats` already serves the dashboard), optimistic updates on answers, removing cards from the deck, audio, and more languages or levels. Possibly later: user-created cards, images, social features, native apps and offline mode, Anki/CSV import, FSRS parameter tuning from the review history.

### Housekeeping

- The study rules changed a lot recently (where a missed card returns, how new cards are spread, start-of-day due times). Use them for a while before others do, then tune the constants.
- Update this list as items are done.

## Notes

- SRS correctness is the heart of the app. Test it thoroughly and keep the review log.
- Content quality and quantity matter as much as the code.
- Privacy: hashed passwords, HTTPS only, and eventually account deletion and export.
