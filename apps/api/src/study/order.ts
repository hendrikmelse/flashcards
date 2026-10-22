/**
 * Chooses which of the new cards, already in the order they should come, a session offers: up to
 * `limit` of them, and no word in both directions while there is another word to show. Each word
 * gets its first card in the order, then, if there is still room, the second ones follow in order.
 * (A word's other direction is meant to wait until the day after the first one is shown, so two
 * directions of one word are only offered together when there is nothing else new.)
 *
 * A card marked `held` (its word's other direction was first shown today) is never one of the
 * first cards: it comes after all the others.
 *
 * `candidates` must hold at least `2 * limit` of the cards, or all of them: that is always enough
 * to find `limit` different words if there are that many.
 */
export function pickNew<T extends { conceptId: string; held?: boolean }>(candidates: T[], limit: number): T[] {
  const seen = new Set<string>();
  const first: T[] = [];
  const rest: T[] = [];
  for (const card of candidates) {
    if (first.length < limit && !card.held && !seen.has(card.conceptId)) {
      seen.add(card.conceptId);
      first.push(card);
    } else {
      rest.push(card);
    }
  }
  return [...first, ...rest].slice(0, limit);
}
