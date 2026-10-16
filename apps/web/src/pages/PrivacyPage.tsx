import { Link } from "react-router";
import { useMe } from "../api/hooks";
import { usePageTitle } from "../hooks/usePageTitle";

// What the app keeps about people and what happens to it. Public, so it can be read before signing up.
// It describes what the code does: if what is kept, who handles it, or how long it stays changes
// (the backup schedule in deploy/README.md, the account export and deletion in routes/account.ts),
// change this too, and the date.
export const PRIVACY_UPDATED = "October 15, 2026";

export function PrivacyPage() {
  usePageTitle("Privacy policy");
  const { data: user } = useMe();

  return (
    <main className="public-page">
      <article className="prose">
        <p>
          {user ? <Link to="/">← Dashboard</Link> : <Link to="/login">← Log in</Link>}
        </p>
        <h1>Privacy policy</h1>
        <p className="muted">Last updated {PRIVACY_UPDATED}</p>
        <p className="lead">
          This app is made and run by Hendrik Melse. This page says what it keeps about you and what
          happens to it. I don’t sell your data, and there are no ads and no tracking.
        </p>

        <h2>What I keep</h2>
        <ul>
          <li>
            <strong>Your account:</strong> your email address and your password (stored hashed, so
            I can’t read it). Your name and time zone too, if you add them.
          </li>
          <li>
            <strong>Your studying:</strong> the words in your deck, your settings, and every answer
            you give: how you rated it, when, and how long it took.
          </li>
          <li>
            <strong>What you send me:</strong> problem reports, bug reports, suggestions, and pack
            requests, and my replies.
          </li>
          <li>
            <strong>Server logs:</strong> each request to the site, with your IP address and the page
            asked for. These are kept for up to 30 days.
          </li>
        </ul>

        <h2>How I use it</h2>
        <p>
          To run the app: to sign you in, to schedule your cards, and to email you when you need to
          confirm your address or reset your password. I read what you send me so I can answer it and
          fix things, and I get a daily email listing open reports and who sent them. I don’t use your
          data for anything else.
        </p>

        <h2>Who else handles it</h2>
        <ul>
          <li>
            <strong>Resend</strong> sends the emails.
          </li>
          <li>
            <strong>My hosting provider</strong> runs the server.
          </li>
          <li>
            <strong>Backblaze</strong> stores backups of the database. They are encrypted before they
            leave the server, so Backblaze can’t read them.
          </li>
        </ul>
        <p>I don’t sell or share your data with anyone else, unless the law requires me to.</p>

        <h2>Cookies</h2>
        <p>
          One cookie keeps you signed in. Your browser also remembers a few choices on your own
          device, like your theme. There are no tracking cookies and no analytics.
        </p>

        <h2>Your choices</h2>
        <ul>
          <li>
            <strong>Download your data</strong> in Settings, under Your data. It is everything the app
            keeps about you in one file (never your password).
          </li>
          <li>
            <strong>Delete your account</strong> in the same place. This permanently deletes your
            account, your cards, and your review history. Reports you sent are kept, but are no longer
            linked to you. Copies in backups are gone within about six months.
          </li>
          <li>
            <strong>Change your email, name, or password</strong> in Settings.
          </li>
        </ul>

        <h2>Children</h2>
        <p>
          This app is not meant for children under 13, and I don’t knowingly keep their data. If you
          think a child has signed up, tell me and I’ll delete the account.
        </p>

        <h2>Changes</h2>
        <p>If I change this policy, I’ll update the date at the top.</p>

        <h2>Contact</h2>
        <p>
          Questions, or want something done with your data? Send me a message from the Reports tab
          (the flag icon at the top of the page) after you sign in.
        </p>
      </article>
    </main>
  );
}
