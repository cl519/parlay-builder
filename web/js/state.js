// App state and the only code that changes it.
//
// picks: group key -> leg. One pick per group, mirroring Kalshi's combo rules:
//   "ml|GAME"  "spr|GAME"  "tot|GAME"  "p|GAME|PLAYER|STAT"

import { dayOf } from "./format.js";

export const STATS = ["PTS", "REB", "AST", "3PT", "STL", "BLK", "STL+BLK"];
const STORAGE_KEY = "picks";

export const state = {
  games: [],          // menus from /api/games, ordered by tip-off
  byTicker: {},       // ticker -> leg (with .game) for every visible market
  groupOf: {},        // ticker -> its slip group
  picks: readPicks(),
  day: null,          // "26OCT21"
  live: { games: {} } // /api/live: scores + box scores keyed by Kalshi player name
};

function readPicks() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
}

function writePicks() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.picks)); } catch { /* private mode */ }
}

export const days = () => [...new Set(state.games.map((g) => dayOf(g.key)))];
export const visibleGames = () => state.games.filter((g) => dayOf(g.key) === state.day);
export const pickCount = (gameKey) => Object.values(state.picks).filter((p) => p.game === gameKey).length;
export const pickedLegs = () => Object.values(state.picks);

export function allLegs(g) {
  return [...g.ml, ...g.spread, ...g.total, ...g.players.flatMap((p) => STATS.flatMap((s) => p[s]))];
}

/** [group, leg] for every leg of a game (the same groups the board's chips use). */
function groupedLegs(g) {
  return [
    ...g.ml.map((l) => [`ml|${g.key}`, l]),
    ...g.spread.map((l) => [`spr|${g.key}`, l]),
    ...g.total.map((l) => [`tot|${g.key}`, l]),
    ...g.players.flatMap((p) => STATS.flatMap((s) => p[s].map((l) => [`p|${g.key}|${p.name}|${s}`, l]))),
  ];
}

/** New menus arrived: index every leg, refresh picked legs' prices, drop picks whose market closed. */
export function setMenus(games) {
  state.games = games;
  state.byTicker = {};
  state.groupOf = {};
  for (const g of games) {
    for (const [group, leg] of groupedLegs(g)) {
      state.byTicker[leg.ticker] = { ...leg, game: g.key };
      state.groupOf[leg.ticker] = group;
    }
  }
  for (const [group, leg] of Object.entries(state.picks)) {
    if (state.byTicker[leg.ticker]) state.picks[group] = { ...leg, ...state.byTicker[leg.ticker] };
    else delete state.picks[group];
  }
  writePicks();
  if (!days().includes(state.day)) state.day = days()[0] || null;
}

export function setDay(day) { state.day = day; }
export function setLive(live) { state.live = live; }

export function togglePick(group, ticker) {
  if (state.picks[group]?.ticker === ticker) delete state.picks[group];
  else state.picks[group] = { ...state.byTicker[ticker], ticker };
  writePicks();
}

export function removePick(group) { delete state.picks[group]; writePicks(); }
export function clearPicks() { state.picks = {}; writePicks(); }

/** Replace the slip with these legs (":no" tickers for NO sides). Returns how many were still on the board. */
export function loadPicks(tickers) {
  state.picks = {};
  for (const t of tickers) if (state.groupOf[t]) state.picks[state.groupOf[t]] = { ...state.byTicker[t], ticker: t };
  writePicks();
  return Object.keys(state.picks).length;
}

/** Another tab changed the slip: adopt it instead of overwriting it on our next save. */
export function onPicksChangedElsewhere(callback) {
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY) return;
    state.picks = readPicks();
    callback();
  });
}
