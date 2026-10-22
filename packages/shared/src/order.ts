/** A small seeded random number generator (mulberry32), for shuffling that has to be repeatable in tests. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The fewest and the most other cards between two new cards. */
export const MIN_GAP = 1;
export const MAX_GAP = 3;

/**
 * Mixes new cards in among the cards already ranked for study: from the front of the queue, each new
 * card is followed by 1, 2 or 3 (at random) of the others, until the new cards run out. The rest of
 * the others follow. If the others run out first, the remaining new cards come one after another.
 * With `othersFirst`, the queue opens with a gap too, so it does not begin with a new card.
 *
 * Both lists keep their own order. `random` returns numbers in [0, 1).
 */
export function interleaveNew<T>(
  newItems: T[],
  others: T[],
  random: () => number,
  { othersFirst = false }: { othersFirst?: boolean } = {},
): T[] {
  const out: T[] = [];
  let nextOther = 0;
  const takeGap = () => {
    const gap = MIN_GAP + Math.floor(random() * (MAX_GAP - MIN_GAP + 1));
    const end = Math.min(others.length, nextOther + gap);
    while (nextOther < end) out.push(others[nextOther++]!);
  };
  newItems.forEach((item, i) => {
    if (i > 0 || othersFirst) takeGap();
    out.push(item);
  });
  while (nextOther < others.length) out.push(others[nextOther++]!);
  return out;
}
