# Working in this repo

A Dutch/English flashcard app (monorepo: `apps/api`, `apps/web`, `packages/shared`, `content/`). The README describes the product and layout; `deploy/README.md` is the production runbook. This file holds what a new Claude session needs on top of that: how the owner likes to work, how to reach production, and conventions that are not obvious from the code.

The owner is Hendrik (GitHub `hendrikmelse`). The repo is public, so never commit the production server's address, credentials, or anything from `.env`.

## How to work with the owner

- **Edit in the owner's own checkout**, not a git worktree, so they can watch changes live in their editor and dev server. Branch off an up-to-date `main` (fetch and pull it first) and never push to or merge into `main`. A background/sub-agent job is the exception: the harness makes it use a worktree. Say so and give the worktree path.
- **Tests only at commit time.** After small edits do not run the test suite or typecheck; keep track of what changed (and which tests need updating) and say the checks were not run. When asked to commit, run typecheck (`npm run typecheck`) and the full suite (`npm test`), fix what they find (rerun a failing file a few times to tell a flake from a real failure), then commit. Still update or add tests alongside a change. A deliberate look in a browser for a layout change is fine.
- **Commit and push only when asked.** The owner usually says to make a branch and commit along the way, then asks for a PR. Opening a PR is outward-facing: do it when asked. **The owner merges PRs themselves** (the auto-mode classifier blocks `gh pr merge`). Everything after the merge is yours to do: watch CI (`gh run list --branch main`, `gh run watch <id>`), run the content import, reply to and close feedback.
- If CI fails after a merge, check whether it is a flake before changing anything; `gh run rerun --failed` is fine. A deploy only happens when the whole run passes. `current-image` on the server holds the deployed commit SHA.
- Commit messages end with the `Co-Authored-By` line and PR bodies with the "Generated with Claude Code" line that the session's system reminder gives.

## "Let's address some feedback"

When the owner says this (or similar), run this loop:

1. Read the open reports from the production database (see below).
2. Pick one.
3. Say what you would do and why.
4. Discuss until the owner agrees on an approach. Do not implement before that.
5. Implement it in the local checkout.
6. Reply to the report and close it (closing is a write to production: only after the implementation is done, and for content fixes only after the merge, deploy and import).
7. Repeat until no open reports remain.

Content fixes ship by merging, waiting for the deploy, then running the content import on production.

## Production access

Production is one server reached over SSH as `deploy@<prod-host>` (the owner has the host; it is in their gitignored `.claude/settings.local.json`). The compose project is in `/srv/flashcards` (`compose.yaml`, `current-image`).

- **Content import:** `ssh deploy@<prod-host> 'cd /srv/flashcards && export IMAGE="$(cat current-image)" && docker compose run --rm --no-deps api node apps/api/dist/import-content.js'`. It prints counts and warnings; expect 0 warnings.
- **Reports:** the same `docker compose run ... node apps/api/dist/reports.js` lists open reports; `reports.js reply <id> "text"` comments; `reports.js resolve <id>` closes. See `deploy/README.md`.
- **NEVER run `reports.js resolve <id> -m "text"` inline over ssh from PowerShell.** PowerShell 5.1 strips the embedded quotes, every word of the reply becomes a report-id prefix, and a word like `3` matches a real report: on 2026-10-22 this closed the wrong report. Use the Bash tool (single-quoted outer ssh string, double-quoted text, no apostrophes in the text), post the reply with `reply <id> "text"` first (it takes one id and joins the rest as text), then `resolve <id>` with the id alone. List reports before and after and check that exactly the intended ones changed.
- **SQL:** the database container is named `postgres` (not a compose service `db`), the database is `flashcards`. Pipe SQL over stdin: `ssh deploy@<prod-host> 'docker exec -i postgres sh -c "psql -U \$POSTGRES_USER -d flashcards"' < file.sql`. Write the SQL to a file first.
- The ssh permission rule in `.claude/settings.local.json` only matches a command that *starts* with `ssh deploy@<prod-host>`, so do not begin with `cat > file` or a heredoc, and do not rely on inline quoting. The classifier may also block read-only psql queries: ask before assuming DB queries over SSH are allowed. Remote writes (scp, ssh commands) need no extra asking once the rule exists.
- **The importer never deletes concepts.** Before deleting leftovers, count their `user_cards`, review logs and `pack_concepts`: deleting a concept cascades to cards and review logs. Reports about a deleted concept survive (`card_reports.concept_id` becomes null and the word stays in `title`).
- `gh` (GitHub CLI) should be signed in as `hendrikmelse`; use it for PRs and CI.

