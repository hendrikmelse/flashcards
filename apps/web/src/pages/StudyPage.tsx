import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useReducer, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import type {
  LanguageInfo,
  Rating,
  ReviewResponse,
  StudyCardView,
  StudyCountsResponse,
  StudyResponse,
} from "@flashcards/shared";
import { api } from "../api/client";
import { useSettings } from "../api/hooks";
import { useActiveLanguages } from "../hooks/useActiveLanguages";
import { usePageTitle } from "../hooks/usePageTitle";
import { useRatingShortcuts } from "../hooks/useRatingShortcuts";
import { useLanguages } from "../api/packs";
import { Entries, Forms, Sentences } from "../components/CardParts";
import { FirstSessionIntro } from "../components/FirstSessionIntro";
import { languageName } from "../components/entries";
import { ReportProblem } from "../components/ReportProblem";
import { randomUUID } from "../lib/uuid";
import {
  initialState,
  phaseOf,
  reducer,
  remaining,
  type SessionStats,
} from "../study/session";

// The server orders the whole queue; a big batch lets "Again" cards slot back in
// among enough other cards, and the new ones spread through it as intended.
const BATCH_SIZE = 100;

// How long the last answer can be taken back, once it has been given. The server allows longer.
const UNDO_SHOWN_MS = 8000;

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
  const fetching = useRef(false);
  const shownAt = useRef(Date.now());
  // The explanation shown before the very first card of someone's very first session. It is looked
  // for in the first batch only; a later top-up cannot be the first session, as cards were answered.
  const [intro, setIntro] = useState(false);
  const introChecked = useRef(false);

  // Top up whenever the queue runs dry (this is also the initial load).
  useEffect(() => {
    // Also when a missed card is waiting for more cards to be slotted in among.
    const waiting = state.deferred.length > 0;
    if (state.ended || (state.queue.length > 0 && !waiting) || state.exhausted || state.fetchError || fetching.current) return;
    fetching.current = true;
    const answeredAtRequest = state.handled.length;
    // After the first batch, ask for the cards that were due when the session began.
    const asOf = state.asOf ? `&asOf=${encodeURIComponent(state.asOf)}` : "";
    api<StudyResponse>(`/study?limit=${BATCH_SIZE}&pair=${pair}${asOf}`)
      .then(
        (r) => {
          if (!introChecked.current) {
            introChecked.current = true;
            if (r.firstSession && r.cards.length > 0) setIntro(true);
          }
          // A full batch means the server probably has more than it sent.
          dispatch({
            type: "fetched",
            cards: r.cards,
            moreNew: r.moreNew,
            more: r.cards.length >= BATCH_SIZE,
            now: r.now,
            total: r.total,
            answeredAtRequest,
          });
        },
        () => dispatch({ type: "fetchFailed" }),
      )
      .finally(() => {
        fetching.current = false;
      });
  }, [state.ended, state.queue.length, state.deferred.length, state.exhausted, state.fetchError, state.asOf, pair]);

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
      dispatch({ type: "answered", rating: v.rating, result, random: Math.random(), clientReviewId: v.clientReviewId }),
  });

  // Takes the latest answer back, which puts its card on screen again, answer showing.
  const undoAnswer = useMutation({
    mutationFn: (clientReviewId: string) =>
      api<ReviewResponse>("/reviews/undo", { method: "POST", body: { clientReviewId } }),
    onSuccess: () => dispatch({ type: "undone" }),
    onError: (_error, clientReviewId) => dispatch({ type: "undoExpired", clientReviewId }),
  });

  // The offer to undo goes away after a few seconds.
  const answerId = state.lastAnswer?.clientReviewId;
  useEffect(() => {
    if (!answerId || undoAnswer.isPending) return;
    const timer = setTimeout(() => dispatch({ type: "undoExpired", clientReviewId: answerId }), UNDO_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [answerId, undoAnswer.isPending]);

  function rate(rating: Rating) {
    if (!state.current || !state.revealed || submit.isPending) return;
    undoAnswer.reset();
    submit.mutate({
      cardId: state.current.id,
      rating,
      clientReviewId: randomUUID(),
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
    lastAnswer: state.lastAnswer,
    undo: () => {
      if (state.lastAnswer && !undoAnswer.isPending && !submit.isPending) undoAnswer.mutate(state.lastAnswer.clientReviewId);
    },
    undoing: undoAnswer.isPending,
    undoFailed: undoAnswer.isError,
    intro,
    startStudying: () => {
      setIntro(false);
      shownAt.current = Date.now(); // the time taken starts now, not while the explanation was read
    },
    acknowledgeRepeat: () => dispatch({ type: "acknowledgeRepeat" }),
    end: () => dispatch({ type: "end" }),
    restart: () => dispatch({ type: "restart" }),
    retryFetch: () => dispatch({ type: "retryFetch" }),
  };
}

export function StudyPage() {
  usePageTitle("Study");
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
          ended={state.ended}
          onKeepGoing={session.restart}
        />
      )}

      {session.lastAnswer && (
        <UndoBar
          rating={session.lastAnswer.rating}
          onUndo={session.undo}
          disabled={session.undoing || session.submitting}
        />
      )}
      {session.undoFailed && !session.lastAnswer && (
        <p className="undo-bar" role="status">
          That answer can no longer be undone.
        </p>
      )}
    </>
  );
}

