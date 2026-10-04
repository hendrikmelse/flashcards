import type { ReactNode } from "react";
import { Link } from "react-router";
import { useStudyCounts } from "../api/hooks";

// The buttons at the top right of a page header: "Start studying" on top, with a tag showing how
// many cards are ready, and the page's own navigation buttons beneath it. With nothing ready it is
// still there, but disabled and saying so. Until the counts have loaded there is room for it and
// nothing in it, so the header does not change height, or flash the wrong button.
export function PageHeadActions({ children }: { children: ReactNode }) {
  const counts = useStudyCounts();
  const ready = counts.data ? counts.data.counts.learning + counts.data.counts.review + counts.data.counts.new : null;
  return (
    <div className="page-head-right">
      <div className="page-head-start">
        {ready !== null &&
          (ready > 0 ? (
            <Link to="/study" className="button primary" aria-label={`Start studying, ${ready} ready`}>
              Start studying
              <span className="count" aria-hidden="true">
                {ready}
              </span>
            </Link>
          ) : (
            <button type="button" className="primary" disabled>
              No cards ready to study
            </button>
          ))}
      </div>
      <div className="page-head-actions">{children}</div>
    </div>
  );
}
