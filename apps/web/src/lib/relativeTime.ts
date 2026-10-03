const rtf = new Intl.RelativeTimeFormat("en", { numeric: "always" });

// "in 5 minutes", "in 3 hours", "in 1 day", "in 2 days": how long from `now` until `target`.
// A day or more is given in days.
export function formatUntil(target: string, now: string): string {
  const ms = Math.max(0, Date.parse(target) - Date.parse(now));
  const minutes = ms / 60_000;
  if (minutes < 1) return "in under a minute";
  // Round first and then pick the unit, so 59.6 minutes reads "in 1 hour", not "in 60
  // minutes", and 23.6 hours reads "in 1 day", not "in 24 hours".
  const wholeMinutes = Math.round(minutes);
  if (wholeMinutes < 60) return rtf.format(wholeMinutes, "minute");
  const wholeHours = Math.round(minutes / 60);
  if (wholeHours < 24) return rtf.format(wholeHours, "hour");
  return rtf.format(Math.round(minutes / 1440), "day");
}