// Offered for a few seconds after an answer: "Answered Good · Undo". Z or Backspace do the same, unless
// the keyboard shortcuts are turned off in the settings.
function UndoBar({ rating, onUndo, disabled }: { rating: Rating; onUndo: () => void; disabled: boolean }) {
  const [shortcuts] = useRatingShortcuts();
  useEffect(() => {
    if (!shortcuts || disabled) return;
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      if (e.key === "z" || e.key === "Z" || e.key === "Backspace") {
        e.preventDefault(); // Backspace must not take the browser back a page
        onUndo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcuts, disabled, onUndo]);

  return (
    <p className="undo-bar" role="status">
      Answered {RATINGS.find((r) => r.rating === rating)!.label} ·{" "}
      <button type="button" className="link" onClick={onUndo} disabled={disabled}>
        Undo
        {shortcuts && <kbd aria-hidden="true">Z</kbd>}
      </button>
    </p>
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
  const [shortcuts] = useRatingShortcuts();

  // Keep keyboard flow natural: Space/Enter act on the focused button.
  useEffect(() => {
    (revealed ? goodRef : revealRef).current?.focus();
  }, [card.id, revealed]);

  // 1-4 rate the card once the answer is showing (unless turned off in the settings).
  useEffect(() => {
    if (!shortcuts) return;
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      const n = Number(e.key);
      if (revealed && n >= 1 && n <= 4) onRate(RATINGS[n - 1]!.rating);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [revealed, onRate, shortcuts]);

  return (
    <article className="study-card">
      <p className="study-meta">
        {languageName(languages, card.fromLanguage)} → {languageName(languages, card.toLanguage)}
        <span className="badge state">{STATE_LABEL[card.state]}</span>
      </p>

      <section aria-label="Prompt">
        <Entries entries={card.front} language={card.fromLanguage} languages={languages} />
        {showSentences && <Sentences items={card.sentences.front} language={card.fromLanguage} entries={card.front} />}
      </section>

      {revealed ? (
        <section aria-label="Answer" className="study-answer">
          <Entries entries={card.back} language={card.toLanguage} languages={languages} id="answer-word" />
          {showForms && <Forms entries={card.back} />}
          {showSentences && <Sentences items={card.sentences.back} language={card.toLanguage} entries={card.back} />}
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
              // Focus lands here when the answer appears, so the button reads the answer too.
              aria-describedby={rating === "good" ? "answer-word" : undefined}
              className={`rating ${rating}`}
              onClick={() => onRate(rating)}
              disabled={submitting}
            >
              {label}
              {shortcuts && <kbd aria-hidden="true">{i + 1}</kbd>}
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
  ended,
  onKeepGoing,
}: {
  stats: SessionStats;
  /** Different cards seen this session (a missed card shown again counts once). */
  viewed: number;
  /** The user stopped early, so "nothing answered" does not mean "nothing to do". */
  ended: boolean;
  /** Start another session, with the cards that are ready now. */
  onKeepGoing: () => void;
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
  return <SessionComplete stats={stats} viewed={viewed} onKeepGoing={onKeepGoing} />;
}

function SessionComplete({
  stats,
  viewed,
  onKeepGoing,
}: {
  stats: SessionStats;
  viewed: number;
  onKeepGoing: () => void;
}) {
  const ready = useReadyCount();
  return (
    <div className="study-wait">
      <h2>Session complete!</h2>
      <p>You viewed {viewed} unique card{viewed === 1 ? "" : "s"}</p>
      <dl className="summary">
        {(["again", "hard", "good", "easy"] as const).map((r) => (
          <div key={r}>
            <dt>{r[0]!.toUpperCase() + r.slice(1)}</dt>
            <dd>{stats[r]}</dd>
          </div>
        ))}
      </dl>
      <ReadyAgain ready={ready} onKeepGoing={onKeepGoing} />
      <p>
        {/* The way on when there is nothing to keep studying; a quiet link when there is. */}
        <Link to="/" className={ready > 0 ? "link" : "button primary"}>
          Back to the dashboard
        </Link>
      </p>
    </div>
  );
}

// A session studies the cards that were due when it began, so a card still being learned (due again in
// a few minutes) or one that fell due in the meantime is not in it. Offer them, if any are ready now.
function useReadyCount(): number {
  const { pair } = useActiveLanguages();
  const ready = useQuery({
    queryKey: ["study", "counts", pair, "after-session"],
    queryFn: () => api<StudyCountsResponse>(`/study/counts?pair=${pair}`),
    staleTime: 0,
    gcTime: 0,
  });
  const { learning, review, new: fresh } = ready.data?.counts ?? { learning: 0, review: 0, new: 0 };
  return learning + review + fresh;
}

function ReadyAgain({ ready: n, onKeepGoing }: { ready: number; onKeepGoing: () => void }) {
  if (n === 0) return null;
  return (
    <>
      <hr />
      <div className="study-again" role="status">
        <p>
          {n} card{n === 1 ? "" : "s"} became available for review during your study session
        </p>
        <button type="button" className="primary" onClick={onKeepGoing}>
          Keep studying
        </button>
      </div>
    </>
  );
}
