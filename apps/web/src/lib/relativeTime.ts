const rtf = new Intl.RelativeTimeFormat("en", { numeric: "always" });

// "in 5 minutes", "in 3 hours", "in 2 days": how long from `now` until `target`.
export function formatUntil(target: string, now: string): string {
  const ms = Math.max(0, Date.parse(target) - Date.parse(now));
  const minutes = ms / 60_000;
  if (minutes < 1) return "in under a minute";
  if (minutes < 60) return rtf.format(Math.round(minutes), "minute");
  const hours = minutes / 60;
  if (hours < 48) return rtf.format(Math.round(hours), "hour");
  return rtf.format(Math.round(hours / 24), "day");
}
