import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// Waiting for something to appear gives up after a second by default, which is too tight when the
// whole suite runs at once on a busy machine (or a small CI runner): a test would then fail for
// being slow, not for being wrong. Nothing that is wrong takes longer to be noticed; it only fails
// after this longer wait.
configure({ asyncUtilTimeout: 4000 });

afterEach(() => {
  cleanup();
  localStorage.clear();
});
