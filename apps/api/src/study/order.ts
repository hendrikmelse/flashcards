/**
 * Mixes new cards in among the cards already ranked for study. The new cards are
 * spread evenly through the first half of the queue (or the first N slots, when
 * there are more than half as many new cards as total), so they are well
 * represented early and leave the rest of the session free for cards that come
 * back after an "Again".
 *
 * Both lists keep their own order.
 */
export function interleaveNew<T>(newItems: T[], others: T[]): T[] {
  const n = newItems.length;
  if (n === 0) return others;
  if (others.length === 0) return newItems;

  const total = n + others.length;
  const front = Math.max(n, Math.ceil(total / 2));
  // `front >= n`, so these positions are strictly increasing and all below `front`.
  const slots = new Set(newItems.map((_, i) => Math.floor(((i + 0.5) * front) / n)));

  const out: T[] = [];
  let nextNew = 0;
  let nextOther = 0;
  for (let i = 0; i < total; i++) {
    out.push(slots.has(i) ? newItems[nextNew++]! : others[nextOther++]!);
  }
  return out;
}
