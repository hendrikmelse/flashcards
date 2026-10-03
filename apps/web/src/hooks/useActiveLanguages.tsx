import { createContext, useContext } from "react";
import { ADD_WORDS_DIRECTION, pairKey } from "@flashcards/shared";
import type { Direction } from "../api/packs";

export type ActiveLanguages = {
  /** What the user is learning, prompt language first. The Add words pages show it. */
  direction: Direction;
  /** The same words the other way round. */
  otherWay: Direction;
  /**
   * The language pair, as the key the API takes (such as "en-nl"). Each pair is a deck of its own,
   * so everything about the deck is asked for with it, and it is part of the cache key of every query
   * about the deck.
   */
  pair: string;
  /** Saves a new direction to the account. */
  setDirection: (d: Direction) => void;
};

/** Both languages are in the list and they differ. */
export const isValidDirection = (
  languages: readonly string[],
  d: Partial<Direction> | null | undefined,
): d is Direction =>
  !!d && !!d.from && !!d.to && languages.includes(d.from) && languages.includes(d.to) && d.from !== d.to;

export const makeActiveLanguages = (direction: Direction, setDirection: (d: Direction) => void): ActiveLanguages => ({
  direction,
  otherWay: { from: direction.to, to: direction.from },
  pair: pairKey(direction.from, direction.to),
  setDirection,
});

// Without a provider (signed out, or a component on its own) it is the default direction.
export const ActiveLanguagesContext = createContext<ActiveLanguages>(
  makeActiveLanguages({ ...ADD_WORDS_DIRECTION }, () => {}),
);

/** The language pair and direction being learned. The provider is ActiveLanguagesProvider. */
export const useActiveLanguages = () => useContext(ActiveLanguagesContext);
