import { and, eq, or, type SQL } from "drizzle-orm";
import { pairLanguages, type Scope } from "@flashcards/shared";
import type { userCards } from "../db/schema.js";

type Cards = typeof userCards;

/**
 * The language pair a scope is about, as two codes: the pair itself, or the languages of the
 * direction. Null for no scope at all (every deck).
 */
export function pairOf(scope: Scope): [string, string] | null {
  if (scope.pair) return pairLanguages(scope.pair);
  if (scope.fromLanguage && scope.toLanguage) return [scope.fromLanguage, scope.toLanguage];
  return null;
}

/** Cards of the language pair, in either direction. */
export function inPair(cards: Cards, pair: [string, string]): SQL | undefined {
  const [a, b] = pair;
  return or(
    and(eq(cards.fromLanguage, a), eq(cards.toLanguage, b)),
    and(eq(cards.fromLanguage, b), eq(cards.toLanguage, a)),
  );
}

/** The cards a scope covers: its pair, narrowed to its direction if it has one. */
export function inScope(cards: Cards, scope: Scope): SQL | undefined {
  const pair = pairOf(scope);
  return and(
    pair ? inPair(cards, pair) : undefined,
    scope.fromLanguage ? eq(cards.fromLanguage, scope.fromLanguage) : undefined,
    scope.toLanguage ? eq(cards.toLanguage, scope.toLanguage) : undefined,
  );
}
