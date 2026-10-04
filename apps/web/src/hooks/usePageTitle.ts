import { useEffect } from "react";

const SITE = "Flashcards";

// Sets the browser tab's title for the page, so a screen reader announces where you are after a
// navigation and the history and tabs are readable. Without a title it is just the site name.
export function usePageTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} · ${SITE}` : SITE;
  }, [title]);
}
