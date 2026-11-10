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

/**
 * Teams (by code, name, city or nickname) and players (anyone on a board's menu, any day) matching `query`,
 * leaving out who's already listed. Teams first, then players whose name has a word starting
 * with what you typed, then the rest; starters (the most prop lines) before bench players.
 */
export function suggestFrauds(games, query, listed = []) {
  const q = normalizeName(query);
  if (!q) return [];
  const starts = (text) => normalizeName(text).split(" ").some((w) => w.startsWith(q));
  const has = (text) => normalizeName(text).includes(q);
  const taken = new Set(listed.map((e) => (e.kind === "team" ? `t|${e.team}` : `p|${e.name}`)));
  const teams = TEAMS.filter((t) => !taken.has(`t|${t}`) && (t.toLowerCase().startsWith(q) || has(`${ALIASES[t]} ${teamName(t)}`)))
    .map((t) => ({ kind: "team", team: t, rank: 0 }));
  const players = new Map();
  for (const g of games) {
    for (const p of g.players) {
      if (players.has(p.name) || taken.has(`p|${p.name}`) || !has(p.name)) continue;
      players.set(p.name, { kind: "player", name: p.name, team: p.team, rank: starts(p.name) ? 0 : 1, n: STATS.reduce((a, s) => a + p[s].length, 0) });
    }
  }
  const byRank = (a, b) => a.rank - b.rank || (b.n ?? 0) - (a.n ?? 0);
  return [...teams.sort(byRank), ...[...players.values()].sort(byRank)].slice(0, 8);
}
