// Pure decisions behind the My bets layout (no DOM, so they're unit-tested): which column a
// card goes in, how legs re-sort without flip-flopping, and which card a stack belongs to.

export const CARD_MIN_WIDTH = 520;
export const COLUMN_GAP = 16;
export const MAX_COLUMNS = 3;

/** How many card columns fit in `width` px (at least one). */
export function columnCount(width) {
  return Math.max(1, Math.min(MAX_COLUMNS, Math.floor((width + COLUMN_GAP) / (CARD_MIN_WIDTH + COLUMN_GAP))));
}

/** The column the next card goes in: the shortest one, leftmost on a tie. */
export function shortestColumn(heights) {
  return heights.reduce((best, h, i) => (h < heights[best] ? i : best), 0);
}

/**
 * Re-sort `prev` (ids) by `rank` (lower first), but only move an id above another when its
 * rank is lower by at least `margin`, so near-ties stay put instead of swapping every poll.
 * margin 0 = a plain stable sort. Returns a new array.
 *
 * Bubble passes with a threshold: each swap fixes one pair that's out of order by more than
 * the margin and leaves every other pair's order alone, so it always finishes.
 */
export function stickyOrder(prev, rank, margin = 0) {
  const order = [...prev];
  const r = new Map(order.map((id) => [id, rank(id)]));
  for (let moved = true; moved;) {
    moved = false;
    for (let i = 0; i + 1 < order.length; i++) {
      if (r.get(order[i + 1]) < r.get(order[i]) - margin) {
        [order[i], order[i + 1]] = [order[i + 1], order[i]];
        moved = true;
      }
    }
  }
  return order;
}

/**
 * Match the latest stacks to the cards on screen by the parlays they share, so a card keeps
 * its place as long as any of its parlays is still in a stack. `cards`: Map key -> tickers,
 * `stacks`: arrays of tickers. Returns Map stack index -> card key; unmatched stacks are new.
 * Biggest overlaps are matched first, and each card and stack is used at most once.
 */
export function matchCards(cards, stacks) {
  const pairs = [];
  stacks.forEach((tickers, i) => {
    const mine = new Set(tickers);
    for (const [key, members] of cards) {
      const shared = members.filter((t) => mine.has(t)).length;
      if (shared) pairs.push({ i, key, shared });
    }
  });
  pairs.sort((a, b) => b.shared - a.shared);
  const out = new Map(), used = new Set();
  for (const { i, key } of pairs) {
    if (out.has(i) || used.has(key)) continue;
    out.set(i, key);
    used.add(key);
  }
  return out;
}
