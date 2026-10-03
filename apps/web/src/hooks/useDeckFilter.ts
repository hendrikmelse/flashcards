import { useState } from "react";
import type { DirectionSummary } from "@flashcards/shared";
import type { Direction } from "../api/packs";
import { useActiveLanguages } from "./useActiveLanguages";

// One choice for each language pair.
const storageKey = (pair: string) => `dashboardDirection:${pair}`;

function readStored(pair: string): Direction | null {
  try {
    const d = JSON.parse(localStorage.getItem(storageKey(pair)) ?? "null") as Partial<Direction> | null;
    return d?.from && d.to ? { from: d.from, to: d.to } : null;
  } catch {
    return null;
  }
}

export const sameDirection = (d: DirectionSummary, s: Direction | null) =>
  s !== null && d.fromLanguage === s.from && d.toLanguage === s.to;

// Which part of the deck to show: one direction of the language pair being learned, or null for
// both. Remembered between visits (for each pair) and shared by the dashboard and the deck page.
// Until the user's directions are known the remembered choice is trusted (so the first requests are
// the right ones); once known, a direction the user has no cards in falls back to all.
export function useDeckFilter(directions: DirectionSummary[] | undefined) {
  const { pair } = useActiveLanguages();
  // Choices made on this visit, by pair; anything else is what was remembered.
  const [made, setMade] = useState<Record<string, Direction | null>>({});
  const chosen = pair in made ? made[pair]! : readStored(pair);
  const valid = !directions || directions.some((d) => sameDirection(d, chosen));
  const select = (d: Direction | null) => {
    setMade((m) => ({ ...m, [pair]: d }));
    try {
      localStorage.setItem(storageKey(pair), JSON.stringify(d));
    } catch {
      // Storage can be unavailable; the choice just won't be remembered.
    }
  };
  return { selected: valid ? chosen : null, select };
}

// "EN → NL", for compact labels.
export const shortDirection = (d: { fromLanguage: string; toLanguage: string }) =>
  `${d.fromLanguage.toUpperCase()} → ${d.toLanguage.toUpperCase()}`;
