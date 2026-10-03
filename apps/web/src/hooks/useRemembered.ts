import { useState } from "react";

const PREFIX = "remembered:";

// Filter choices are kept for the rest of the browser tab's life (sessionStorage), so leaving a
// page and coming back, or reloading it, finds the filters as they were. Closing the tab, or
// signing in as someone else, starts fresh.
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
 * Like useState, but the value is remembered under `key`. A remembered value that `accept`
 * does not recognise (an option that has since gone, say) is ignored in favor of `initial`.
 */
export function useRemembered<T>(
  key: string,
  initial: T,
  accept: (value: unknown) => value is T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => read(key, accept) ?? initial);
  function set(next: T) {
    setValue(next);
    try {
      sessionStorage.setItem(PREFIX + key, JSON.stringify(next));
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
