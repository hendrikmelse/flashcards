import { Link } from "react-router";

// The strip at the foot of every page, set apart from it like the top bar is: the privacy policy, who
// the app is by, and the maker's own site. It is rendered once, below all the routes (see App.tsx).
export function SiteFooter() {
  return (
    <footer className="sitefooter">
      <Link to="/privacy">Privacy policy</Link>
      <span className="sep" aria-hidden="true">
        ·
      </span>
      <span>© {new Date().getFullYear()} Hendrik Melse</span>
      <span className="sep" aria-hidden="true">
        ·
      </span>
      <a href="https://hendrikmelse.com" target="_blank" rel="noopener noreferrer">
        hendrikmelse.com <span className="visually-hidden">(opens in a new tab)</span>
      </a>
    </footer>
  );
}
