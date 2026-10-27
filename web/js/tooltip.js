// Hover tooltips: bid/ask detail on every price button, explanation on the "Thin market" legend,
// and a player's last 5 games + season averages on their name.

import { getJSON } from "./api.js";
import { esc, espnAbbr, headshotHTML, logoHTML, teamName } from "./format.js";
import { liveGame, playerStats } from "./markets.js";
import { state } from "./state.js";

const LEGEND_TEXT = '<div class="tt">Thin market</div>Few trades on this line, so the bid and ask are 10¢+ apart '
  + "and the button price is less reliable. Hover any button to see its bid and ask.";
const TARGETS = ".chip[data-t], #legend, .pname[data-team]";
// Columns of the game log: a stat, or [made, tried] shown as "5/12"
const LOG_STATS = ["MIN", "PTS", "REB", "AST", ["FG", "FGM", "FGA"], ["3PT", "3PM", "3PA"], "STL", "BLK"];
const BOARD_ROWS = 5;  // on Build, always 5 game rows (dashes if fewer), so every player is the same height
const headCell = (s) => `<th>${Array.isArray(s) ? s[0] : s}</th>`;
const statCells = (row, fmt) => LOG_STATS.map((s) =>
  `<td>${esc(Array.isArray(s) ? `${fmt(row[s[1]])}/${fmt(row[s[2]])}` : fmt(row[s]))}</td>`).join("");

let el, timer, current = null;  // current: the element the tooltip is for (async content checks it)

function position(target) {
  el.classList.remove("below");
  const r = target.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
  let top = r.top - h - 10;
  if (top < 8) { top = r.bottom + 10; el.classList.add("below"); }
  el.style.left = left + "px";
  el.style.top = top + "px";
  el.style.setProperty("--ax", r.left + r.width / 2 - left + "px");
}

function show(target, html) {
  el.innerHTML = html;
  el.classList.toggle("wide", target.matches(".pname"));
  position(target);
  el.classList.add("show");
}

function hide() {
  clearTimeout(timer);
  current = null;
  el.classList.remove("show");
}

function chipHTML(chip) {
  const leg = state.byTicker[chip.dataset.t];
  if (!leg) return "";
  const { bid, ask } = leg;
  const hasAsk = ask != null && ask > 0 && ask < 100;
  const hasBid = bid != null && bid > 0;
  const row = (k, v) => `<span>${k}</span><span>${v}</span>`;
  let html = `<div class="tt">${esc(leg.label)}</div><div class="grid">`
    + row("Ask (you buy at)", hasAsk ? `${ask}¢` : "none")
    + row("Bid", hasBid ? `${bid}¢` : "none")
    + (hasAsk && hasBid ? row("Midpoint", `~${Math.round((bid + ask) / 2)}¢`) : "")
    + "</div>";
  if (chip.classList.contains("thin")) {
    html += `<div class="warn">Thin market: ${ask - bid}¢ gap, so the ask overstates the price. `
      + "Your parlay's live price is set by makers, not this number.</div>";
  }
  return html;
}

/**
 * A player's last 5 games and season average as a table: the hover card, and (board) beside each
 * player's photo on Build, where it has no dates, a "Last 5 games" label and always 5 game rows.
 * `live`: tonight's game (see liveRow), shown as the top row.
 */
