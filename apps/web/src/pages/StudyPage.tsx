import { useMutation } from "@tanstack/react-query";
import { useEffect, useReducer, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type {
  EntryView,
  LanguageInfo,
  Rating,
  ReviewResponse,
  StudyCardView,
  StudyResponse,
} from "@flashcards/shared";
import { formLines } from "@flashcards/shared";
import { api } from "../api/client";
import { useLanguages } from "../api/packs";
import { displayLemma } from "../components/entries";
import {
  initialState,
  nextReadyAt,
  phaseOf,
  reducer,
  remaining,
  type SessionStats,
} from "../study/session";

const BATCH_SIZE = 20;

const RATINGS: { rating: Rating; label: string }[] = [
  { rating: "again", label: "Again" },
  { rating: "hard", label: "Hard" },
  { rating: "good", label: "Good" },
  { rating: "easy", label: "Easy" },
];

type ReviewVars = { cardId: string; rating: Rating; clientReviewId: string; timeTakenMs: number };

function useStudySession() {
  const [state, dispatch] = useReducer(reducer, initialState);
  // ?from=en&to=nl studies one direction; without them every direction is mixed.
  const [params] = useSearchParams();
  const from = params.get("from");
  const to = params.get("to");
  const direction =
    from && to ? `&fromLanguage=${encodeURIComponent(from)}&toLanguage=${encodeURIComponent(to)}` : "";
  const fetching = useRef(false);
  const shownAt = useRef(Date.now());

  // Top up whenever the queue runs dry (this is also the initial load).
  useEffect(() => {
    if (state.queue.length > 0 || state.exhausted || state.fetchError || fetching.current) return;
    fetching.current = true;
    api<StudyResponse>(`/study?limit=${BATCH_SIZE}${direction}`)
      .then(
        (r) => dispatch({ type: "fetched", cards: r.cards }),
        () => dispatch({ type: "fetchFailed" }),
      )
      .finally(() => {
        fetching.current = false;
      });
  }, [state.queue.length, state.exhausted, state.fetchError, direction]);

  // Show the next card as soon as there is one.
  useEffect(() => {
    if (!state.current && (state.queue.length > 0 || state.waiting.length > 0)) {
      dispatch({ type: "pick", now: Date.now() });
    }
  }, [state.current, state.queue, state.waiting]);

  // When only waiting cards remain, wake up when the first is ready.
  useEffect(() => {
    const readyAt = nextReadyAt(state);
    if (state.current || state.queue.length > 0 || readyAt === null) return;
    const t = setTimeout(
      () => dispatch({ type: "pick", now: Date.now() }),
      Math.max(0, readyAt - Date.now()),
    );
    return () => clearTimeout(t);
  }, [state]);

  useEffect(() => {
    shownAt.current = Date.now();
  }, [state.current]);

  const submit = useMutation({
    mutationFn: (v: ReviewVars) =>
      api<ReviewResponse>("/reviews", {
        method: "POST",
        body: {
          userCardId: v.cardId,
          rating: v.rating,
          clientReviewId: v.clientReviewId,
          timeTakenMs: v.timeTakenMs,
        },
      }),
    onSuccess: (result, v) =>
      dispatch({ type: "answered", rating: v.rating, result, now: Date.now() }),
  });

  function rate(rating: Rating) {
    if (!state.current || !state.revealed || submit.isPending) return;
    submit.mutate({
      cardId: state.current.id,
      rating,
      clientReviewId: crypto.randomUUID(),
      timeTakenMs: Math.max(0, Date.now() - shownAt.current),
    });
  }

  return {
    state,
    phase: phaseOf(state),
    reveal: () => dispatch({ type: "reveal" }),
    rate,
    // Retrying reuses the same clientReviewId, so a request that actually got
    // through the first time is not applied twice.
    retrySubmit: () => submit.variables && submit.mutate(submit.variables),
    submitting: submit.isPending,
    submitError: submit.isError,
    continueNow: () => dispatch({ type: "pick", now: Infinity }),
    retryFetch: () => dispatch({ type: "retryFetch" }),
  };
}

export function StudyPage() {
  const session = useStudySession();
  const languages = useLanguages();
  const { state, phase } = session;

  return (
    <>
      <div className="study-header">
        <h1>Study</h1>
        {(phase === "card" || phase === "waiting") && (
          <p className="muted" aria-live="polite">
            {remaining(state)} left · <Link to="/">End session</Link>
          </p>
        )}
      </div>

      {phase === "loading" && <p className="status">Loading…</p>}

      {phase === "error" && (
        <div className="status error">
          <p>Could not load your cards.</p>
          <button className="secondary" onClick={session.retryFetch}>
            Try again
          </button>
        </div>
      )}

      {phase === "card" && state.current && (
        <CardView
          card={state.current}
          revealed={state.revealed}
          languages={languages.data ?? []}
          submitting={session.submitting}
          submitError={session.submitError}
          onReveal={session.reveal}
          onRate={session.rate}
          onRetry={session.retrySubmit}
        />
      )}

      {phase === "waiting" && (
        <div className="study-wait">
          <p>Nothing else is ready right now.</p>
          <p className="muted">
            Next card in <Countdown readyAt={nextReadyAt(state)!} />
          </p>
          <button className="secondary" onClick={session.continueNow}>
            Continue now
          </button>
        </div>
      )}

      {phase === "done" && <Summary stats={state.stats} />}
    </>
  );
}

function languageName(languages: LanguageInfo[], code: string) {
  return languages.find((l) => l.code === code)?.name ?? code.toUpperCase();
}

const STATE_LABEL: Record<StudyCardView["state"], string> = {
  new: "New",
  learning: "Learning",
  relearning: "Relearning",
  review: "Review",
};

function Entries({ entries }: { entries: EntryView[] }) {
  return (
    <p className="study-word">
      {entries.map((e, i) => (
        <span key={`${e.lemma}-${i}`}>
          {i > 0 && ", "}
          {displayLemma(e)}
          {e.partOfSpeech && <span className="pos"> {e.partOfSpeech}</span>}
        </span>
      ))}
    </p>
  );
}

// Word forms (noun plural; verb past, participle and irregular present) for the
// answer side. Shown only on the back of the card; entries without forms
// render nothing.
function Forms({ entries }: { entries: EntryView[] }) {
  const withForms = entries
    .map((e) => ({ e, lines: formLines(e.language, e.details) }))
    .filter(({ lines }) => lines.length > 0);
  if (withForms.length === 0) return null;
  return (
    <>
      {withForms.map(({ e, lines }) => (
        <dl key={e.lemma} className="forms" aria-label={`Forms of ${e.lemma}`}>
          {withForms.length > 1 && <dt className="forms-lemma">{e.lemma}</dt>}
          {lines.map((l) => (
            <div key={l.label}>
              <dt>{l.label}</dt>
              <dd>{l.value}</dd>
            </div>
          ))}
        </dl>
      ))}
    </>
  );
}

function Sentences({ items }: { items: string[] }) {
  return (
    <>
      {items.map((s) => (
        <p key={s} className="sentence">
          {s}
        </p>
      ))}
    </>
  );
}

type CardViewProps = {
  card: StudyCardView;
  revealed: boolean;
  languages: LanguageInfo[];
  submitting: boolean;
  submitError: boolean;
  onReveal: () => void;
  onRate: (r: Rating) => void;
  onRetry: () => void;
};

function CardView({
  card,
  revealed,
  languages,
  submitting,
  submitError,
  onReveal,
  onRate,
  onRetry,
}: CardViewProps) {
  const revealRef = useRef<HTMLButtonElement>(null);
  const goodRef = useRef<HTMLButtonElement>(null);

  // Keep keyboard flow natural: Space/Enter act on the focused button.
  useEffect(() => {
    (revealed ? goodRef : revealRef).current?.focus();
  }, [card.id, revealed]);

  // 1-4 rate the card once the answer is showing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      const n = Number(e.key);
      if (revealed && n >= 1 && n <= 4) onRate(RATINGS[n - 1]!.rating);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [revealed, onRate]);

  return (
    <article className="study-card">
      <p className="study-meta">
        {languageName(languages, card.fromLanguage)} → {languageName(languages, card.toLanguage)}
        <span className="badge state">{STATE_LABEL[card.state]}</span>
      </p>

      <section aria-label="Prompt">
        <Entries entries={card.front} />
        <Sentences items={card.sentences.front} />
      </section>

      {revealed ? (
        <section aria-label="Answer" className="study-answer">
          <Entries entries={card.back} />
          <Forms entries={card.back} />
          <Sentences items={card.sentences.back} />
        </section>
      ) : (
        <button ref={revealRef} className="primary reveal" onClick={onReveal}>
          Show answer
        </button>
      )}

      {revealed && (
        <div className="ratings" role="group" aria-label="How well did you know it?">
          {RATINGS.map(({ rating, label }, i) => (
            <button
              key={rating}
              ref={rating === "good" ? goodRef : undefined}
              className={`rating ${rating}`}
              onClick={() => onRate(rating)}
              disabled={submitting}
            >
              {label}
              <kbd aria-hidden="true">{i + 1}</kbd>
            </button>
          ))}
        </div>
      )}

      {submitError && (
        <p role="alert" className="form-error">
          Could not save your answer.{" "}
          <button className="link" onClick={onRetry}>
            Try again
          </button>
        </p>
      )}
    </article>
  );
}

function Countdown({ readyAt }: { readyAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.ceil((readyAt - now) / 1000));
  return (
    <span>
      {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
    </span>
  );
}

function Summary({ stats }: { stats: SessionStats }) {
  if (stats.reviewed === 0) {
    return (
      <div className="study-wait">
        <h2>You&rsquo;re all caught up</h2>
        <p className="muted">Nothing is due right now. Add more words to keep learning.</p>
        <p>
          <Link to="/packs">Browse packs</Link> · <Link to="/">Back to the dashboard</Link>
        </p>
      </div>
    );
  }
  const correct = Math.round(((stats.good + stats.easy) / stats.reviewed) * 100);
  return (
    <div className="study-wait">
      <h2>Session complete</h2>
      <p>
        You answered {stats.reviewed} card{stats.reviewed === 1 ? "" : "s"}, {correct}% rated Good
        or Easy.
      </p>
      <dl className="summary">
        {(["again", "hard", "good", "easy"] as const).map((r) => (
          <div key={r}>
            <dt>{r[0]!.toUpperCase() + r.slice(1)}</dt>
            <dd>{stats[r]}</dd>
          </div>
        ))}
      </dl>
      <p>
        <Link to="/">Back to the dashboard</Link>
      </p>
    </div>
  );
}
