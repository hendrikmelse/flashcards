import { useState } from "react";

const PREFIX = "dismissed:";

/**
 * Whether a one-time tip has been closed on this device. Kept in localStorage, so it stays closed
 * for good; if storage is unavailable the tip comes back next visit, which does no harm.
 */
export function useDismissed(tip: string): [boolean, () => void] {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(PREFIX + tip) === "1";
    } catch {
      return false;
    }
  });
  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(PREFIX + tip, "1");
    } catch {
      // It stays closed for this visit.
    }
  }
  return [dismissed, dismiss];
}
