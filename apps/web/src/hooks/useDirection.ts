import { useCallback } from "react";
import { useSearchParams } from "react-router";
import type { LanguageInfo } from "@flashcards/shared";
import type { Direction } from "../api/packs";

const STORAGE_KEY = "direction";

function readStored(): Partial<Direction> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<Direction>;
  } catch {
    return {};
  }
}

function writeStored(d: Direction) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
  } catch {
    // Storage can be unavailable (private mode); the URL still carries the choice.
  }
}

// The study direction (prompt language -> answer language). Lives in the URL
// (?from=en&to=nl) so it is shareable and survives navigation; falls back to
// the last choice, then to the first two languages.
export function useDirection(languages: LanguageInfo[]) {
  const [params, setParams] = useSearchParams();

  const valid = (d: Partial<Direction>): d is Direction =>
    !!d.from &&
    !!d.to &&
    d.from !== d.to &&
    languages.some((l) => l.code === d.from) &&
    languages.some((l) => l.code === d.to);

  const fromUrl = { from: params.get("from") ?? undefined, to: params.get("to") ?? undefined };
  const stored = readStored();
  const direction: Direction = valid(fromUrl)
    ? fromUrl
    : valid(stored)
      ? stored
      : { from: languages[0]?.code ?? "", to: languages[1]?.code ?? "" };

  const setDirection = useCallback(
    (d: Direction) => {
      writeStored(d);
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("from", d.from);
          next.set("to", d.to);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const search = `?from=${encodeURIComponent(direction.from)}&to=${encodeURIComponent(direction.to)}`;
  return { direction, setDirection, search };
}
