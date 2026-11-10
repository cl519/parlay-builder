// Who to suggest as you type in Fraud Watch. Pure, so it can be tested.

import { teamName } from "./format.js";
import { normalizeName } from "./names.js";
import { STATS } from "./state.js";

export const TEAMS = ["ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW", "HOU", "IND", "LAC", "LAL", "MEM",
  "MIA", "MIL", "MIN", "NOP", "NYK", "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS"];

// What else people call a team: its city, and nicknames.
const ALIASES = {
  ATL: "Atlanta", BOS: "Boston Celtics", BKN: "Brooklyn", CHA: "Charlotte", CHI: "Chicago", CLE: "Cleveland Cavs",
  DAL: "Dallas Mavs", DEN: "Denver", DET: "Detroit", GSW: "Golden State Dubs", HOU: "Houston", IND: "Indiana",
  LAC: "LA Los Angeles Clips", LAL: "LA Los Angeles", MEM: "Memphis Grizz", MIA: "Miami", MIL: "Milwaukee",
  MIN: "Minnesota Wolves", NOP: "New Orleans Pels", NYK: "New York", OKC: "Oklahoma City", ORL: "Orlando",
  PHI: "Philadelphia Philly Sixers", PHX: "Phoenix", POR: "Portland Blazers", SAC: "Sacramento", SAS: "San Antonio",
  TOR: "Toronto", UTA: "Utah", WAS: "Washington Wiz",
};

export const MAX_SUGGESTIONS = 5;

/**
 * Up to 5 teams (by code, name, city or nickname) and players matching `query`, leaving out
 * who's already listed. Players: anyone on a board's menu (any day) plus `roster`, every NBA
 * player (so someone without a game soon can still be added). Names with a word starting with
 * what you typed come first; then teams before players, and players on the board, starters
 * (the most prop lines) first, before the rest of the league.
 */
export function suggestFrauds(games, query, listed = [], roster = []) {
  const q = normalizeName(query);
  if (!q) return [];
  const starts = (text) => normalizeName(text).split(" ").some((w) => w.startsWith(q));
  const has = (text) => normalizeName(text).includes(q);
  const taken = new Set(listed.map((e) => (e.kind === "team" ? `t|${e.team}` : `p|${normalizeName(e.name)}`)));
  const teams = TEAMS.filter((t) => !taken.has(`t|${t}`) && (t.toLowerCase().startsWith(q) || has(`${ALIASES[t]} ${teamName(t)}`)))
    .map((t) => ({ kind: "team", team: t, rank: t.toLowerCase().startsWith(q) || starts(`${ALIASES[t]} ${teamName(t)}`) ? 0 : 1, n: Infinity }));
  const players = new Map();  // normalized name -> suggestion; the board's spelling wins (it's Kalshi's)
  const offer = (name, team, n) => {
    const key = normalizeName(name);
    if (players.has(key) || taken.has(`p|${key}`) || !has(name)) return;
    players.set(key, { kind: "player", name, team, rank: starts(name) ? 0 : 1, n });
  };
  for (const g of games) for (const p of g.players) offer(p.name, p.team, STATS.reduce((a, s) => a + p[s].length, 0));
  for (const p of roster) offer(p.name, p.team, 0);
  return [...teams, ...players.values()].sort((a, b) => a.rank - b.rank || b.n - a.n).slice(0, MAX_SUGGESTIONS);
}
