import { useMutation } from "@tanstack/react-query";
import { useEffect, useReducer, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import type {
  LanguageInfo,
  Rating,
  ReviewResponse,
  StudyCardView,
  StudyResponse,
} from "@flashcards/shared";
import { SESSION_GAP_MS } from "@flashcards/shared";
import { api } from "../api/client";
import { useSettings } from "../api/hooks";
import { useActiveLanguages } from "../hooks/useActiveLanguages";
import { useLanguages } from "../api/packs";
import { Entries, Forms, Sentences } from "../components/CardParts";
import { FirstSessionIntro } from "../components/FirstSessionIntro";
import { languageName } from "../components/entries";
import { ReportProblem } from "../components/ReportProblem";
import {
  initialState,
  phaseOf,
  reducer,
  remaining,
  reReviewCount,
  type SessionStats,
} from "../study/session";

// The server orders the whole queue; a big batch lets "Again" cards slot back in
// among enough other cards, and the new ones spread through it as intended.
const BATCH_SIZE = 100;

const RATINGS: { rating: Rating; label: string }[] = [
  { rating: "again", label: "Again" },
  { rating: "hard", label: "Hard" },
  { rating: "good", label: "Good" },
  { rating: "easy", label: "Easy" },
];

type ReviewVars = { cardId: string; rating: Rating; clientReviewId: string; timeTakenMs: number };

function useStudySession() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { pair } = useActiveLanguages();
  const [params] = useSearchParams();
  // ?early=1 starts the next session a little before the gap between sessions is over.
  const early = params.get("early") === "1" ? "&early=1" : "";
  const fetching = useRef(false);
  const shownAt = useRef(Date.now());
  // The explanation shown before the very first card of someone's very first session. It is looked
  // for in the first batch only; a later top-up cannot be the first session, as cards were answered.
  const [intro, setIntro] = useState(false);
  const introChecked = useRef(false);

  // Top up whenever the queue runs dry (this is also the initial load).
  useEffect(() => {
    if (state.ended || state.queue.length > 0 || state.exhausted || state.fetchError || fetching.current) return;
    fetching.current = true;
    api<StudyResponse>(`/study?limit=${BATCH_SIZE}&pair=${pair}${early}`)
      .then(
        (r) => {
          if (!introChecked.current) {
            introChecked.current = true;
            if (r.firstSession && r.cards.length > 0) setIntro(true);
          }
          dispatch({ type: "fetched", cards: r.cards, moreNew: r.moreNew });
        },
        () => dispatch({ type: "fetchFailed" }),
      )
      .finally(() => {
        fetching.current = false;
      });
  }, [state.ended, state.queue.length, state.exhausted, state.fetchError, pair, early]);

  // Show the next card as soon as there is one.
  useEffect(() => {
    if (!state.ended && !state.current && state.queue.length > 0) dispatch({ type: "pick" });
  }, [state.ended, state.current, state.queue]);

  // The clock for "time taken" starts when the card is actually in front of the user.
  useEffect(() => {
    shownAt.current = Date.now();
  }, [state.current, state.repeatNotice]);

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
      dispatch({ type: "answered", rating: v.rating, result, random: Math.random() }),
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
    intro,
    startStudying: () => {
      setIntro(false);
      shownAt.current = Date.now(); // the time taken starts now, not while the explanation was read
    },
    acknowledgeRepeat: () => dispatch({ type: "acknowledgeRepeat" }),
    end: () => dispatch({ type: "end" }),
    retryFetch: () => dispatch({ type: "retryFetch" }),
  };
}

