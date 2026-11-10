// The game list: full render when the set of markets changes, in-place patch for everything else
// (prices, live stats, scores) so scroll positions, momentum and tooltips are never disturbed.

import { getJSON } from "./api.js";
import { esc, handicap, logoHTML, teamName, tipTime } from "./format.js";
import { chipState, liveGame, statusKind } from "./markets.js";
import { lineExposure, playerExposure } from "./exposure.js";
import { fraudPlayer, fraudTeam } from "./frauds.js";
import { liveRow, logTableHTML } from "./tooltip.js";
import { STATS, allLegs, pickCount, state, visibleGames } from "./state.js";

const $ = (id) => document.getElementById(id);
let renderedSig = "";

// ---------- HTML pieces ----------

function chipHTML(leg, group, label, extraClass = "") {
  const s = chipState(state.byTicker[leg.ticker], group);
  const cls = ["chip", s.on && "on", s.thin && "thin", s.hit && "hit", extraClass].filter(Boolean).join(" ");
  return `<button class="${cls}" ${s.disabled ? "disabled" : ""} data-t="${esc(leg.ticker)}" data-g="${esc(group)}">`
    + `<span class="ln">${esc(label)}</span><span class="px">${s.price}</span><span class="own">${ownText(leg.ticker)}</span></button>`;
}

// ---------- Already in your parlays ----------
// A small blue badge on a chip's corner: how many open parlays have that exact line. Beside a
// player's name: how many have any of their lines (15+ and 20+ PTS are really the same bet).

const ownText = (ticker) => String(lineExposure(ticker)?.n || "");
const pownText = (game, name) => {
  const n = playerExposure(game, name);
  return n ? `in ${n} ${n === 1 ? "parlay" : "parlays"}` : "";
};

function chipRow(label, rowKey, chips, extraClass = "") {
  return `<div class="row"><span class="lbl">${esc(label)}</span>`
    + `<div class="chips ${extraClass}" data-k="${esc(rowKey)}">${chips}</div></div>`;
}

// ---------- Team records ----------
// Beside each team name: its record ("5-4"); above its players, also seed, streak and (once
// they've played more than 10) last 10. Filled in when the standings arrive.

