// Pure display helpers: no state, no DOM.

const TEAM = {
  ATL: "Hawks", BOS: "Celtics", BKN: "Nets", CHA: "Hornets", CHI: "Bulls", CLE: "Cavaliers",
  DAL: "Mavericks", DEN: "Nuggets", DET: "Pistons", GSW: "Warriors", HOU: "Rockets", IND: "Pacers",
  LAC: "Clippers", LAL: "Lakers", MEM: "Grizzlies", MIA: "Heat", MIL: "Bucks", MIN: "Timberwolves",
  NOP: "Pelicans", NYK: "Knicks", OKC: "Thunder", ORL: "Magic", PHI: "76ers", PHX: "Suns",
  POR: "Trail Blazers", SAC: "Kings", SAS: "Spurs", TOR: "Raptors", UTA: "Jazz", WAS: "Wizards",
};

export const teamName = (code) => TEAM[code] || code;

// Pictures come from ESPN's image server, resized there. ESPN's team codes, where they differ:
const ESPN_CODE = { GSW: "gs", NOP: "no", NYK: "ny", SAS: "sa", UTA: "utah", WAS: "wsh" };
const IMG = 'alt="" loading="lazy" onerror="this.remove()"';  // no picture: just leave it out
const initials = (name) => name.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).slice(0, 2).map((w) => w[0]).join("");
export const logoURL = (team) =>
  `https://a.espncdn.com/combiner/i?img=/i/teamlogos/nba/500/${ESPN_CODE[team] || String(team).toLowerCase()}.png&w=64&h=64`;
export const logoHTML = (team) => `<img class="logo" src="${esc(logoURL(team))}" ${IMG}>`;
// The frame stays when there's no photo (showing initials), so the layout doesn't shift.
// v: bump when the server's photo size changes (browsers keep the redirect for a day).
export const headshotHTML = (team, name, cls = "headshot") =>
  `<span class="${cls}" data-i="${esc(initials(name))}"><img src="/api/headshot?${esc(new URLSearchParams({ team, name, v: 3 }))}" `
  + `alt="" loading="lazy" onerror="this.parentNode.classList.add('none'); this.remove()"></span>`;

// Text from Kalshi or ESPN, made safe to put inside HTML (and attribute values). Applied where
// it's inserted, not on arrival: names stay as-is for matching (De'Aaron Fox vs ESPN's box score).
const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ENTITIES[c]);
export const gameLabel = (g) => `${esc(g.away)} @ ${esc(g.home)}`;
export const usd = (x) => "$" + Number(x).toFixed(2);
export const cents = (c) => (c == null ? "–" : `${c}¢`);
export const percent = (p, digits = 1) => (p * 100).toFixed(digits);
export const handicap = (h) => (h > 0 ? "+" : "−") + Math.abs(h);

export const tipTime = (g) =>
  g.start ? new Date(g.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";

// Kalshi game keys start with the date: "26OCT21ATLORL" -> day "26OCT21" -> "Oct 21"
export const dayOf = (gameKey) => gameKey.slice(0, 7);
export const dayLabel = (day) => day.charAt(2) + day.slice(3, 5).toLowerCase() + " " + day.slice(5, 7);
