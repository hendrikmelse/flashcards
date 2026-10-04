import { useState } from "react";

const KEY = "ratingShortcuts";

function stored(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

// Whether the number keys 1 to 4 rate a card in a study session. Single-key shortcuts can clash
// with speech input and assistive technology, so they can be turned off. Kept on this device,
// like the theme. On by default.
export function useRatingShortcuts(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(stored);
  function choose(next: boolean) {
    setEnabled(next);
    try {
      if (next) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, "off");
    } catch {
      // Not remembered, but it still applies until the page is closed.
    }
  }
  return [enabled, choose];
}
