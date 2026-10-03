import { Link } from "react-router";
import { useDismissed } from "../hooks/useDismissed";

// A reminder of what the four answer buttons mean, shown under them until it is closed.
export function AnswerGuide() {
  const [dismissed, dismiss] = useDismissed("answer-buttons");
  if (dismissed) return null;
  return (
    <aside className="answer-guide" aria-label="What the answer buttons mean">
      <p>
        <strong>How did it go?</strong> Answer honestly: the app uses it to decide when to show the
        word again.
      </p>
      <dl className="rating-help">
        <dt>Again</dt>
        <dd>I didn’t remember it.</dd>
        <dt>Hard</dt>
        <dd>I got it, but it took effort.</dd>
        <dt>Good</dt>
        <dd>I remembered it. Use this most of the time.</dd>
        <dt>Easy</dt>
        <dd>It was effortless.</dd>
      </dl>
      <p>
        <button type="button" className="secondary" onClick={dismiss}>
          Got it
        </button>{" "}
        <Link to="/how-it-works">More about scheduling</Link>
      </p>
    </aside>
  );
}
