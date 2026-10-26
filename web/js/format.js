// Pure display helpers: no state, no DOM.

const TEAM = {
  ATL: "Hawks", BOS: "Celtics", BKN: "Nets", CHA: "Hornets", CHI: "Bulls", CLE: "Cavaliers",
  DAL: "Mavericks", DEN: "Nuggets", DET: "Pistons", GSW: "Warriors", HOU: "Rockets", IND: "Pacers",
  LAC: "Clippers", LAL: "Lakers", MEM: "Grizzlies", MIA: "Heat", MIL: "Bucks", MIN: "Timberwolves",
  NOP: "Pelicans", NYK: "Knicks", OKC: "Thunder", ORL: "Magic", PHI: "76ers", PHX: "Suns",
  POR: "Trail Blazers", SAC: "Kings", SAS: "Spurs", TOR: "Raptors", UTA: "Jazz", WAS: "Wizards",
};

export const teamName = (code) => TEAM[code] || code;
export const gameLabel = (g) => `${g.away} @ ${g.home}`;
export const usd = (x) => "$" + Number(x).toFixed(2);
export const cents = (c) => (c == null ? "–" : `${c}¢`);
export const percent = (p, digits = 1) => (p * 100).toFixed(digits);
export const handicap = (h) => (h > 0 ? "+" : "−") + Math.abs(h);

export const tipTime = (g) =>
  g.start ? new Date(g.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";

// Kalshi game keys start with the date: "26OCT21ATLORL" -> day "26OCT21" -> "Oct 21"
export const dayOf = (gameKey) => gameKey.slice(0, 7);
export const dayLabel = (day) => day.charAt(2) + day.slice(3, 5).toLowerCase() + " " + day.slice(5, 7);