export function StudyPage() {
  const session = useStudySession();
  const languages = useLanguages();
  // What the cards show is an account setting. Wait for it so a card never shows something and
  // then hides it; if it cannot be loaded, show everything.
  const settings = useSettings();
  const settingsReady = !settings.isPending;
  const { state, phase } = session;
  const navigate = useNavigate();
  // Ending a session in which nothing was answered: there is nothing to sum up, so go straight back.
  const endSession = () => (state.stats.reviewed === 0 ? navigate("/") : session.end());

  return (
    <>
      <div className="study-header">
        <h1>Study</h1>
        {phase === "card" && (
          <p className="muted" aria-live="polite">
            {remaining(state)} left ·{" "}
            <button type="button" className="link" onClick={endSession}>
              End session
            </button>
          </p>
        )}
      </div>

      {(phase === "loading" || (phase === "card" && !settingsReady)) && <p className="status">Loading…</p>}

      {phase === "error" && (
        <div className="status error">
          <p>Could not load your cards.</p>
          <button className="secondary" onClick={session.retryFetch}>
            Try again
          </button>
        </div>
      )}

      {phase === "card" && state.current && state.repeatNotice && (
        <RepeatNotice onContinue={session.acknowledgeRepeat} />
      )}

      {phase === "card" && state.current && session.intro && settingsReady && (
        <FirstSessionIntro onStart={session.startStudying} />
      )}

      {phase === "card" && state.current && !state.repeatNotice && !session.intro && settingsReady && (
        <CardView
          card={state.current}
          revealed={state.revealed}
          languages={languages.data ?? []}
          showSentences={settings.data?.showSentences ?? true}
          showForms={settings.data?.showForms ?? true}
          submitting={session.submitting}
          submitError={session.submitError}
          onReveal={session.reveal}
          onRate={session.rate}
          onRetry={session.retrySubmit}
        />
      )}

      {phase === "done" && (
        <Summary
          stats={state.stats}
          viewed={state.handled.length}
          reReview={reReviewCount(state)}
          ended={state.ended}
        />
      )}
    </>
  );
}

// Shown when the card you just missed is the only one left, so it would come
// straight back: a short pause so you aren't just re-reading the answer you saw.
function RepeatNotice({ onContinue }: { onContinue: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="study-wait" role="status">
      <p>You’re about to be shown the exact same card again!</p>
      <p className="muted">
        Take a few seconds to clear your mind, then click “Continue” when you’re ready.
      </p>
      <button ref={ref} className="primary" onClick={onContinue}>
        Continue
      </button>
    </div>
  );
}

const STATE_LABEL: Record<StudyCardView["state"], string> = {
  new: "New",
  learning: "Learning",
  relearning: "Relearning",
  review: "Review",
};

type CardViewProps = {
  card: StudyCardView;
  revealed: boolean;
  languages: LanguageInfo[];
  /** From the account's settings. */
  showSentences: boolean;
  showForms: boolean;
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
  showSentences,
  showForms,
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
        <Entries entries={card.front} language={card.fromLanguage} languages={languages} />
        {showSentences && <Sentences items={card.sentences.front} />}
      </section>

      {revealed ? (
        <section aria-label="Answer" className="study-answer">
          <Entries entries={card.back} language={card.toLanguage} languages={languages} />
          {showForms && <Forms entries={card.back} />}
          {showSentences && <Sentences items={card.sentences.back} />}
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

      {revealed && (
        <ReportProblem
          key={card.id}
          conceptId={card.conceptId}
          fromLanguage={card.fromLanguage}
          toLanguage={card.toLanguage}
        />
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

function Summary({
  stats,
  viewed,
  reReview,
  ended,
}: {
  stats: SessionStats;
  /** Different cards seen this session (a missed card shown again counts once). */
  viewed: number;
  /** Cards still being learned, which come back in the next session. */
  reReview: number;
  /** The user stopped early, so "nothing answered" does not mean "nothing to do". */
  ended: boolean;
}) {
  if (stats.reviewed === 0 && !ended) {
    return (
      <div className="study-wait">
        <h2>You&rsquo;re all caught up</h2>
        <p className="muted">Nothing is due right now. Add more words to keep learning.</p>
        <div className="hero-actions">
          <Link to="/add-words" className="button primary">
            Browse words
          </Link>
          <Link to="/" className="button secondary">
            Back to the dashboard
          </Link>
        </div>
      </div>
    );
  }
  const minutes = SESSION_GAP_MS / 60_000;
  return (
    <div className="study-wait">
      <h2>Session complete!</h2>
      <p>You viewed {viewed} unique card{viewed === 1 ? "" : "s"}</p>
      {reReview > 0 && (
        <p>
          {reReview} card{reReview === 1 ? "" : "s"} will be available for re-review in {minutes}{" "}
          minutes
        </p>
      )}
      <dl className="summary">
        {(["again", "hard", "good", "easy"] as const).map((r) => (
          <div key={r}>
            <dt>{r[0]!.toUpperCase() + r.slice(1)}</dt>
            <dd>{stats[r]}</dd>
          </div>
        ))}
      </dl>
      <p>
        <Link to="/" className="button primary">
          Back to the dashboard
        </Link>
      </p>
    </div>
  );
}
