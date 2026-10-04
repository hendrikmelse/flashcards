import axe from "axe-core";

// Runs the axe accessibility checks on the page as rendered in the test, and returns what it
// found as readable lines (an empty list means none). Colour contrast is left out: jsdom has no
// layout or colours to measure, so it cannot be checked here (use a browser for that).
export async function a11yViolations(): Promise<string[]> {
  document.documentElement.lang ||= "en"; // index.html sets it; the test document has none
  const results = await axe.run(document.documentElement, { rules: { "color-contrast": { enabled: false } } });
  return results.violations.map(
    (v) => `${v.id}: ${v.help} [${v.nodes.map((n) => n.target.join(" ")).join(" | ")}]`,
  );
}
