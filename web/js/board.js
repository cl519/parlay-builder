// The game list: full render when the set of markets changes, in-place patch for everything else
// (prices, live stats, scores) so scroll positions, momentum and tooltips are never disturbed.

import { getJSON } from "./api.js";
import { esc, handicap, headshotHTML, logoHTML, teamName, tipTime } from "./format.js";
import { chipState, liveGame, playerStats, statusKind } from "./markets.js";
import { STATS, allLegs, pickCount, state, visibleGames } from "./state.js";

const $ = (id) => document.getElementById(id);
let renderedSig = "";

// ---------- HTML pieces ----------

function chipHTML(leg, group, label, extraClass = "") {
  const s = chipState(state.byTicker[leg.ticker], group);
  const cls = ["chip", s.on && "on", s.thin && "thin", s.hit && "hit", extraClass].filter(Boolean).join(" ");
  return `<button class="${cls}" ${s.disabled ? "disabled" : ""} data-t="${esc(leg.ticker)}" data-g="${esc(group)}">`
    + `<span class="ln">${esc(label)}</span><span class="px">${s.price}</span></button>`;
}

function chipRow(label, rowKey, chips, extraClass = "", tail = "") {
  return `<div class="row"><span class="lbl">${esc(label)}</span>`
    + `<div class="chips ${extraClass}" data-k="${esc(rowKey)}">${chips}</div>${tail}</div>`;
}

// ---------- Recent games beside each prop row ----------
// The player's last 5 games (oldest to newest, opponent on top, newest beside the average) and
// season average, from the same
// ESPN game log as the hover card. Loaded as a player scrolls near the screen; kept for the
// session (the server refreshes its copy every 10 minutes).

const RECENT = 5;
const logs = {};  // "team|name" -> game log, once loaded
const statOf = (row, stat) => (stat === "STL+BLK" ? row.STL + row.BLK : row[stat === "3PT" ? "3PM" : stat]);
// Slot i of 5, left to right: games[] is newest first, so the last slot is games[0]
const slots = (fill) => Array.from({ length: RECENT }, (_, i) => fill(RECENT - 1 - i)).join("");

function recentHTML(log, stat) {
  if (!log?.played) return "";
  return slots((i) => `<span>${log.games[i] ? statOf(log.games[i], stat) : ""}</span>`)
    + `<b>${statOf(log.avg, stat).toFixed(1)}</b>`;
}

function recentHeadHTML(log) {
  if (!log?.played) return "";
  return slots((i) => `<span>${log.games[i] ? esc(log.games[i].opp) : ""}</span>`) + "<b>Avg</b>";
}

const metaHTML = (log) => (log?.played ? `${log.avg.MIN.toFixed(0)} min · ${log.played} GP` : "");

function fillRecent(el) {
  const log = logs[el.dataset.log];
  el.querySelector(".recent.head").innerHTML = recentHeadHTML(log);
  el.querySelector(".pmeta").textContent = metaHTML(log);
  el.querySelectorAll(".recent[data-s]").forEach((r) => (r.innerHTML = recentHTML(log, r.dataset.s)));
}

const loader = new IntersectionObserver((entries) => {
  for (const { target, isIntersecting } of entries) {
    if (!isIntersecting) continue;
    loader.unobserve(target);
    const key = target.dataset.log, i = key.indexOf("|");
    getJSON(`/api/player?${new URLSearchParams({ team: key.slice(0, i), name: key.slice(i + 1) })}`)
      .then((log) => {
        logs[key] = log;
        document.querySelectorAll(`.player[data-log="${CSS.escape(key)}"]`).forEach(fillRecent);
      })
      .catch(() => {});  // the hover card still shows the error
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

function statLineHTML(gameKey, name) {
  if (!liveGame(gameKey)) return "";
  const ps = playerStats(gameKey, name);
  if (!ps) return '<span class="pstats muted">hasn\'t played</span>';
  const fgPct = ps.FGA ? Math.round((100 * ps.FGM) / ps.FGA) + "%" : "–";
  const stat = (v, k) => `<span><b>${v}</b> ${k}</span>`;
  return `<span class="pstats">${stat(ps.PTS, "PTS")}${stat(ps.REB, "REB")}${stat(ps.AST, "AST")}`
    + `<span>FG <b>${ps.FGM}/${ps.FGA}</b> <i>${fgPct}</i></span><span>3PT <b>${ps["3PM"]}/${ps["3PA"]}</b></span>`
    + `${stat(ps.STL, "STL")}${stat(ps.BLK, "BLK")}<span class="min">${ps.MIN}m</span></span>`;
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
      html += `<div class="team-title">${logoHTML(team)}${esc(teamName(team))}</div>`;
    }
    const log = logs[`${p.team}|${p.name}`];
    const rows = STATS.filter((s) => p[s].length).map((s) => {
      const group = `p|${g.key}|${p.name}|${s}`;
      return chipRow(s, group, p[s].map((l) => chipHTML(l, group, `${l.line}+`)).join(""), "",
        `<div class="recent" data-s="${esc(s)}">${recentHTML(log, s)}</div>`);
    }).join("");
    html += `<div class="player" data-log="${esc(`${p.team}|${p.name}`)}">`
      + `<div class="pside">${headshotHTML(p.team, p.name, "portrait")}<div class="pmeta">${metaHTML(log)}</div></div>`
      + `<div class="pbody"><div class="name"><span class="pname" data-team="${esc(p.team)}">${esc(p.name)}</span>`
      + `<span data-pl="${esc(`${g.key}|${p.name}`)}">${statLineHTML(g.key, p.name)}</span>`
      + `<div class="recent head">${recentHeadHTML(log)}</div></div>${rows}</div></div>`;
  }
  return html || '<div class="empty">No player props listed</div>';
}

function gameHTML(g) {
  const n = pickCount(g.key);
  return `
    <section class="game" id="g-${esc(g.key)}">
      <div class="game-head">
        <h2>${logoHTML(g.away)}${esc(teamName(g.away))} <span class="at">@</span> ${logoHTML(g.home)}${esc(teamName(g.home))}</h2>
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
  });
  document.querySelectorAll("#games [data-pl]").forEach((el) => {
    const i = el.dataset.pl.indexOf("|");
    setHTML(el, statLineHTML(el.dataset.pl.slice(0, i), el.dataset.pl.slice(i + 1)));
  });
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

