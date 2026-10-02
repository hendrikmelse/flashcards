import { useState } from "react";
import type { DirectionSummary } from "@flashcards/shared";
import type { Direction } from "../api/packs";

const STORAGE_KEY = "dashboardDirection";

function readStored(): Direction | null {
  try {
    const d = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Direction> | null;
    return d?.from && d.to ? { from: d.from, to: d.to } : null;
  } catch {
    return null;
  }
}

export const sameDirection = (d: DirectionSummary, s: Direction | null) =>
  s !== null && d.fromLanguage === s.from && d.toLanguage === s.to;

// Which deck to show: one direction, or null for all of them. Remembered between
// visits and shared by the dashboard and the deck page. Until the user's
// directions are known the remembered choice is trusted (so the first requests
// are the right ones); once known, a direction the user has no cards in falls
// back to all.
export function useDeckFilter(directions: DirectionSummary[] | undefined) {
  const [chosen, setChosen] = useState<Direction | null>(readStored);
  const valid = !directions || directions.some((d) => sameDirection(d, chosen));
  const select = (d: Direction | null) => {
    setChosen(d);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
    } catch {
      // Storage can be unavailable; the choice just won't be remembered.
    }
  };
  return { selected: valid ? chosen : null, select };
}

// "EN → NL", for compact labels.
export const shortDirection = (d: { fromLanguage: string; toLanguage: string }) =>
  `${d.fromLanguage.toUpperCase()} → ${d.toLanguage.toUpperCase()}`;