## Local development

- `docker-compose.yml` starts a Postgres, but on the owner's Windows machine a native Postgres also listens on 5432 and `localhost` (IPv6 `::1`) reaches that one: it holds their real dev data and shadows the container. `npm run db:*` and `content:import` hit whichever one `.env` points at, so check before running migrate, seed or import. For throwaway runs (screenshots, test accounts) start a scratch container on another port, e.g. `docker run -d --name flashcards-scratch-db -e POSTGRES_USER=flashcards -e POSTGRES_PASSWORD=flashcards -e POSTGRES_DB=flashcards -p 127.0.0.1:5434:5432 postgres:17`, set `DATABASE_URL` in the environment (it overrides `.env`) for migrate, seed, import and `npm run dev`, and remove the container afterwards. The owner does not mind what happens to their dev data.
- After merged work, the owner needs `git pull`, `npm run db:migrate` if a migration was added, and a restart of `npm run dev`. Without a Resend key, dev prints emails to the API console.
- API tests run against in-memory PGlite and need no database.
- Screenshots and layout checks: drive a browser with `puppeteer-core` or `playwright-core` installed in a scratchpad (system Chrome, mobile viewport); measure positions rather than eyeballing.

## Content: example sentences

Content lives in `content/concepts/*.json` (one entry per line, with `"sentences": [...]`). Each concept has an English and a Dutch side, each entry with example sentences shown on the card.

- **The card word is marked in the stored text** with single asterisks: `De kinderen spelen een *spel*.` There is no automatic highlighting any more (`packages/shared/src/sentence.ts` only parses the marks). `npm run content:check` errors on a sentence with no mark or a stray asterisk, and warns when the sentence lacks the lemma.
- Marking rules: a phrase is marked whole (`*How are you*?`); a separable Dutch verb marks both parts (`Ik *doe* mijn jas *aan*.`); a compound may mark just the part that is the lemma (`bloed*donor*`); for non-verbs the marked word must contain the lemma, so use the singular where the plural does not contain it; for English verbs mark the conjugated form (`*throws*`), not `to *throw*`.
- **Style:** about 6 to 10 words with one concrete detail (a place, reason or contrast) so the sentence shows the word's meaning; present tense except for words that are past by nature (yesterday, ago, toen); same number of sentences per entry as before; A2-B1 vocabulary around the target word; no repeated sentence frames.
- **The English and Dutch sentence of a card must be faithful translations of each other:** same scene, same details (adjectives, places, times, reasons, numbers), same tense, and the marked words must translate each other. The most common defect is a detail present on one side only ("de nachtdienst in het ziekenhuis" vs "the night shift"). Natural idiom is fine; a word-for-word copy is not required. When fixing one, change as little as possible and keep the better sentence.
- **Mass edits** worked well like this: generate batches of at most 120 concepts into a scratchpad folder; have sub-agents write their proposals to JSON files in the scratchpad (they must not edit the repo); validate them with a script (coverage, sentence counts, marks, entry lemma keys copied exactly including the "to " prefix, no past tense); apply them by rewriting only the `"sentences": [...]` array on each entry line; run `npm run content:check`; commit per ten batches. Check an agent's output for lazy passes (a "changed nothing" report on a hard batch, or a 20-second run), and do a second stricter pass over a mechanically flagged subset.
- Content changes need `content:import` on production after the deploy.

## Things still open (as of 2026-10-05; verify before relying on them)

- Password reset and email verification (Resend, from `noreply@mail.hendrikmelse.com`) are live; the README roadmap line says "built, not live until a real reset and verification have been tried end to end". Update it once the owner confirms the live test.
- On the roadmap after that: native Dutch review of the content (only spot-checked), error tracking, a screen reader (NVDA) run (deferred by the owner), invite codes instead of the allowlist, privacy policy and terms, end-to-end browser tests.
