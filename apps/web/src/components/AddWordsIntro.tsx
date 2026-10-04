import { useEffect, useRef } from "react";

// Shown in place of the Add words page until it is dismissed, once per account: what adding words
// does. Nothing else on the page is available until then, and it ends with a button, so it is plain
// how to get past it.
export function AddWordsIntro({ onDismiss }: { onDismiss: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => button.current?.focus({ preventScroll: true }), []);
  return (
    <section className="add-intro" aria-labelledby="add-intro-title">
      <h1 id="add-intro-title">How adding words works</h1>
      <p>
        You build your deck by adding words to it. You can add <strong>pre-made packs</strong> of words, or{" "}
        <strong>individual words</strong> that you search for.
      </p>
      <p>
        Adding a word adds <strong>two cards</strong>:
      </p>
      <ul>
        <li>
          The <strong>forward direction</strong> tests your ability to produce a word on command.
        </li>
        <li>
          The <strong>reverse direction</strong> tests your ability to recognize a word when you see it.
        </li>
      </ul>
      <p>
        The two cards are treated as <strong>completely independent</strong> flashcards, each with its own schedule.
      </p>
      <button ref={button} type="button" className="primary" onClick={onDismiss}>
        Got it
      </button>
    </section>
  );
}
