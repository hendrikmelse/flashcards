import { useState } from "react";
import { useActiveLanguages } from "./useActiveLanguages";

const PREFIX = "remembered:";

// Filter choices are kept for the rest of the browser tab's life (sessionStorage), so leaving a
// page and coming back, or reloading it, finds the filters as they were. Closing the tab, or
// signing in as someone else, starts fresh. Each language pair has its own, since each is a deck
// of its own.
function read<T>(key: string, accept: (value: unknown) => value is T): T | undefined {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (raw === null) return undefined;
    const value: unknown = JSON.parse(raw);
    return accept(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Like useState, but the value is remembered under `key`, separately for each language pair. A
 * remembered value that `accept` does not recognise (an option that has since gone, say) is ignored
 * in favor of `initial`. When the pair changes, the value is the one remembered for the new pair.
 */
export function useRemembered<T>(
  key: string,
  initial: T,
  accept: (value: unknown) => value is T,
): [T, (value: T) => void] {
  const { pair } = useActiveLanguages();
  const stored = `${pair}:${key}`;
  // What was last chosen on this visit, and for which pair, so a choice is shown at once.
  const [held, setHeld] = useState<{ stored: string; value: T } | null>(null);
  const value = held?.stored === stored ? held.value : (read(stored, accept) ?? initial);
  function set(next: T) {
    setHeld({ stored, value: next });
    try {
      sessionStorage.setItem(PREFIX + stored, JSON.stringify(next));
    } catch {
      // Not remembered, but it still applies on this visit.
    }
  }
  return [value, set];
}

/** Forgets every remembered filter. */
export function clearRemembered() {
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith(PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {
    // Nothing to clear.
  }
}

// Ready-made checks for common shapes.
export const isString = (v: unknown): v is string => typeof v === "string";
export const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";
export const isOneOf =
  <T extends string>(...options: readonly T[]) =>
  (v: unknown): v is T =>
    typeof v === "string" && (options as readonly string[]).includes(v);
/** Either null or one of the options. */
export const isOneOfOrNull =
  <T extends string>(...options: readonly T[]) =>
  (v: unknown): v is T | null =>
    v === null || isOneOf(...options)(v);
