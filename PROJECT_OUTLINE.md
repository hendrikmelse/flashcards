# Language Flashcards: Project Outline

A web app for learning vocabulary with flashcards and spaced repetition (SRS).

## 1. Goals & Scope

**Core capabilities**
- User accounts (sign up, log in, log out)
- Public, pre-made content (words with example sentences). Users do not author cards; they add premade packs or single concepts to their active deck
- Flashcard study sessions
- Backend scheduling that knows which words are known and which are due
- Full review history, enough to support proper spaced repetition

**Launch languages:** English and Dutch (both directions). The model is designed so further languages are added as data, not schema changes.

**Out of scope for v1 (possible later)**
- User-created custom cards (could be added later as user-owned content)
- Audio/pronunciation, images on cards
- Social features
- Mobile native apps, offline mode
- Anki/CSV import

## 2. Decisions

| Decision | Status | Notes |
|---|---|---|
| Language | **Decided**: TypeScript on both ends | |
| Backend framework | **Decided**: Fastify + Drizzle ORM + zod | npm workspaces monorepo with a shared types package |
| Database | **Decided**: PostgreSQL | PGlite (in-memory) used for tests |
| Auth | **Decided**: email + password, cookie sessions | scrypt hashing; session tokens stored hashed |
| Content model | **Decided**: concept hub (see section 4) | |
| Frontend | **Decided**: React + Vite + TypeScript, React Router, TanStack Query | Dev server proxies `/api` to the API so cookies are same-origin; production needs a reverse proxy doing the same |
| SRS algorithm | **Decided**: FSRS via `ts-fsrs`, behind a swappable `Scheduler` interface | Learning steps 1m/10m, relearning 10m, 90% target retention |
| Study day | **Decided**: rolls over at 04:00 in the user's timezone | Drives the daily new-card limit |
| Content sourcing | Open | Open datasets (Wiktionary, Open Multilingual WordNet, Tatoeba), AI drafts with review, or hand-authored; will need an import script |
| Hosting | **Decided**: an IONOS VPS (Ubuntu 24.04, x86) running Docker Compose behind Caddy; domain registered at Namecheap | One shared Caddy (HTTPS, routing per domain) and one shared Postgres container (a database and user per app) so more apps can be added cheaply. See section 9 |

## 3. Architecture Overview

- **Frontend**: SPA talking to the backend over a JSON REST API
- **Backend**: API server with auth, content browsing, deck management, study-session and scheduling logic
- **Database**: shared content (languages, concepts, entries, sentences, packs), plus per-user cards and an append-only review log
- **SRS engine**: isolated module with pure functions (input: card state + rating + time; output: new state + next due date), so it is easy to unit test

## 4. Data Model

### Shared content (public, identical for every user)

Hub model: each language's words point at a language-independent **concept** (a word sense). Any language pair is derived by following the concept, so adding a language never needs a new table or per-pair authoring.

- **Language**: code (`en`, `nl`), name
- **Concept**: id, gloss (curator-facing description of the sense, e.g. "run (move fast on foot)")
- **Entry**: id, concept_id, language, lemma, part_of_speech, details (jsonb for language-specific extras such as the Dutch article/plural or a Japanese reading). A concept can have several entries per language (synonyms)
- **Sentence**: id, language, text; **EntrySentence** links example sentences to entries
- **Pack**: id, slug, name, description; **PackConcept** is an ordered list of concepts. Packs are language-agnostic; the user picks the direction when adding one

### Per-user state

- **User**: id, email, password hash, timezone, daily new-card limit
- **UserCard**: one concept studied in one direction (`from_language` to `to_language`) by one user, plus its current SRS state (state, due_at, interval, stability/difficulty, learning step, repetitions, lapses). The user's "active deck" is the set of their UserCards. Each direction is scheduled independently. Unique per (user, concept, from, to)
- **ReviewLog** (append-only, one row per answer): user_card_id, user_id, client_review_id (unique per user, makes retries safe), reviewed_at, rating (again/hard/good/easy), time_taken_ms, and state/interval before and after plus the resulting due date
  - Keeping the full log lets us re-tune or switch algorithms later (e.g. FSRS parameter optimization)

### Notes
- Translations are not one-to-one (English "run" has many senses; Dutch "kennen" and "weten" both translate "know"), so concepts are senses, not words, and packs need curation.
- A card is valid only if the concept has an entry in both the from and to language. The add-to-deck endpoints must enforce this.

## 5. Backend

**Auth** (done)
- Register, login, logout, current user; cookie sessions
- scrypt password hashing, rate limiting on login/register
- Password reset via email (after v1)

