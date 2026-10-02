import { Link } from "react-router";

// Explains the scheduler in plain language. The numbers here mirror the server:
// apps/api/src/srs/engine.ts (steps, target retention) and src/study/queue.ts
// (daily new-card limit, learn-ahead window, order).
export function HowItWorksPage() {
  return (
    <article className="prose">
      <p>
        <Link to="/">← Dashboard</Link>
      </p>
      <h1>How scheduling works</h1>
      <p className="lead">
        This app uses <strong>FSRS</strong>, the Free Spaced Repetition Scheduler, to decide when to
        show you each card, so you see a word just before you would forget it. FSRS is an open
        algorithm that models how memory fades, based on real review data. It is designed to predict
        forgetting more accurately than older methods that multiply the gap by a fixed amount. Here
        is what that means for you.
      </p>

      <h2>The short version</h2>
      <p>
        Every card has its own schedule. When you answer, the app updates its estimate of how well
        you know that word and picks the next time to show it. Words you know well come back after
        days, then weeks, then months. Words you struggle with come back sooner. You never have to
        decide what to review: the study queue does that for you.
      </p>

      <h2>Your answer buttons</h2>
      <p>After you reveal a card, say how it went:</p>
      <dl className="rating-help">
        <dt>Again</dt>
        <dd>You didn’t remember it. The card comes back within minutes and its interval shrinks.</dd>
        <dt>Hard</dt>
        <dd>You got it, but it took effort. The next gap grows only a little.</dd>
        <dt>Good</dt>
        <dd>You remembered it normally. This is the answer to use most of the time.</dd>
        <dt>Easy</dt>
        <dd>It was effortless. The next gap grows a lot, and a brand new card skips the short steps.</dd>
      </dl>
      <p>
        Honest answers work best. Pressing Good when you guessed makes the app think you know a word
        better than you do, and you will meet it again too late.
      </p>

      <h2>What happens to a card</h2>
      <ol className="steps">
        <li>
          <strong>New.</strong> You haven’t seen it yet. New cards are introduced in the order you
          added them, and pack order within a pack.
        </li>
        <li>
          <strong>Learning.</strong> Your first answers use short steps: the card returns after about
          1 minute, then 10 minutes, so it can stick within the same session. A Good answer moves it
          to the next step. After the last step it graduates.
        </li>
        <li>
          <strong>Review.</strong> From here the gaps are measured in days. Each correct answer
          stretches the gap, and the more stable the memory, the longer it gets, up to years.
        </li>
        <li>
          <strong>Relearning.</strong> If you press Again on a review card, you have lapsed. It goes
          back for a 10-minute step, and its next review gap starts much shorter than before.
        </li>
      </ol>

      <h2>How the gap is chosen</h2>
      <p>For each card FSRS tracks two numbers that it learns from your answers:</p>
      <ul>
        <li>
          <strong>Stability</strong>: how long the memory lasts. Every successful review makes it
          grow, and a lapse cuts it back.
        </li>
        <li>
          <strong>Difficulty</strong>: how hard this particular word is for you. Hard words grow
          more slowly.
        </li>
      </ul>
      <p>
        From these it estimates the chance you could recall the word right now, and schedules the
        next review for when that chance falls to <strong>90%</strong>. That target is a balance:
        higher means more reviews for little gain, lower means more forgetting. Long gaps also get a
        small random nudge (called fuzz) so cards you learned together don’t all come due on the same
        day.
      </p>

      <h2>What you see in a session</h2>
      <p>The queue fills in this order:</p>
      <ol className="steps">
        <li>Cards in learning or relearning that are due, or due within the next 20 minutes.</li>
        <li>Review cards that are due, the most overdue first.</li>
        <li>New cards, up to your daily limit.</li>
      </ol>
      <p>
        The daily limit is <strong>20 new cards</strong> by default, shared across all your decks. It
        resets at <strong>4 a.m.</strong> in your time zone, so studying late at night still counts
        toward the same day. The dashboard’s “new available today” shows how many are left.
      </p>
      <p>
        Reviews are never capped. If you skip a few days, they wait for you, and the oldest are
        shown first. A big backlog is not a problem, just work through it a little at a time.
      </p>

      <h2>Each direction is separate</h2>
      <p>
        English to Dutch and Dutch to English are different cards with different schedules. Being
        able to recognize a word doesn’t mean you can produce it, so knowing one direction does not
        make the other easier in the schedule.
      </p>

      <p className="footnote">
        <Link to="/">Back to the dashboard</Link>
      </p>
    </article>
  );
}
