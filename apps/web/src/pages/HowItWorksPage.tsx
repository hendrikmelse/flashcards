import { Link } from "react-router";
import { usePageTitle } from "../hooks/usePageTitle";

// Explains the scheduler in plain language. The numbers here mirror the code:
// apps/api/src/srs/engine.ts (learning steps, target retention), src/study/queue.ts and order.ts
// (what is offered, in what order, the daily new-card limit), src/study/day.ts (the 4 a.m. day) and
// apps/web/src/study/session.ts (where a missed card returns).
export function HowItWorksPage() {
  usePageTitle("How scheduling works");
  return (
    <article className="prose">
      <p>
        <Link to="/">← Dashboard</Link>
      </p>
      <h1>How scheduling works</h1>
      <p className="lead">
        This app uses <strong>FSRS</strong>, the Free Spaced Repetition Scheduler, to show you each
        card just before you would forget it. Every card has its own schedule: when you answer, the
        app updates its estimate of how well you know that word and picks the next time to show it.
        Words you know well come back after days, then weeks, then months; words you struggle with
        come back sooner. You never decide what to review, the study queue does that for you.
      </p>

      <h2>Your answer buttons</h2>
      <p>After you reveal a card, say how it went:</p>
      <dl className="rating-help">
        <dt>Again</dt>
        <dd>You didn’t remember it. The card comes back a few cards later in this session.</dd>
        <dt>Hard</dt>
        <dd>You got it, but it took effort. The next gap grows only a little.</dd>
        <dt>Good</dt>
        <dd>You remembered it. This is the answer to use most of the time.</dd>
        <dt>Easy</dt>
        <dd>It was effortless. The next gap grows a lot, and a brand new card skips the learning steps.</dd>
      </dl>
      <p>
        Answer honestly: pressing Good when you guessed makes the app think you know a word better
        than you do, and you will meet it again too late.
      </p>

      <h2>What happens to a card</h2>
      <ol className="steps">
        <li>
          <strong>New.</strong> You haven’t seen it yet. New cards come in the order you added them,
          and in pack order within a pack. If you already know a word one way round (its reverse card
          is in review, or relearning after a slip), the new card for the other direction comes
          first. Once you have seen one direction of a new word, the other waits until the next day,
          unless there is nothing else new to show.
        </li>
        <li>
          <strong>Learning.</strong> A new card goes through two short steps (1 and 10 minutes)
          before it graduates. A Good answer moves it to the next step, and it is offered again in a
          later session once it is due. After the last step it graduates. Again starts it over from
          the first step, and it comes back a few cards later in the same session.
        </li>
        <li>
          <strong>Review.</strong> From here the gaps are measured in days. Each correct answer
          stretches the gap, up to years. A review comes due at the start of its day (4 a.m. in your
          time zone), so a word you learned in the afternoon is waiting for you the next morning.
        </li>
        <li>
          <strong>Relearning.</strong> If you press Again on a review card, you have lapsed. It
          starts over from the first short step, like a new card, and its next gap is much shorter
          than before.
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
        next review for when that chance falls to <strong>90%</strong>. A higher target would mean
        more reviews for little gain, a lower one more forgetting. Long gaps also get a small random
        nudge (fuzz) so cards you learned together don’t all come due on the same day.
      </p>

      <h2>What you see in a session</h2>
      <p>The queue holds the cards that are due and the new cards you have room for today:</p>
      <ul>
        <li>
          <strong>Due cards</strong> (learning and review) go in order of how likely you are to have
          forgotten them, most likely first. That is not the same as the most overdue: a word you
          know very well can be weeks late and still be safer than one you barely know that is a day
          late. If you stop early, the cards you skip are the ones you probably remember.
        </li>
        <li>
          <strong>New cards</strong>, up to your daily limit, are spread through the first half of
          the queue, so you meet them while you’re fresh and there is still room left to bring back
          the ones you miss.
        </li>
      </ul>
      <p>
        A session ends when nothing is due right now. A card you answer Hard or Good while it is
        still being learned leaves the session, and is offered again in a later one once it is due.
      </p>
      <p>
        A card you miss returns about halfway through the cards still to come, never sooner than
        five cards later, and a little randomly, so a run of misses doesn’t come back in the same
        order. With fewer than five cards left, it goes to the end. If it would be the very next
        card, you get a short pause first, so you aren’t just re-reading the answer you saw a second
        ago.
      </p>
      <p>
        The daily limit is <strong>20 new cards</strong> by default (you can change it in{" "}
        <Link to="/settings?tab=study">Settings</Link>), counted for each pair of languages you are
        learning, with both of its directions sharing it. It resets at <strong>4 a.m.</strong> in
        your time zone, so studying late at night still counts toward the same day. A new card you
        mark <strong>Good</strong> or <strong>Easy</strong> the first time you see it is a word you
        already know, so it doesn’t use up your limit; one you mark Again or Hard does.
      </p>
      <p>
        Reviews are never capped. If you skip a few days they wait for you, most likely forgotten
        first, so a big backlog is not a problem: work through it a little at a time.
      </p>

      <h2>Each direction is separate</h2>
      <p>
        A word in one direction and the same word the other way round are separate cards with
        separate schedules, because recognizing a word doesn’t mean you can produce it.
      </p>

      <p>
        <Link to="/">← Dashboard</Link>
      </p>
    </article>
  );
}
