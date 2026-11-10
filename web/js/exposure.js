// How much of tonight you already own: for each line on the board, the open parlays that have it
// (the corner badge on its chip), and for each player, the open parlays with any of their lines.
// Rebuilt from My bets' data whenever it loads; parlays that already lost don't count.

let byLine = new Map();    // buy ticker ("…-25" or "…:no") -> { n }
let byPlayer = new Map();  // "game|player" -> parlay count

/** `lost(p)`: whether a parlay is already dead (settled against you). */
export function setExposure(parlays, lost) {
  byLine = new Map();
  byPlayer = new Map();
  for (const p of parlays) {
    if (lost(p)) continue;
    for (const t of new Set(p.legs.map((l) => l.buy_ticker))) {
      byLine.set(t, { n: (byLine.get(t)?.n ?? 0) + 1 });
    }
    for (const key of new Set(p.legs.filter((l) => l.player).map((l) => `${l.game}|${l.player}`))) {
      byPlayer.set(key, (byPlayer.get(key) ?? 0) + 1);
    }
  }
}

export const lineExposure = (ticker) => byLine.get(ticker) ?? null;
export const playerExposure = (game, player) => byPlayer.get(`${game}|${player}`) ?? 0;
