import { Link } from "react-router";
import { usePageTitle } from "../hooks/usePageTitle";

// Explains the scheduler in plain language. The numbers here mirror the server:
// apps/api/src/srs/engine.ts (steps, target retention) and src/study/queue.ts
// (daily new-card limit, order).
export function HowItWorksPage() {
  usePageTitle("How scheduling works");
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
        <dd>You didn’t remember it. The card comes back a few cards later in this session, and its interval shrinks.</dd>
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
          added them, and pack order within a pack. The exception: if you already know a word one
          way (its reverse card is in review, or relearning after a slip), the new card for the
          other direction jumps to the front of the line. But once you have seen one direction of a
          new word, the other goes to the back of the line for that day, so you meet a word both
          ways on the same day only when there is nothing else new to show.
        </li>
        <li>
          <strong>Learning.</strong> A new card goes through two short steps before it graduates. A
          Good answer moves it to the next step, which you will see in your next session. After the
          last step it graduates. If you press Again, it starts over from the first step, and comes
          back a few cards later in the same session.
        </li>
        <li>
          <strong>Review.</strong> From here the gaps are measured in days. Each correct answer
          stretches the gap, and the more stable the memory, the longer it gets, up to years. A
          review comes due at the start of its day (4 a.m. in your time zone), not at the same time
          of day you studied it, so a word you learned in the afternoon is waiting for you the
          next morning, and the schedule counts whole days.
        </li>
        <li>
          <strong>Relearning.</strong> If you press Again on a review card, you have lapsed. It starts
          over from the first short step, like a new card, and its next review gap starts much
          shorter than before.
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
      <p>The queue is built from three kinds of cards:</p>
      <ol className="steps">
        <li>
          <strong>Cards you’re likeliest to have forgotten.</strong> Learning and review cards that
          are due go in order of how likely you are to have
          forgotten them, most likely first. That is not the same as the most overdue: a word you
          know very well can be weeks late and still be safer than one you barely know that is a day
          late. If you stop early, the cards you skip are the ones you probably remember.
        </li>
        <li>
          <strong>New cards, up to your daily limit.</strong> They are mixed in among the others,
          spread through the first half of the queue, so you meet new words while you’re fresh and
          there is still room left to bring back the ones you miss.
        </li>
      </ol>
      <p>
        A session ends when there are no more cards to show right now. Cards you answered Hard or
        Good while still learning them do not come back in the same session. Nothing is held back
        between sessions, though: start another one whenever you like and they are offered again as
        soon as they are due, not before.
      </p>
      <p>
        When you press Again, the card returns about halfway through the cards still to come, never
        sooner than five cards later, and a little randomly, so a run of misses doesn’t come back in
        the same order. When fewer than five cards are left, it goes to the end. If it would be the
        very next card, you get a short pause before it comes back, so you aren’t just re-reading
        the answer you saw a second ago.
      </p>
      <p>
        The daily limit is <strong>20 new cards</strong> by default for each pair of languages you are learning, shared by both of its directions. It
        resets at <strong>4 a.m.</strong> in your time zone, so studying late at night still counts
        toward the same day. The dashboard’s “new available today” shows how many are left.
      </p>
      <p>
        The limit is for words you have to learn. A new card you mark <strong>Good</strong> or{" "}
        <strong>Easy</strong> the first time you see it is a word you already know, so it does not use
        up your limit; one you mark Again or Hard does.
      </p>
      <p>
        Reviews are never capped. If you skip a few days, they wait for you, and the ones you’re
        likeliest to have forgotten are shown first. A big backlog is not a problem, just work through it a little at a time.
      </p>

      <h2>Each direction is separate</h2>
      <p>
        A word in one direction and the same word the other way round are different cards with
        different schedules. Being able to recognize a word doesn’t mean you can produce it, so
        knowing one direction does not make the other easier in the schedule.
      </p>

      <p className="footnote">
        <Link to="/">Back to the dashboard</Link>
      </p>
    </article>
  );
}
