// Domain rules shared by the full render and the in-place patch, so the two can never disagree.

import { findPlayer, normalizeName } from "./names.js";
import { state } from "./state.js";

const BOX_KEY = { PTS: "PTS", REB: "REB", AST: "AST", "3PT": "3PM", STL: "STL", BLK: "BLK" };

export function liveGame(gameKey) {
  const g = state.live.games[gameKey];
  return g && (g.state === "in" || g.state === "post") ? g : null;
}

export function playerStats(gameKey, name) {
  return findPlayer(liveGame(gameKey)?.players, name);
}

/**
 * Why a player is out tonight (ESPN's injury report, or did-not-play in the box score), or null.
 * Exact names only: a last-name fallback against a short "out" list could match a teammate who
 * is playing (Jalen vs Jaylin Williams).
 */
export function playerOut(gameKey, name) {
  return liveGame(gameKey)?.out?.[normalizeName(name)] ?? null;
}

export function statValue(stats, stat) {
  return stat === "STL+BLK" ? stats.STL + stats.BLK : stats[BOX_KEY[stat]];
}

/** Live stat for a prop leg, or null if not playing yet. */
export function legProgress(leg) {
  if (!leg.player || !leg.stat) return null;
  const stats = playerStats(leg.game, leg.player);
  return stats ? statValue(stats, leg.stat) : null;
}

/** Everything a price button shows. `leg` must come from state.byTicker (it carries .game). */
export function chipState(leg, group) {
  const disabled = leg.ask == null || leg.ask <= 0 || leg.ask >= 100;
  const progress = legProgress(leg);
  return {
    on: state.picks[group]?.ticker === leg.ticker,
    disabled,
    thin: leg.bid != null && leg.ask != null && leg.ask - leg.bid >= 10,  // wide spread = few trades
    hit: progress != null && progress >= leg.line,
    price: disabled ? "–" : String(leg.ask),
  };
}

/** Kalshi game status -> badge kind. Only "scheduled" and "inprogress" have been seen so far. */
export function statusKind(status) {
  const s = (status || "").toLowerCase();
  if (!s || s === "scheduled" || s === "created") return null;
  if (["live", "in_progress", "inprogress", "started"].includes(s)) return "live";
  if (["closed", "complete", "completed", "final", "ended"].includes(s)) return "final";
  return "other";
}
