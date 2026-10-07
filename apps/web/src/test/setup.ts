import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// Waiting for something to appear gives up after a second by default, which is too tight when the
// whole suite runs at once on a busy machine (or a small CI runner): a test would then fail for
// being slow, not for being wrong. Nothing that is wrong takes longer to be noticed; it only fails
// after this longer wait.
configure({
  asyncUtilTimeout: 4000,
  // The card's word picked out in a sentence repeats a word that is also elsewhere on the card; it is
  // only styling, so text queries do not see it as a second copy.
  defaultIgnore: "script, style, .sentence-word",
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});
