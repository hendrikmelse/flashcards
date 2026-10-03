// Applies the chosen colour theme before the page is drawn, so a dark theme chosen on a light
// system (or the other way round) does not flash. Loaded as a plain script from the page head;
// no choice stored means the browser's own setting is followed (see index.css).
try {
  var theme = localStorage.getItem("theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch (e) {
  // Storage can be unavailable (private mode): fall back to the browser's setting.
}