**API endpoints (draft)**
- Done: `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `GET /health`
- Done: `GET /languages`
- Done: `GET /packs`, `GET /packs/:id`: public browsing; optional `fromLanguage`/`toLanguage` adds availability and (when logged in) what is already in the deck
- Done: `POST /packs/:id/add`, `POST /concepts/:id/add`: add to the user's deck for a direction; idempotent, skips concepts missing an entry in either language
- Done: `GET /deck`: progress summary plus a page of the user's cards, filterable by direction
- Done: `GET /study`: read-only batch of learning cards (due within 20 min), overdue reviews, then new cards up to the daily limit; entries and example sentences resolved for the direction
- Done: `POST /reviews`: transactional; locks the card, runs FSRS, updates state, appends to the log. Idempotent via a client-generated `clientReviewId`
- `GET /stats`: cards learned, reviews per day, retention, streak

**Content tooling**
- Seed script (done, tiny sample data)
- Import script for real datasets; some curation workflow for packs

**SRS logic**
- Determine due cards (`due_at <= now`) plus new cards up to the daily limit
- Apply the rating to update interval/ease/stability and compute the next `due_at`
- Handle learning steps for new cards and relearning after lapses
- Time zone handling for "day" boundaries

**Quality**
- Input validation, consistent error format
- DB migrations
- Unit tests for the SRS engine; integration tests for the API

## 6. Frontend

**Pages/views**
- Sign up / log in (done)
- Dashboard (done: due/new/deck counts): due count, new count, streak
- Browse packs, preview, add to deck, choose direction (done)
- My deck: list/search the user's cards and progress
- Study session: show front (with example sentence), reveal back, rate (Again/Hard/Good/Easy), show progress, end-of-session summary (done; learning cards return within the session, 1-4 keys rate)
- Stats page (charts of reviews and retention)
- Settings (daily limits, account)

**Cross-cutting**
- Keyboard shortcuts for study (space = flip, 1-4 = rate)
- Responsive layout (phone-friendly, since people study on the go)
- Loading/error states, optimistic updates on review submission
- Accessibility basics

## 7. Milestones

1. **Setup** (done): repo, tooling, TypeScript monorepo, local dev environment
2. **Backend foundation**: DB schema + migrations (done), auth (done), content model (done), packs/deck endpoints (done)
3. **SRS engine**: algorithm module + tests, review endpoint, study queue endpoint
4. **Content**: import script, first English/Dutch packs
5. **Frontend MVP**: auth screens, pack browsing, deck, working study session
6. **Polish**: dashboard, stats, settings, keyboard shortcuts, responsive design
7. **Deploy**: hosting, production DB, backups, env/secrets management, monitoring
8. **Later**: more languages, user-created cards, audio, reminders, FSRS tuning from review history

## 8. Risks & Notes

- SRS correctness is the heart of the app. Test it thoroughly and keep the review log so scheduling can be recomputed.
- Content is the product: quality and quantity of packs, sentences and sense-matching will matter as much as the code.
- Store timestamps in UTC; handle the user's timezone only at the "day" boundary.
- Plan for data privacy: hashed passwords, HTTPS only, account deletion/export.

## 9. Deployment

**Shape:** one Docker image. The API serves `/api/*` and the built web app (falling back to `index.html` for client-side routes), so everything is same-origin. Caddy terminates HTTPS and proxies to the container. Postgres runs as a separate container on an internal Docker network, never exposed publicly.

**Phase 1: production-ready app (done)**
- API mounted under `/api` in dev and prod (the dev proxy forwards unchanged and keeps the browser Host, so the Origin check passes)
- Serves the built web app with long-lived caching for hashed assets and `no-cache` for the shell
- `TRUST_PROXY=true` so rate limits key on the real client IP behind Caddy (never enable when the app is exposed directly)
- Helmet security headers (CSP, HSTS in production), Origin check on state-changing requests, `Secure` cookies in production
- Liveness (`/api/health`) separate from readiness (`/api/ready`, checks the database)
- Hourly cleanup of expired sessions; graceful shutdown on SIGTERM
- Production bundle (`npm run build`, esbuild) and a Dockerfile; migrations run as a separate step (`node apps/api/dist/migrate.js`)

**Phase 2: infrastructure (done; live and deployed by CI)**

Live at **flashcards.hendrikmelse.com**. The runbook is `deploy/README.md`; the server-side files are under `deploy/server/`.
- Server hardening (non-root user, SSH keys only, firewall, fail2ban, unattended upgrades): runbook commands
- Compose projects for Caddy, Postgres and the app; image tagged by git SHA for rollback; `deploy.sh` migrates, restarts, health-checks and rolls back automatically
- CI (`.github/workflows/ci.yml`): typecheck, tests and build on every push, Docker build on every run, image pushed to GHCR from `main`, deploy over SSH once `DEPLOY_ENABLED=true`
- Nightly `pg_dump` with 14-day retention (`backup.sh`) plus a documented restore drill
- Decisions: IONOS VPS (closest US location to US West), x86 plan (Hetzner and Contabo were ruled out: tiers unavailable and payment declined); invite-only (`REGISTRATION_MODE=allowlist` plus `ALLOWED_EMAILS`; production refuses to start without an explicit mode)
- The CI deploy key is restricted to one validated command (`ci-entrypoint.sh`); SSH is key-only for a non-root user; only ports 22, 80 and 443 are open
- Container logs go to the host journal (capped at 500 MB / 30 days), so they survive deploys; `deploy.sh` keeps only the current and previous image
- CI skips builds and deploys for Markdown-only and `deploy/**`-only pushes, and can be run by hand (Run workflow) to redeploy
- Nightly database dump at 03:00 Pacific via a systemd timer (14 days kept, restore drill verified on the server)
- Still to do: the before-launch items below
- Production has a separate `seed-languages` command (no sample data)

**Phase 3: hardening:** uptime monitoring, error tracking, log rotation.

**Before launch (anyone other than the owner using it):**
- Offsite database backups (nightly local dumps are already part of the runbook) and a tested restore
- Email verification and password reset (needs an email provider)
- Replace the email allowlist with invite codes, so outsiders cannot probe which addresses are allowed
- Decide whether to run the production CSP through a real browser pass
