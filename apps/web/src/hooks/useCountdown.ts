import { useEffect, useState } from "react";

/** Milliseconds left until `deadline` (a client-clock time), counting down once a second. */
export function useCountdown(deadline: number | null): number | null {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (deadline === null) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [deadline]);
  return deadline === null ? null : Math.max(0, deadline - now);
}

/** "12:05" for 725 000 ms. */
export function formatClock(ms: number): string {
  const secs = Math.ceil(ms / 1000);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}
