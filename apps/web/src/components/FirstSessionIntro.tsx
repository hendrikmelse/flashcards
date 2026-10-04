import { useEffect, useRef } from "react";
import { Link } from "react-router";

// Shown once, before the very first card of someone's very first study session: how a card works
// and what the four answer buttons mean. It is in place of the card, not squeezed in beside it, and
// it ends with a button, so it is plain how to get past it.
export function FirstSessionIntro({ onStart }: { onStart: () => void }) {
  const start = useRef<HTMLButtonElement>(null);
  useEffect(() => start.current?.focus(), []);
  return (
    <article className="study-card study-intro" aria-labelledby="intro-title">
      <h2 id="intro-title">How studying works</h2>
      <p>
        You will see a word. Try to remember what it means, then press <strong>Show answer</strong> to check.
        After that, tell the app how it went:
      </p>
      <dl className="rating-help">
        <dt>Again</dt>
        <dd>I didn’t remember it. It comes back a little later.</dd>
        <dt>Hard</dt>
        <dd>I got it, but it took effort.</dd>
        <dt>Good</dt>
        <dd>I remembered it. Use this most of the time.</dd>
        <dt>Easy</dt>
        <dd>It was effortless. I won’t see it again for a good while.</dd>
      </dl>
      <p>
        Be honest: the app uses your answers to bring each word back just before you would forget it. You can
        also press <kbd>1</kbd> to <kbd>4</kbd> to answer, and stop whenever you like with “End session”.
      </p>
      <div className="study-intro-actions">
        <button ref={start} type="button" className="primary" onClick={onStart}>
          Start studying
        </button>
        <Link to="/how-it-works">More about scheduling</Link>
      </div>
    </article>
  );
}