const ord = (n) => n + ({ 1: "st", 2: "nd", 3: "rd" }[n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || "th");

function recordHTML(team) {
  const r = state.records[team];
  return r?.record ? esc(r.record) : "";
}

function recordFullHTML(team) {
  const r = state.records[team];
  if (!r?.record) return "";
  const played = r.record.split("-").reduce((a, b) => a + Number(b), 0);
  const streak = r.streak ? `<span class="${r.streak[0] === "W" ? "up" : "down"}">${esc(r.streak)}</span>` : "";
  return [esc(r.record), r.seed && `${ord(r.seed)} ${esc(r.conf)}`, played > 10 && r.last10 && `${esc(r.last10)} last 10`, streak]
    .filter(Boolean).join(" · ");
}

const teamSpan = (team) => `<span class="tname" data-team="${esc(team)}">${esc(teamName(team))}</span>`;
const recSpan = (team) => `<span class="rec" data-rec="${esc(team)}">${recordHTML(team)}</span>`;
const recFullSpan = (team) => `<span class="rec" data-recfull="${esc(team)}">${recordFullHTML(team)}</span>`;

// ---------- Your hit rate on each prop line ----------
// Under every player prop chip: how often that line hit on nights you bet it this season
// ("3/5"), or "–/–" if you never have. Small and gray: a footnote to the price, not a button.

const hitKey = (player, stat, line) => `${player}|${stat}|${line}`;

function hitHTML(key) {
  const r = state.hits[key];
  const tip = r ? `Your bets: hit ${r[0]} of ${r[1]} ${r[1] === 1 ? "night" : "nights"} (${Math.round((100 * r[0]) / r[1])}%)`
    : "You haven't bet this line this season";
  return `<span class="hr${r ? "" : " none"}" data-h="${esc(key)}" data-tip="${esc(tip)}">${r ? `${r[0]}/${r[1]}` : "–/–"}</span>`;
}

function propRow(stat, group, legs, player) {
  const cells = legs.map((l) => `<div class="cell">${chipHTML(l, group, `${l.line}+`)}${hitHTML(hitKey(player, stat, l.line))}</div>`).join("");
  return `<div class="row prop"><span class="lbl">${esc(stat)}<small>Hit rate</small></span>`
    + `<div class="chips" data-k="${esc(group)}">${cells}</div></div>`;
}

// ---------- Each player's recent games, beside their photo ----------
// The hover card's table (last 5 games + season average) and the player's position, loaded as
// a player scrolls near the screen and kept for the session (the server refreshes its copy
// every 10 minutes).

const logs = {};  // "team|name" -> game log, once loaded

const posHTML = (log) => (log?.pos ? ` - ${esc(log.pos)}` : "");

/** The table for one player: tonight's game on top while it's on (labeled LIVE), then the last 5. */
function plogHTML(game, team, name) {
  const log = logs[`${team}|${name}`];
  return log ? logTableHTML(log, true, liveRow(game, team, name, log)) : "";
}

function fillLog(el) {
  const plog = el.querySelector(".plog");
  plog.innerHTML = plogHTML(plog.dataset.game, ...el.dataset.log.split("|"));
  el.querySelector(".ppos").innerHTML = posHTML(logs[el.dataset.log]);
}

const loader = new IntersectionObserver((entries) => {
  for (const { target, isIntersecting } of entries) {
    if (!isIntersecting) continue;
    loader.unobserve(target);
    const key = target.dataset.log, i = key.indexOf("|");
    getJSON(`/api/player?${new URLSearchParams({ team: key.slice(0, i), name: key.slice(i + 1) })}`)
      .then((log) => {
        logs[key] = log;
        document.querySelectorAll(`.player[data-log="${CSS.escape(key)}"]`).forEach(fillLog);
      })
      .catch((e) => {
        document.querySelectorAll(`.player[data-log="${CSS.escape(key)}"] .plog`).forEach((p) =>
          (p.innerHTML = `<div class="muted">Couldn't load games: ${esc(e.message)}</div>`));
      });
  }
}, { rootMargin: "800px 0px" });

function headLiveHTML(g) {
  const kind = statusKind(g.status);
  const badge = kind === "live" ? '<span class="badge-live">LIVE</span>'
    : kind === "final" ? '<span class="badge-final">Final</span>'
    : kind === "other" ? `<span class="badge-final">${esc(g.status)}</span>` : "";
  const L = liveGame(g.key);
  const score = L
    ? `<span class="score"><b>${esc(g.away)} ${esc(L.away_score)}</b> – <b>${esc(L.home_score)} ${esc(g.home)}</b> · ${esc(L.detail)}</span>`
    : "";
  return badge + score;
}

// Only the count changes after a tap, so the logos aren't redrawn.
function navItemHTML(g) {
  return `${logoHTML(g.away)}${esc(g.away)} @ ${logoHTML(g.home)}${esc(g.home)}`
    + `<span class="t">${tipTime(g)}</span><span class="n">${pickCount(g.key) || ""}</span>`;
}

function spreadHTML(g) {
  if (!g.spread.length) return '<span class="note">No spread listed</span>';
  return [g.away, g.home].map((team) => {
    const legs = g.spread.filter((l) => l.team === team);
    const pivot = legs.findIndex((l) => l.hcp < 0);  // first minus line = the +/- boundary
    const chips = legs.map((l, i) => chipHTML(l, `spr|${g.key}`, handicap(l.hcp), i === pivot ? "pivot" : "")).join("");
    return legs.length ? chipRow(team, `spr|${g.key}|${team}`, chips, "spread") : "";
  }).join("");
}

function totalsHTML(g) {
  const row = (dir, label) => {
    const legs = g.total.filter((l) => l.dir === dir);
    return legs.length ? chipRow(label, `tot|${g.key}|${dir}`, legs.map((l) => chipHTML(l, `tot|${g.key}`, l.line)).join("")) : "";
  };
  return row("over", "Over") + row("under", "Under") || '<span class="note">No total listed</span>';
}

function playersHTML(g) {
  let html = "", team = null;
  for (const p of g.players) {
    if (p.team !== team) {
      team = p.team;
      html += `<div class="team-title" data-team="${esc(team)}">${logoHTML(team)}${esc(teamName(team))}${recFullSpan(team)}${flagHTML("data-fwt", team)}</div>`;
    }
    const key = `${p.team}|${p.name}`;
    const rows = STATS.filter((s) => p[s].length).map((s) => {
      const group = `p|${g.key}|${p.name}|${s}`;
      return propRow(s, group, p[s], p.name);
    }).join("");
    // Name, box score (tonight's game on top while it's on), then the prop rows. The box score
    // is right there, so the name has no hover card here (it does on My bets).
    html += `<div class="player" data-log="${esc(key)}">`
      + `<div class="name"><span>${esc(p.name)}<span class="ppos">${posHTML(logs[key])}</span></span>${flagHTML("data-fwp", key)}`
      + `<span class="pown" data-pown="${esc(`${g.key}|${p.name}`)}">${pownText(g.key, p.name)}</span></div>`
      + `<div class="plog" data-game="${esc(g.key)}">${plogHTML(g.key, p.team, p.name)}</div>${rows}</div>`;
  }
  return html || '<div class="empty">No player props listed</div>';
}

function gameHTML(g) {
  const n = pickCount(g.key);
  return `
    <section class="game" id="g-${esc(g.key)}">
      <div class="game-head">
        <h2>${logoHTML(g.away)}${teamSpan(g.away)}${recSpan(g.away)} <span class="at">@</span> ${logoHTML(g.home)}${teamSpan(g.home)}${recSpan(g.home)}</h2>
        <span class="tipoff">${g.start ? "Tip " + tipTime(g) : ""}</span>
        <span class="headlive" data-hk="${esc(g.key)}">${headLiveHTML(g)}</span>
        <span class="count">${n ? n + " picked" : ""}</span>
      </div>
      <div class="section"><div class="section-title">Moneyline</div>
        <div class="chips ml" data-k="${esc(`ml|${g.key}`)}">${g.ml.map((l) => chipHTML(l, `ml|${g.key}`, `${l.team} ML`)).join("")}</div></div>
      <div class="section"><div class="section-title">Spread</div>${spreadHTML(g)}</div>
      <div class="section"><div class="section-title">Game total</div>${totalsHTML(g)}</div>
      <div class="section flush">${playersHTML(g)}</div>
    </section>`;
}

// ---------- Fraud Watch ----------
// A flag after every player's name and on every team row: gray outline, or red once they're on
// the list (a listed team's players get a dimmer red). Tap it to add or remove them. The game
// header marks a listed team with a 🚩. Classes only, so it applies at once without redrawing.

const FLAG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 14.5V2M3.5 2.5h8.5l-2 3.2 2 3.3H3.5"/></svg>';
const flagHTML = (attr, value) => `<button class="pflag" ${attr}="${esc(value)}">${FLAG}</button>`;

export function applyFrauds() {
  document.querySelectorAll("#games .player[data-log]").forEach((el) => {
    const [team, ...rest] = el.dataset.log.split("|"), name = rest.join("|");
    const mine = fraudPlayer(name), viaTeam = fraudTeam(team);
    el.classList.toggle("fraud", mine);
    el.classList.toggle("fraud-team", viaTeam);
    el.querySelector(".pflag").dataset.tip = mine ? "On Fraud Watch · tap to remove"
      : viaTeam ? `The ${teamName(team)} are on Fraud Watch · tap to add ${name} too` : "Add to Fraud Watch";
  });
  document.querySelectorAll("#games [data-team]").forEach((el) => {
    const on = fraudTeam(el.dataset.team);
    el.classList.toggle("fraud", on);
    const flag = el.querySelector(".pflag");
    if (flag) flag.dataset.tip = on ? "Team on Fraud Watch · tap to remove" : `Add the ${teamName(el.dataset.team)} to Fraud Watch`;
  });
}

// ---------- Rendering ----------

/** Identity of what's on screen: if this is unchanged, a patch is enough. */
function structureSig() {
  return state.day + "#" + visibleGames().map((g) => g.key + ":" + allLegs(g).map((l) => l.ticker).join(",")).join(";");
}

/** Start spread rows at the action: the picked line, else the +/- boundary. */
function centerSpread(row) {
  const target = row.querySelector(".chip.on") || row.querySelector(".chip.pivot");
  if (!target) return;
  const box = row.getBoundingClientRect(), t = target.getBoundingClientRect();
  const anchor = target.classList.contains("on") ? t.left + t.width / 2 : t.left;
  row.scrollLeft += anchor - (box.left + box.width / 2);
}

export function renderBoard() {
  const games = visibleGames();
  $("nav").innerHTML = games.map((g) => `<a href="#g-${g.key}">${navItemHTML(g)}</a>`).join("");

  const scrolled = {};
  document.querySelectorAll(".chips[data-k]").forEach((el) => (scrolled[el.dataset.k] = el.scrollLeft));
  $("games").innerHTML = games.map(gameHTML).join("") || '<div class="loading">No open NBA games right now.</div>';
  document.querySelectorAll(".chips[data-k]").forEach((el) => {
    if (el.dataset.k in scrolled) el.scrollLeft = scrolled[el.dataset.k];
    else if (el.classList.contains("spread")) centerSpread(el);
  });
  renderedSig = structureSig();
  applyFrauds();
  loader.disconnect();
  document.querySelectorAll(".player[data-log]").forEach((el) => logs[el.dataset.log] || loader.observe(el));
}

function setHTML(el, html) {
  if (el.innerHTML !== html) el.innerHTML = html;
}

function patchBoard() {
  document.querySelectorAll("#games .chip[data-t]").forEach((el) => {
    const leg = state.byTicker[el.dataset.t];
    if (!leg) return;
    const s = chipState(leg, el.dataset.g);
    const px = el.querySelector(".px");
    if (px.textContent !== s.price) px.textContent = s.price;
    el.disabled = s.disabled;
    el.classList.toggle("on", s.on);
    el.classList.toggle("thin", s.thin);
    el.classList.toggle("hit", s.hit);
    const own = el.querySelector(".own");
    if (own.textContent !== ownText(el.dataset.t)) own.textContent = ownText(el.dataset.t);
  });
  document.querySelectorAll("#games [data-pown]").forEach((el) => {
    const [game, ...name] = el.dataset.pown.split("|");
    const text = pownText(game, name.join("|"));
    if (el.textContent !== text) el.textContent = text;
  });
  document.querySelectorAll("#games .hr[data-h]").forEach((el) => {
    const fresh = document.createElement("template");
    fresh.innerHTML = hitHTML(el.dataset.h);
    if (el.outerHTML !== fresh.innerHTML) el.replaceWith(fresh.content);
  });
  document.querySelectorAll("#games .player[data-log]").forEach((el) => {
    const plog = el.querySelector(".plog");
    if (logs[el.dataset.log]) setHTML(plog, plogHTML(plog.dataset.game, ...el.dataset.log.split("|")));
  });
  document.querySelectorAll("#games [data-rec]").forEach((el) => setHTML(el, recordHTML(el.dataset.rec)));
  document.querySelectorAll("#games [data-recfull]").forEach((el) => setHTML(el, recordFullHTML(el.dataset.recfull)));
  document.querySelectorAll("#games [data-hk]").forEach((el) => {
    const g = state.games.find((x) => x.key === el.dataset.hk);
    if (g) setHTML(el, headLiveHTML(g));
  });
  updatePickCounts();
}

/** Background refresh: patch in place unless markets were added/removed or the day changed. */
export function refreshBoard() {
  if (renderedSig && renderedSig === structureSig()) patchBoard();
  else renderBoard();
}

/** After a tap: update just that group's buttons and the counters. */
export function syncGroup(group) {
  document.querySelectorAll(`.chip[data-g="${CSS.escape(group)}"]`).forEach((el) =>
    el.classList.toggle("on", state.picks[group]?.ticker === el.dataset.t));
  updatePickCounts();
}

export function updatePickCounts() {
  const links = $("nav").querySelectorAll("a");
  visibleGames().forEach((g, i) => {
    const count = links[i]?.querySelector(".n");
    if (count) count.textContent = pickCount(g.key) || "";
    const head = document.querySelector(`#g-${g.key} .count`);
    if (head) {
      const n = pickCount(g.key);
      head.textContent = n ? `${n} picked` : "";
    }
  });
}

export function renderDays(dayList, labelFor) {
  $("days").innerHTML = dayList.map((d) =>
    `<button data-day="${d}" class="${d === state.day ? "on" : ""}">${labelFor(d)}</button>`).join("");
}