export function logTableHTML(log, board = false, live = null) {
  if (log.missing) return `<div class="muted">Not found on ESPN's roster.</div>`;
  if (!log.played) return `<div class="muted">No regular-season games yet.</div>`;
  const day = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
  // On Build tonight's game takes one of the 5 rows, so the table stays the same height
  const tonight = live && (live.stats || board);
  const games = board && tonight ? log.games.slice(0, BOARD_ROWS - 1) : log.games;
  let rows = games.map((g) => `<tr>${board ? "" : `<td class="d">${day(g.date)}</td>`}`
    + `<td class="d">${g.at ? "@" : "vs"} ${esc(g.opp)} <i class="${g.result === "W" ? "w" : "l"}">${esc(g.result)}</i></td>`
    + `${statCells(g, String)}</tr>`).join("");
  const lead = board ? 1 : 2;  // label columns before the stats
  // Tonight on top, a row like the games below with LIVE where the W/L goes. On Build every
  // player in the game gets it (dashes until he plays), so they stay the same height.
  if (tonight) {
    const cls = live.result === "LIVE" ? "live" : live.result === "W" ? "w" : "l";
    const cells = live.stats ? statCells(live.stats, String) : LOG_STATS.map(() => "<td>–</td>").join("");
    rows = `<tr class="tonight">${board ? "" : '<td class="d">Today</td>'}`
      + `<td class="d">${live.at ? "@" : "vs"} ${esc(live.opp)} <i class="${cls}">${live.result}</i></td>${cells}</tr>${rows}`;
  }
  // On Build: games not played yet are rows of dashes, so the average always sits at the bottom
  const none = `<tr class="none"><td class="d">–</td>${LOG_STATS.map(() => "<td>–</td>").join("")}</tr>`;
  if (board) rows += none.repeat(Math.max(0, BOARD_ROWS - games.length - (tonight ? 1 : 0)));
  const corner = board ? '<th class="cap">Last 5 games</th>' : "<th></th><th></th>";
  return `<table class="log"><tr>${corner}${LOG_STATS.map(headCell).join("")}</tr>${rows}`
    + `<tr class="avg"><td colspan="${lead}">${board ? "Avg" : `Season avg <span class="muted">(${log.played} GP)</span>`}</td>`
    + `${statCells(log.avg, (x) => x.toFixed(1))}</tr></table>`;
}

const logLabel = (log) => (!log.played ? "" : log.played === 1 ? " · Only game" : log.played <= 5 ? ` · All ${log.played} games` : " · Last 5");

const etDay = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const MONTHS = "JANFEBMARAPRMAYJUNJULAUGSEPOCTNOVDEC";
const keyDay = (key) => `20${key.slice(0, 2)}-${String(MONTHS.indexOf(key.slice(2, 5)) / 3 + 1).padStart(2, "0")}-${key.slice(5, 7)}`;

/**
 * Tonight's game for the top of the table, read like the games below it: { at, opp, result,
 * stats }, result "LIVE" while it's on and W/L once final (stats null if he hasn't played). Null
 * before tip-off, and once ESPN's game log has the game.
 */
export function liveRow(gameKey, team, name, log) {
  const g = gameKey && liveGame(gameKey);
  if (!g || (g.state === "post" && log?.games?.[0] && etDay(log.games[0].date) === keyDay(gameKey))) return null;
  const away = gameKey.slice(-6, -3), home = gameKey.slice(-3), at = team === away;
  const mine = at ? g.away_score : g.home_score, theirs = at ? g.home_score : g.away_score;
  const result = g.state === "in" ? "LIVE" : mine > theirs ? "W" : "L";
  return { at, opp: espnAbbr(at ? home : away), result, stats: playerStats(gameKey, name) };
}

function playerLogHTML(rawName, team, log, live) {
  return `<div class="tt">${headshotHTML(team, rawName)}${esc(rawName)} <span class="muted">· ${logoHTML(team)}${esc(teamName(team))}${logLabel(log)}</span></div>`
    + logTableHTML(log, false, live);
}

async function showPlayer(target) {
  const name = target.textContent;
  current = target;
  show(target, `<div class="tt">${esc(name)}</div><div class="muted">Loading recent games…</div>`);
  let html;
  try {
    const q = new URLSearchParams({ team: target.dataset.team, name });
    const log = await getJSON(`/api/player?${q}`);
    html = playerLogHTML(name, target.dataset.team, log, liveRow(target.dataset.game, target.dataset.team, name, log));
  } catch (e) {
    html = `<div class="tt">${esc(name)}</div><div class="muted">Couldn't load games: ${esc(e.message)}</div>`;
  }
  if (current === target) show(target, html);  // still hovering this name
}

export function installTooltips() {
  el = document.getElementById("tooltip");
  document.addEventListener("mouseover", (e) => {
    const target = e.target.closest(TARGETS);
    if (!target) return;
    clearTimeout(timer);
    if (target === current) return;
    if (target.matches(".pname")) {
      timer = setTimeout(() => showPlayer(target), 250);
      return;
    }
    const isChip = target.matches(".chip");
    timer = setTimeout(() => {
      current = target;
      show(target, isChip ? chipHTML(target) : LEGEND_TEXT);
    }, isChip ? 250 : 100);
  });
  document.addEventListener("mouseout", (e) => {
    if (e.target.closest(TARGETS) && !e.relatedTarget?.closest?.(TARGETS)) hide();
  });
  window.addEventListener("scroll", hide, true);
  document.addEventListener("click", hide, true);
}
