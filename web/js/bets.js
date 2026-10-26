// "My bets": every open parlay with per-leg progress and live chance, and a quick way to
// rebuild a parlay with legs dropped or their lines adjusted. The old parlay keeps riding;
// replacing = new bet. Parlays asking the same questions (lines aside) group into a "stack".
//
// Nothing here jumps under you: cards are patched in place, sit in fixed columns, and only
// change shape (appear, go, re-sort) at a layout or while they're below the window. See
// "Cards on the page" below.

import { getJSON } from "./api.js";
import { refreshBoard } from "./board.js";
import { esc, percent, tipTime, usd } from "./format.js";
import { chipState, liveGame, playerOut, playerStats, statValue } from "./markets.js";
import { belowScreen, patch, placeInColumns } from "./columns.js";
import { columnCount, matchCards, stickyOrder } from "./order.js";
import { startCashOut, startPlaceBet } from "./place.js";
import { note, renderSlip } from "./slip.js";
import { loadPicks, state } from "./state.js";

const $ = (id) => document.getElementById(id);
const POLL_MS = 20000;
const RISK = 0.5;      // leg chance below this (2x+) = at risk
const DANGER = 1 / 3;  // below this (3x+) = probably gone
const DEFAULT_STAKE = 5;
const REORDER_MS = 60000;  // legs re-sort inside cards at most this often
const LEG_MARGIN = 0.05;   // ...and only past a leg at least 5 points safer
const TOUCH_MS = 60000;    // after you bet from a card, it may change shape on screen this long

let data = null;
let byTicker = new Map(); // parlay ticker -> parlay, latest data
const dropped = {};    // parlay ticker -> Set of leg tickers marked to drop
const adjusted = {};   // parlay ticker -> Map leg ticker -> buy ticker of the line to use instead
const editing = {};    // parlay ticker -> leg ticker whose line picker is open
const adding = {};     // parlay ticker -> stake for "Add more" (the bar is open while set)
const expanded = {};   // parlay ticker -> show legs that already hit
const stakes = {};     // parlay ticker -> replacement stake
const openKids = {};   // stacked parlay ticker -> shown expanded under the stack's top card

// ---------- Leg progress ----------

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const isOpen = (leg) => !leg.result;

/** Settled against you. Not "scalar": that's a player who didn't play, settled at a fair price that still pays. */
const missed = (leg) => (leg.result === "yes" || leg.result === "no") && leg.result !== leg.side;

/** Why a prop's player isn't playing: settled as "scalar", or out on ESPN before Kalshi settles it. */
const outReason = (leg) => (leg.result === "scalar" ? "Didn't play" : !leg.result && leg.player ? playerOut(leg.game, leg.player) : null);
const isLive = (leg) => !!liveGame(leg.game);

/** Prop or over already reached its line but Kalshi hasn't settled it yet. */
function reached(leg) {
  if (leg.result || !liveGame(leg.game)) return false;
  if (leg.kind === "total") return leg.dir === "over" && progress(leg).pct >= 1;
  if (!leg.player) return false;
  const ps = playerStats(leg.game, leg.player);
  return !!ps && statValue(ps, leg.stat) >= leg.line;
}

/** Settled as a win, or already past its line. */
const won = (leg) => (leg.result && leg.result === leg.side) || reached(leg);

/** Sort key for legs in a card, shakiest first: missed on top, then by chance, then hit. */
function legRank(leg) {
  if (leg.result) return leg.result === leg.side ? 3 : missed(leg) ? -1 : 2.5;
  if (reached(leg)) return 3;
  if (outReason(leg)) return 2.5;  // its value is fixed now: nothing to watch
  return leg.chance ?? 2;
}

function tone(leg) {
  if (leg.result) return leg.result === leg.side ? "hit" : missed(leg) ? "dead" : "out";
  if (reached(leg)) return "hit";
  if (outReason(leg)) return "out";
  if (leg.chance == null) return "unknown";
  if (leg.chance < DANGER) return "danger";
  if (leg.chance < RISK) return "risk";
  return isLive(leg) ? "live" : "pending";
}

function marginText(m) {
  return m > 0 ? `up ${m}` : m < 0 ? `down ${-m}` : "tied";
}

/** { pct, text, center } for the progress track. `center` = the goal sits mid-track (margins). */
function progress(leg) {
  if (leg.result === "scalar") return { pct: 0, text: `Didn't play · settled at ${Math.round((leg.settled_value ?? 0) * 100)}¢, which still pays` };
  if (leg.result) return { pct: leg.result === leg.side ? 1 : 0, text: leg.result === leg.side ? "Hit" : "Missed" };
  const out = outReason(leg);
  if (out) return { pct: 0, text: `${out} · Kalshi settles it at a fair price, not a loss` };
  const g = liveGame(leg.game);
  if (!g) {
    // No live data. Only call it "not started" if the tip-off is still ahead; otherwise
    // the data is just missing (feed hiccup, or the game left Kalshi's menu after closing).
    const menu = state.games.find((x) => x.key === leg.game);
    const upcoming = menu && !(menu.start && Date.parse(menu.start) <= Date.now());
    if (!upcoming) return { pct: 0, text: "Waiting for live stats" };
    return { pct: 0, text: menu.start ? `Tip ${tipTime(menu)}` : "Not started" };
  }
  const clock = g.state === "post" ? "Final" : g.detail;
  const away = leg.game.slice(-6, -3);
  const total = g.away_score + g.home_score;
  const marginFor = (team) => (team === away ? 1 : -1) * (g.away_score - g.home_score);

  switch (leg.kind) {
    case "ml": {
      const m = marginFor(leg.team);
      return { pct: clamp01(0.5 + m / 30), text: `${leg.team} ${marginText(m)} · ${clock}`, center: true };
    }
    case "spread": {
      const m = marginFor(leg.team);
      const cover = m + leg.hcp;  // > 0 = covering
      return { pct: clamp01(0.5 + cover / 30), text: `${leg.team} ${marginText(m)} · ${clock}`, center: true };
    }
    case "total":
      return { pct: clamp01(total / leg.line), text: `${total} pts · ${clock}`, under: leg.dir === "under" };
    case "other":
      return { pct: 0, text: clock };
    default: {
      const ps = playerStats(leg.game, leg.player);
      if (!ps) return { pct: 0, text: `hasn't played · ${clock}` };
      const v = statValue(ps, leg.stat);
      return { pct: clamp01(v / leg.line), text: `${v} / ${leg.line} ${leg.stat} · ${ps.MIN}m · ${clock}` };
    }
  }
}

// ---------- Rendering ----------

const THIN_TITLE = "Thin market: buyers and sellers are far apart (common overnight), so this is the "
  + "last trade or the asking price, not a midpoint. Rough until makers tighten up near tip-off.";

function oddsHTML(leg, target) {
  if (target) {  // adjusted: show what the new line costs
    return `<div class="bl-odds adj"><b>${target.ask}¢</b><span>${(100 / Math.max(target.ask, 1)).toFixed(1)}x</span></div>`;
  }
  if (leg.result === "scalar") return `<div class="bl-odds out"><b>${Math.round((leg.settled_value ?? 0) * 100)}¢</b><span>settled</span></div>`;
  if (outReason(leg)) return '<div class="bl-odds out"><b>Out</b><span>fair price</span></div>';
  if (leg.result || leg.chance == null) return "";
  return `<div class="bl-odds" ${leg.thin ? `title="${THIN_TITLE}"` : ""}><b>${leg.thin ? "≈" : ""}${Math.round(leg.chance * 100)}%</b>`
    + `<span>${(1 / Math.max(leg.chance, 0.01)).toFixed(1)}x</span></div>`;
}

// ---------- Adjusting a leg's line (other lines of the same question, from the Build board) ----------

let byGroup = null, byGroupFor = null;  // group -> tickers, rebuilt when the menus change

function groupTickers(group) {
  if (byGroupFor !== state.groupOf) {
    byGroup = new Map();
    for (const [t, g] of Object.entries(state.groupOf)) {
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(t);
    }
    byGroupFor = state.groupOf;
  }
  return byGroup.get(group) || [];
}

/**
 * Lines you could switch this leg to: same player+stat, or same game total/spread in the same
 * direction. Never the other side (Over -> Under, the other team): that's a different bet.
 * Works for a prop Kalshi already settled as a win, too: it settles a line the moment it's
 * reached, mid-game, while the higher lines keep trading.
 */
function otherLines(leg) {
  if (leg.kind === "ml" || leg.kind === "other" || (leg.result && leg.result !== leg.side)) return [];  // missed / didn't play
  const own = state.byTicker[leg.buy_ticker];
  const group = state.groupOf[leg.buy_ticker] ?? (leg.player && settledPropGroup(leg));
  if (!group) return [];  // no line of it is on the board any more
  const lines = groupTickers(group).map((t) => state.byTicker[t])
    .filter((l) => (leg.kind === "total" ? l.dir === own.dir : leg.kind === "spread" ? l.team === own.team : true));
  const key = (l) => (l.hcp != null ? -l.hcp : l.dir === "under" ? -l.line : l.line);  // safest first, like the board
  return lines.length > (own ? 1 : 0) ? lines.sort((a, b) => key(a) - key(b)) : [];
}

/**
 * The board only lists markets still trading, so a settled prop line isn't on it. Its siblings
 * share the ticker up to the line number (...-OKCSGILGEOUSALEXANDER2-20 / -25 / -30).
 */
function settledPropGroup(leg) {
  const head = leg.ticker.replace(/\d+$/, "");
  const sibling = Object.keys(state.groupOf).find((t) => t.startsWith(head) && /^\d+$/.test(t.slice(head.length)));
  return sibling && state.groupOf[sibling];
}

function lineText(l) {
  if (l.hcp != null) return `${l.hcp > 0 ? "+" : ""}${l.hcp}`;
  if (l.dir) return `${l.dir === "over" ? "O" : "U"} ${l.line}`;
  return `${l.line}+`;
}

/** "Stephon Castle 15+ → 10+ PTS", "Over 225.5 → 219.5", "BOS -7.5 → -3.5" */
function adjustedLabel(leg, target) {
  if (leg.player) return `${leg.player} ${leg.line}+ → ${target.line}+ ${leg.stat}`;
  return `${leg.label} → ${leg.kind === "total" ? target.line : lineText(target)}`;
}

/** Mark the player's name so hovering it shows their recent games, as on Build (tooltip.js). */
function withPlayer(leg, text) {
  if (!leg.player || !leg.team || !text.startsWith(leg.player)) return esc(text);
  // title="" keeps the row's "Tap to…" hint from popping up on top of the stats card
  return `<span class="pname" data-team="${esc(leg.team)}" title="">${esc(leg.player)}</span>${esc(text.slice(leg.player.length))}`;
}

const targetOf = (p, leg) => {
  const t = adjusted[p.ticker]?.get(leg.ticker);
  return t ? state.byTicker[t] && { ...state.byTicker[t], ticker: t } : null;
};

function lineEditorHTML(p, leg, lines) {
  const chosen = adjusted[p.ticker]?.get(leg.ticker) ?? leg.buy_ticker;
  const isDropped = dropped[p.ticker]?.has(leg.ticker);
  const chips = lines.map((l) => {
    const c = chipState(l, state.groupOf[l.ticker]);
    const mine = l.ticker === leg.buy_ticker;  // always pickable: picking it undoes the change
    return `<button class="chip ${l.ticker === chosen && !isDropped ? "on" : ""} ${c.thin ? "thin" : ""}" ${(c.disabled || c.hit) && !mine ? "disabled" : ""}
      data-adj="${p.ticker}" data-leg="${leg.ticker}" data-to="${l.ticker}" title="${mine ? "Your current line" : ""}">
      <span class="ln">${lineText(l)}${mine ? " ·" : ""}</span><span class="px">${c.price}${c.disabled ? "" : "¢"}</span></button>`;
  }).join("");
  const side = won(leg)  // a leg that already hit is left out of a new parlay anyway
    ? '<span class="note" title="Left out of a new parlay unless you pick a higher line">Hit · pick higher</span>'
    : `<button class="btn" data-drop="${p.ticker}" data-leg="${leg.ticker}">${isDropped ? "Keep leg" : "Drop leg"}</button>`;
  return `<div class="bl-edit"><div class="chips">${chips}</div>${side}</div>`;
}

function legHTML(p, leg) {
  const pr = progress(leg);
  const isDropped = dropped[p.ticker]?.has(leg.ticker);
  const target = !isDropped && targetOf(p, leg);
  const editable = isOpen(leg) && !reached(leg);  // can drop it or change its line
  const lines = otherLines(leg);  // a leg that already hit can still move to a higher line
  const isEditing = editing[p.ticker] === leg.ticker && lines.length;
  const cls = ["bleg", `t-${tone(leg)}`, isDropped && "drop", target && "adjusted", isEditing && "editing",
    (editable || lines.length) && "tappable"].filter(Boolean).join(" ");
  const track = `<div class="track ${pr.center ? "center" : ""} ${pr.under ? "under" : ""}">`
    + `<div class="fill" style="width:${(pr.pct * 100).toFixed(1)}%"></div></div>`;
  const hint = !editable ? (lines.length ? "Already hit: tap to pick a higher line for a new parlay" : "")
    : lines.length ? "Tap to change the line or drop this leg" : "Tap to drop this leg";
  return `<div class="${cls}" id="leg-${p.ticker}-${leg.ticker}" data-p="${p.ticker}" data-leg="${leg.ticker}" ${lines.length ? "data-lines" : ""} title="${hint}">
    <div class="bl-main"><span class="bl-label">${withPlayer(leg, target ? adjustedLabel(leg, target) : leg.label)}</span><span class="bl-sub" data-prog>${esc(pr.text)}</span></div>
    ${track}${oddsHTML(leg, target)}${editable ? `<button class="bl-x" data-drop="${p.ticker}" data-leg="${leg.ticker}" title="${isDropped ? "Keep" : "Drop"} this leg">${isDropped ? "↺" : "✕"}</button>` : "<span></span>"}
  </div>${isEditing ? lineEditorHTML(p, leg, lines) : ""}`;
}

/** One segment per leg, in leg order: an at-a-glance "how far from hitting". */
function meterHTML(p) {
  return `<div class="meter">${p.legs.map((l) => `<span class="seg t-${tone(l)}"></span>`).join("")}</div>`;
}

function footerHTML(p) {
  const drops = dropped[p.ticker]?.size || 0;
  const adjusts = [...(adjusted[p.ticker]?.keys() || [])].filter((t) => !dropped[p.ticker]?.has(t)).length;
  if (!drops && !adjusts) return "";
  const keep = replacementLegs(p);
  const ok = keep.length >= 2;
  const changes = [drops && `Drop ${drops} leg${drops > 1 ? "s" : ""}`, adjusts && `adjust ${adjusts}`].filter(Boolean).join(", ");
  return `<div class="p-foot">
    <span>${changes[0].toUpperCase() + changes.slice(1)} → new <b>${keep.length}-leg</b> parlay
      ${alreadyWon(p) ? `<span class="note">· ${alreadyWon(p)} already-hit legs left out</span>` : ""}</span>
    <label class="mini-stake">$<input type="number" min="1" step="1" value="${stakes[p.ticker] ?? DEFAULT_STAKE}" data-stake="${p.ticker}"></label>
    <button class="btn" data-undo="${p.ticker}">Undo</button>
    <button class="btn primary" data-replace="${p.ticker}" ${ok ? "" : "disabled"}>${ok ? "Replace…" : "Need 2+ legs"}</button>
  </div>`;
}

/**
 * What "Add more" buys, at today's price. While every leg still trades: this exact parlay, so
 * it's the same Kalshi market and the contracts join your position. Once some legs have hit
 * (settled or past their line), Kalshi can't sell that parlay any more, so: the legs still to
 * go as a new parlay - the same bet from here on, since the hit legs are done. Null when a leg
 * lost, or a leg that hasn't hit stopped trading (nothing to quote).
 */
function addLegs(p) {
  if (p.gone || p.legs.some(missed)) return null;
  const trading = (l) => isOpen(l) && l.status === "active";
  if (p.legs.every(trading)) return { legs: p.legs, same: true };
  const rest = p.legs.filter((l) => !won(l) && !outReason(l));  // an out player's leg is settled at a fair price
  return rest.length && rest.every(trading) ? { legs: rest, same: false } : null;
}

const betName = (n) => (n === 1 ? "single bet" : `${n}-leg parlay`);

function addBarHTML(p) {
  const add = adding[p.ticker] != null && addLegs(p);
  if (!add) return "";
  const what = add.same
    ? `Add more to this ${p.single ? "bet" : `${p.legs.length}-leg parlay`} <span class="note">· same legs, at today's price</span>`
    : `Add more: the ${add.legs.length} ${add.legs.length === 1 ? "leg" : "legs"} still to go as a new ${betName(add.legs.length)}`
      + ` <span class="note">· ${p.legs.length - add.legs.length} already hit, so it's the same bet from here, at today's price</span>`;
  return `<div class="p-foot add-bar">
    <span>${what}</span>
    <label class="mini-stake">$<input type="number" min="1" step="1" value="${adding[p.ticker]}" data-addstake="${p.ticker}"></label>
    <button class="btn" data-addcancel="${p.ticker}">Cancel</button>
    <button class="btn primary" data-addgo="${p.ticker}">Get price…</button>
  </div>`;
}

/**
 * Summary numbers shared by full cards and the compact stack rows. A leg that reached its
 * line counts as hit right away; Kalshi often settles props only after the game ends.
 */
function summary(p) {
  const open = p.legs.filter((l) => isOpen(l) && !reached(l) && !outReason(l)).sort((a, b) => (a.chance ?? 2) - (b.chance ?? 2));
  return {
    open,
    hit: p.legs.filter(won),
    dead: p.legs.filter(missed),
    out: p.legs.filter(outReason),
    atRisk: open.filter((l) => l.chance != null && l.chance < RISK).length,
  };
}

/**
 * Border colour, worst leg first: red if a leg that hasn't hit is under 33%, yellow under 50%;
 * otherwise by the parlay's own chance: green 50%+, blue 3%+, none below (most long parlays).
 */
function toneClass(p, s) {
  if (s.dead.length || p.gone) return "is-dead";
  if (s.open.some((l) => l.chance != null && l.chance < DANGER)) return "is-danger";
  if (s.atRisk) return "is-risk";
  if (p.est_chance >= 0.5) return "is-good";
  return p.est_chance >= 0.03 ? "is-fair" : "";
}

function chanceHTML(p, dead) {
  const est = p.est_chance;
  // Two lines like a live chance, so a card's height doesn't change when it settles or loses
  if (p.gone) return '<b class="dead">Settled</b><span>by Kalshi</span>';
  if (dead) return '<b class="dead">Lost</b><span>a leg missed</span>';
  if (est == null) return "";
  return `<b>${est < 0.001 ? "<0.1" : percent(est)}%</b><span>est. chance · ${(1 / Math.max(est, 1e-6)).toFixed(0)}x</span>`;
}

const famOf = (l) => l.family || l.ticker + "|" + l.side;

function labels(legs) {
  const names = legs.map((l) => l.label);
  return names.slice(0, 3).join(", ") + (names.length > 3 ? ` and ${names.length - 3} more` : "");
}

/**
 * How a stacked parlay differs from the stack's top card, compared by leg family: a leg on
 * another line of the same question is "adjusted", not "without" + "plus". "Replacement" only
 * when it adds no new questions and was placed after the top card. Legs that already hit don't
 * count as "without": a replacement leaves them out on purpose.
 */
function relation(m, top) {
  const inM = new Map(m.legs.map((l) => [famOf(l), l])), inTop = new Map(top.legs.map((l) => [famOf(l), l]));
  const without = top.legs.filter((l) => !inM.has(famOf(l)) && !won(l));
  const plus = m.legs.filter((l) => !inTop.has(famOf(l)));
  const changed = m.legs.filter((l) => inTop.has(famOf(l)) && inTop.get(famOf(l)).ticker !== l.ticker);
  const replacement = !plus.length && placedAt(m) > placedAt(top);
  const adjustedText = changed.map((l) => adjustedLabel(inTop.get(famOf(l)), l));
  const diff = [
    changed.length && adjustedText.slice(0, 3).join(", ") + (changed.length > 3 ? ` and ${changed.length - 3} more` : ""),
    plus.length && `plus ${labels(plus)}`,
    without.length && `without ${labels(without)}`,
  ].filter(Boolean);
  return { name: replacement ? "replacement" : "parlay", text: diff.join(" · ") || "same open legs" };
}

function stackRowHTML(m, top) {
  const s = summary(m);
  const rel = relation(m, top);
  const isOpenKid = !!openKids[m.ticker];
  return `<button class="kid ${toneClass(m, s)}" id="kid-${m.ticker}" data-kid="${m.ticker}">
      <span class="kid-arrow">${isOpenKid ? "▾" : "▸"}</span>
      <span class="kid-main"><b>${m.legs.length}-leg ${rel.name}</b> · ${usd(m.cost)} → ${usd(m.payout)}
        <span class="kid-sub">${esc(rel.text)}</span></span>
      <span class="kid-odds">${s.atRisk ? `<span class="c risk">⚠ ${s.atRisk}</span>` : ""}${chanceHTML(m, s.dead.length)}</span>
    </button>
    ${isOpenKid ? `<div class="kid-card">${parlayHTML(m, "In this stack")}</div>` : ""}`;
}

/** A full card. `others` = the rest of its stack, shown as compact rows underneath. */
function parlayHTML(p, title, others = []) {
  const s = summary(p);
  const { open, hit, dead, out, atRisk } = s;
  const cls = ["parlay", toneClass(p, s)].filter(Boolean).join(" ");
  const stats = [
    hit.length && `<span class="c hit">✓ ${hit.length} hit</span>`,
    dead.length && `<span class="c dead">✕ ${dead.length} missed</span>`,
    atRisk && `<span class="c risk">⚠ ${atRisk} at risk</span>`,
    out.length && `<span class="c" title="Player out: Kalshi settles the leg at a fair price, which still pays">○ ${out.length} out</span>`,
    `<span class="c">${open.length} to go</span>`,
  ].filter(Boolean).join("");
  const reusable = !p.gone && replacementLegs(p).length;
  const main = mainLegs(p), folded = p.legs.filter((l) => !main.includes(l));

  return `<article class="${cls}" id="p-${p.ticker}" data-card="${p.ticker}">
    <div class="p-head">
      <div>
        <div class="p-title">${title} · ${p.single ? "single bet" : `${p.legs.length}-leg parlay`}</div>
        <div class="p-money">${usd(p.cost)} → <b>${usd(p.payout)}</b>${p.placed ? ` · <span class="placed">placed ${placedLabel(p)}</span>` : ""}</div>
      </div>
      <div class="p-odds">${chanceHTML(p, dead.length)}</div>
    </div>
    ${meterHTML(p)}
    <div class="p-counts">${stats}${reusable
      ? `<button class="use-slip" data-use="${p.ticker}" title="Put this parlay's open legs (minus any you marked to drop) in the Build slip">Use in slip</button>` : ""}${
      !p.single && !dead.length && !p.gone ? `<button class="use-slip" data-cashout="${p.ticker}" title="See what market makers would pay for this parlay right now">Cash out</button>` : ""}${
      addLegs(p) ? `<button class="use-slip" data-add="${p.ticker}" title="Buy more of this ${p.single ? "bet" : "parlay"} at today's price (once legs have hit: the legs still to go)">Add more</button>` : ""}${
      !p.single ? `<button class="use-slip" data-share="${p.ticker}" title="Copy a Kalshi link that opens these legs in Kalshi's combo builder">Share</button>` : ""}</div>
    ${addBarHTML(p)}
    <div class="p-legs">${main.map((l) => legHTML(p, l)).join("")}</div>
    ${folded.length ? `<button class="hit-toggle" data-expand="${p.ticker}">${expanded[p.ticker] ? "Hide" : "Show"} ${folded.length} ${folded.length === 1 ? "leg" : "legs"} that hit</button>
      ${expanded[p.ticker] ? `<div class="p-legs">${folded.map((l) => legHTML(p, l)).join("")}</div>` : ""}` : ""}
    ${footerHTML(p)}
    ${others.length ? `<div class="kids"><div class="kids-title">Also in this stack (${others.length})</div>
      ${others.map((m) => stackRowHTML(m, p)).join("")}</div>` : ""}
  </article>`;
}

// ---------- Stacks (the server links each parlay to its smallest open leg-superset) ----------

/** Group linked parlays; each stack is sorted, so its best parlay under the current sort leads. */
function stacks(parlays) {
  const byTicker = new Map(parlays.map((p) => [p.ticker, p]));
  const rootOf = (p) => { while (p.parent && byTicker.has(p.parent)) p = byTicker.get(p.parent); return p.ticker; };
  const groups = new Map();
  for (const p of parlays) {
    const root = rootOf(p);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(p);
  }
  return [...groups.values()].map(sorted).sort((a, b) => compare(a[0], b[0]));
}

/**
 * The latest stacks to show: no parlays that already lost (a leg settled against you), only
 * the chosen league, best first. Stacked from every parlay first, so a hidden one in the
 * middle of a chain still links the rest.
 */
function liveStacks() {
  const { shows } = LEAGUES[league];
  return stacks(data.parlays).map((g) => g.filter((p) => !lost(p) && shows(p))).filter((g) => g.length)
    .sort((a, b) => compare(a[0], b[0]));
}

// ---------- Sorting (remembered per browser) ----------

const lost = (p) => p.legs.some(missed);
const placedAt = (p) => (p.placed ? Date.parse(p.placed) : 0);

// Each sort is a list of keys compared in order; smaller sorts first.
const SORTS = {
  newest: { label: "Newest", key: (p) => [-placedAt(p)] },
  oldest: { label: "Oldest", key: (p) => [placedAt(p)] },
  payout: { label: "Max payout", key: (p) => [-p.payout] },
  staked: { label: "Most staked", key: (p) => [-p.cost] },
  likely: { label: "Most likely", key: (p) => [lost(p) ? 1 : 0, -(p.est_chance ?? 0)] },
};
const SORT_STORAGE = "betsSort";
let sortBy = (() => { try { return localStorage.getItem(SORT_STORAGE); } catch { return null; } })();
if (!SORTS[sortBy]) sortBy = "newest";

// Which parlays to show. A parlay with any NBA leg counts as NBA, so mixed ones stay.
const LEAGUES = {
  nba: { label: "NBA only", shows: (p) => p.legs.some((l) => l.ticker.startsWith("KXNBA")) },
  all: { label: "All", shows: () => true },
};
const LEAGUE_STORAGE = "betsLeague";
let league = (() => { try { return localStorage.getItem(LEAGUE_STORAGE); } catch { return null; } })();
if (!LEAGUES[league]) league = "all";

function compare(a, b) {
  const key = SORTS[sortBy].key;
  const ka = key(a), kb = key(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
  return 0;
}

const sorted = (parlays) => [...parlays].sort(compare);

function sortBarHTML() {
  return `<div class="sortbar" role="group" aria-label="Sort parlays">${Object.entries(SORTS)
    .map(([k, s]) => `<button data-sort="${k}" class="${k === sortBy ? "on" : ""}">${s.label}</button>`).join("")}</div>`
    + `<div class="sortbar" role="group" aria-label="Which parlays">${Object.entries(LEAGUES)
    .map(([k, l]) => `<button data-league="${k}" class="${k === league ? "on" : ""}">${l.label}</button>`).join("")}</div>`;
}

const placedLabel = (p) => p.placed
  ? new Date(p.placed).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";

// ---------- Cards on the page ----------
//
// A card is a stack: its top parlay as a full card, the rest as rows under it. The latest
// data (polls every 20s, live stats) only ever patches what cards say. What's on the page and
// where - which cards, their order and columns, a card's top parlay, which legs are folded
// away as hit - is view state, changed only:
//   - at a layout: opening the tab, a sort or filter click (clicking the current sort again
//     re-sorts), the "new parlays" pill, a column-count change;
//   - for a card entirely below the window, where it can't move anything you're looking at
//     (that's when parlays that lost leave, and a stack takes in a parlay placed elsewhere);
//   - for a card you just placed a bet from (Replace, Add more, Cash out).
// Legs inside a card re-sort, shakiest first, at most once a minute, gliding to their spots,
// and never in the card under your mouse or one you're editing.

const cards = new Map();    // card key -> { el, members: parlay tickers (top first), title, html }
let columns = 0;            // column count of the last layout (0 = not laid out)
let hovered = null;         // key of the card under the mouse
let waiting = 0;            // stacks placed elsewhere since the last layout, waiting for the pill
const touched = new Map();  // card key -> when you placed a bet from it
const known = {};           // parlay ticker -> last data seen: a settled parlay vanishes from the data
const legOrder = {};        // parlay ticker -> its unfolded legs, shakiest first

/** A parlay as of the latest data, or its last known state marked `gone` once Kalshi settled it. */
const parlayNow = (t) => byTicker.get(t) ?? (known[t] && { ...known[t], gone: true });

/** Legs shown in the card (in order); the rest had hit by the last layout and fold away. */
function mainLegs(p) {
  const legs = new Map(p.legs.map((l) => [l.ticker, l]));
  legOrder[p.ticker] ??= stickyOrder(p.legs.filter((l) => !won(l)).map((l) => l.ticker), (t) => legRank(legs.get(t)));
  return legOrder[p.ticker].map((t) => legs.get(t)).filter(Boolean);
}

const keyOf = (ticker) => [...cards].find(([, c]) => c.members.includes(ticker))?.[0];
const membersByCard = () => new Map([...cards].map(([k, c]) => [k, c.members]));
const recentlyTouched = (key) => Date.now() - (touched.get(key) ?? 0) < TOUCH_MS;
const busy = (card) => card.members.some((t) => editing[t] || adding[t] != null || dropped[t] || adjusted[t]);

function newCard(key, members, title) {
  const el = Object.assign(document.createElement("div"), { className: "bcard" });
  el.dataset.key = key;
  return { el, members, title, html: "" };
}

/** Fill a card from the latest data; skipped if nothing it shows changed. */
function paint(card, slide = false) {
  const [top, ...others] = card.members.map(parlayNow).filter(Boolean);
  if (!top) return;
  const html = parlayHTML(top, card.title, others);
  if (html === card.html) return;
  card.html = html;
  patch(card.el, html, slide);
}

function paintHead() {
  const head = $("betsHead");
  if (!head) return;
  // Only for new parlays: on live sorts the order drifts every poll, and a notice that's always on is noise
  const pill = waiting ? `${waiting} new ${waiting === 1 ? "parlay" : "parlays"}` : "";
  patch(head, `<h2>My parlays</h2>${sortBarHTML()}${nightHTML()}`
    + (pill ? `<button class="bets-pill" data-relayout title="Lay the cards out again, in order">${pill} · update list</button>` : "")
    + `<span class="note">${league === "all" ? "" : `${data.parlays.filter(LEAGUES[league].shows).length} of `}${data.parlays.length} parlays · `
    + "tap a leg to change its line or drop it, then Replace to rebuy (the original keeps riding). Parlays asking the same questions stack together</span>");
}

/**
 * Tonight's money, from Kalshi's records (nights.py), for the league shown. Only facts: what
 * an open parlay could still pay isn't here, since most of that is long shots. Net counts
 * open parlays as $0 until they hit, so it's the floor of how tonight ends.
 */
function nightHTML() {
  const t = data.tonight;
  if (!t) return "";
  const rows = t.rows.filter(LEAGUES[league].shows);
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  const staked = sum("staked"), paid = sum("paid"), locked = sum("locked"), net = paid + locked - staked;
  const riding = rows.filter((r) => r.riding > 0).length;
  const item = (amount, what, tip, cls = "") => `<span class="${cls}" title="${tip}"><b>${amount}</b> ${what}</span>`;
  const day = new Date(t.night + "T12:00").toLocaleDateString([], { month: "short", day: "numeric" });
  return `<div class="night"><span class="night-label" title="Bets on games on ${day}, counted by their last game">Tonight</span>`
    + item(usd(staked), "staked", "Everything you paid in for tonight's games, fees included")
    + item(usd(paid), "paid out", "Money back: settled wins and cash-outs, after fees")
    + item(usd(locked), "locked in", "Every leg already settled your way; Kalshi just hasn't paid yet")
    + item(`${net < 0 ? "−" : "+"}${usd(Math.abs(net))}`, "net", "Paid out + locked in − staked. Open parlays count as $0 until they hit", net < 0 ? "down" : "up")
    + item(usd(sum("riding")), `still riding on ${riding} ${riding === 1 ? "parlay" : "parlays"}`, "What the open parlays that are still alive cost you: the most tonight can still lose")
    + "</div>";
}

/** Lay every card out fresh: current sort, lost parlays gone, legs that hit folded away. */
function layout() {
  const el = $("bets");
  if (!data) { el.innerHTML = '<div class="loading">Loading your parlays…</div>'; columns = 0; return; }
  if (!$("betsCols")) el.innerHTML = '<div class="bets-head" id="betsHead"></div><div class="bets-cols" id="betsCols"></div>';
  const groups = liveStacks();
  const match = matchCards(membersByCard(), groups.map((g) => g.map((p) => p.ticker)));
  const next = groups.map((g, i) => {
    const key = match.get(i) ?? g[0].ticker;
    const card = cards.get(key) ?? newCard(key);  // reuse the element: hover, focus and tooltips survive
    return [key, { ...card, members: g.map((p) => p.ticker), title: `#${i + 1}` }];
  });
  cards.clear();
  for (const obj of [legOrder, known]) for (const t of Object.keys(obj)) delete obj[t];
  for (const p of data.parlays) known[p.ticker] = p;
  touched.clear();
  waiting = 0;
  for (const [key, card] of next) { cards.set(key, card); paint(card); }  // filled before measuring heights
  columns = placeInColumns($("betsCols"), next.map(([, c]) => c.el));
  if (!next.length) $("betsCols").innerHTML = `<div class="loading">No open ${league === "nba" ? "NBA " : ""}parlays.</div>`;
  paintHead();
}

/** New data or a click: patch every card in place; reshape a card only where it's safe (see above). */
function update() {
  if (!data || document.body.dataset.view !== "bets") return;
  if (!columns || !$("betsCols")) return layout();
  const groups = liveStacks();
  const match = matchCards(membersByCard(), groups.map((g) => g.map((p) => p.ticker)));
  const groupOf = new Map([...match].map(([i, key]) => [key, groups[i]]));
  for (const [key, card] of [...cards]) {
    if (!belowScreen(card.el) && !recentlyTouched(key)) continue;
    const g = groupOf.get(key);
    if (!g) { card.el.remove(); cards.delete(key); continue; }
    const top = g.some((p) => p.ticker === card.members[0]) ? card.members[0] : g[0].ticker;  // keep its top while alive
    card.members = [top, ...g.map((p) => p.ticker).filter((t) => t !== top)];
  }
  // Stacks with no card: one you just placed goes right after the card you placed it from;
  // one placed elsewhere waits for the "update list" pill instead of pushing cards around.
  const shown = new Set([...cards.values()].flatMap((c) => c.members));
  const source = [...touched.keys()].find((k) => recentlyTouched(k) && cards.has(k));
  waiting = 0;
  groups.forEach((g, i) => {
    if (match.has(i) || g.every((p) => shown.has(p.ticker))) return;
    if (!source) { waiting++; return; }
    const card = newCard(g[0].ticker, g.map((p) => p.ticker), "New");
    cards.set(g[0].ticker, card);
    cards.get(source).el.after(card.el);
  });
  for (const card of cards.values()) paint(card);
  paintHead();
}

/** Re-sort legs inside cards, shakiest first, without flip-flopping on near-ties. */
function reorderLegs() {
  if (!data || document.body.dataset.view !== "bets" || document.hidden) return;
  for (const [key, card] of cards) {
    if (key === hovered || busy(card)) continue;
    let changed = false;
    for (const t of card.members) {
      const p = parlayNow(t);
      if (!p || !legOrder[t]) continue;
      const legs = new Map(p.legs.map((l) => [l.ticker, l]));
      const next = stickyOrder(legOrder[t], (lt) => legRank(legs.get(lt)), LEG_MARGIN);
      if (next.join() !== legOrder[t].join()) { legOrder[t] = next; changed = true; }
    }
    if (changed) paint(card, true);
  }
}

/** Live stats changed: patch what the cards say (colors depend on live data too). */
export function refreshBetsProgress() {
  update();
}

// ---------- Data + actions ----------

/**
 * Legs for the replacement parlay: still open, not dropped, and not already won, each on its
 * adjusted line if you picked one. Settled legs can't go in a new combo at all; legs that
 * reached their line but aren't settled yet would only add ~100% legs whose market may close
 * mid-quote - unless you moved one to a higher line it hasn't reached (10+ hit, now 15+), which
 * works even after Kalshi settled the original line.
 */
function replacementLegs(p) {
  const drops = dropped[p.ticker] || new Set();
  return p.legs.filter((l) => !drops.has(l.ticker) && !outReason(l)
    && (targetOf(p, l) ? !missed(l) : isOpen(l) && l.status === "active" && !reached(l)))
    .map((l) => {
      const target = targetOf(p, l);
      return target ? { ...l, buy_ticker: target.ticker, label: target.label } : l;
    });
}

/** Legs left out of a new parlay because they already hit (not counting ones moved to a higher line). */
function alreadyWon(p) {
  return p.legs.filter((l) => won(l) && !targetOf(p, l)).length;
}

/** Copy a parlay's open legs into the Build slip (replacing it) and switch to Build. */
function useInSlip(p) {
  const legs = replacementLegs(p);
  const loaded = loadPicks(legs.map((l) => l.buy_ticker));
  refreshBoard();
  renderSlip();
  location.hash = "#build";
  const skipped = p.legs.length - loaded;
  note(`Loaded ${loaded} legs from your ${p.legs.length}-leg parlay`
    + (skipped ? ` · ${skipped} left out (already hit, dropped, or no longer offered)` : "") + ".", "ok");
}

let loadedAt = 0;

/** Fetch your parlays. `relayout`: lay out fresh if you haven't scrolled yet (just opened the tab). */
async function load(force = false, relayout = false) {
  try {
    data = await getJSON("/api/bets" + (force ? "?refresh=1" : ""), { private: true });
  } catch (e) {
    if (!data) $("bets").innerHTML = `<div class="loading">Couldn't load your parlays: ${esc(e.message)}</div>`;
    return;
  }
  loadedAt = Date.now();
  byTicker = new Map(data.parlays.map((p) => [p.ticker, p]));
  for (const p of data.parlays) known[p.ticker] = p;
  $("betCount").textContent = data.parlays.length || "";
  // Forget edits for parlays that no longer exist
  for (const edits of [dropped, adjusted, editing, adding]) {
    for (const t of Object.keys(edits)) if (!byTicker.has(t)) delete edits[t];
  }
  if (relayout && scrollY < 10 && document.body.dataset.view === "bets") layout(); else update();
}

/** Opening the tab is a layout. Data from your last visit may be old: lay out again when fresh. */
export function showBets() {
  layout();
  load(false, Date.now() - loadedAt > POLL_MS);
}

/** After a bet placed from a card (or a cash out), let that card change shape right away. */
function touch(ticker) {
  const key = keyOf(ticker);
  if (key) touched.set(key, Date.now());
  load(true);
}

/**
 * Copy the link Kalshi's own Share uses: its combo builder reads the parlay's ticker from
 * ?marketTicker= and loads the legs (found in kalshi.com's code; not a documented API).
 */
async function copyShareLink(button) {
  const url = `https://kalshi.com/combos?marketTicker=${encodeURIComponent(button.dataset.share)}`;
  try {
    await navigator.clipboard.writeText(url);
    button.textContent = "Link copied";
  } catch {
    button.textContent = "Couldn't copy";
  }
  setTimeout(() => { button.textContent = "Share"; }, 1500);
}

function onClick(e) {
  const sortButton = e.target.closest("[data-sort]");
  if (sortButton) {
    sortBy = sortButton.dataset.sort;
    try { localStorage.setItem(SORT_STORAGE, sortBy); } catch { /* private mode */ }
    return layout();
  }
  const leagueButton = e.target.closest("[data-league]");
  if (leagueButton) {
    league = leagueButton.dataset.league;
    try { localStorage.setItem(LEAGUE_STORAGE, league); } catch { /* private mode */ }
    return layout();
  }
  if (e.target.closest("[data-relayout]")) {
    layout();
    return scrollTo(0, 0);
  }
  const cashOut = e.target.closest("[data-cashout]");
  if (cashOut) return startCashOut(byTicker.get(cashOut.dataset.cashout), () => touch(cashOut.dataset.cashout));
  const share = e.target.closest("[data-share]");
  if (share) return copyShareLink(share);
  const use = e.target.closest("[data-use]");
  if (use) return useInSlip(byTicker.get(use.dataset.use));
  const kid = e.target.closest("[data-kid]");
  if (kid) {
    openKids[kid.dataset.kid] = !openKids[kid.dataset.kid];
    return update();
  }
  const toggleExpand = e.target.closest("[data-expand]");
  if (toggleExpand) {
    const t = toggleExpand.dataset.expand;
    expanded[t] = !expanded[t];
    return update();
  }
  const undo = e.target.closest("[data-undo]");
  if (undo) {
    for (const edits of [dropped, adjusted, editing]) delete edits[undo.dataset.undo];
    return update();
  }
  const add = e.target.closest("[data-add]");
  if (add) {  // toggles the bar right under the button, ready to type an amount
    const t = add.dataset.add;
    if (adding[t] == null) adding[t] = DEFAULT_STAKE; else delete adding[t];
    update();
    return document.querySelector(`[data-addstake="${t}"]`)?.select();
  }
  const addCancel = e.target.closest("[data-addcancel]");
  if (addCancel) {
    delete adding[addCancel.dataset.addcancel];
    return update();
  }
  const addGo = e.target.closest("[data-addgo]");
  if (addGo) {
    const p = byTicker.get(addGo.dataset.addgo);
    const add = addLegs(p);
    if (!add) return update();  // a leg settled while the bar was open
    const legs = add.legs.map((l) => ({ ticker: l.buy_ticker, label: l.label }));
    return startPlaceBet(legs, Math.max(adding[p.ticker] || DEFAULT_STAKE, 1), () => {
      delete adding[p.ticker];
      touch(p.ticker);
    });
  }
  const adjust = e.target.closest("[data-adj]");
  if (adjust) return adjustLeg(adjust.dataset.adj, adjust.dataset.leg, adjust.dataset.to);
  const drop = e.target.closest("[data-drop]");
  if (drop) return toggleDrop(drop.dataset.drop, drop.dataset.leg);
  const replace = e.target.closest("[data-replace]");
  if (replace) {
    const p = byTicker.get(replace.dataset.replace);
    const legs = replacementLegs(p).map((l) => ({ ticker: l.buy_ticker, label: l.label }));
    const amount = Math.max(stakes[p.ticker] ?? DEFAULT_STAKE, 1);
    return startPlaceBet(legs, amount, () => {
      for (const edits of [dropped, adjusted, editing]) delete edits[p.ticker];
      touch(p.ticker);
    });
  }
  const row = e.target.closest(".bleg.tappable");
  if (!row) return;
  if (!("lines" in row.dataset)) return toggleDrop(row.dataset.p, row.dataset.leg);
  editing[row.dataset.p] = editing[row.dataset.p] === row.dataset.leg ? null : row.dataset.leg;
  update();
}

function toggleDrop(parlay, leg) {
  const set = (dropped[parlay] ??= new Set());
  if (set.has(leg)) set.delete(leg); else set.add(leg);
  if (!set.size) delete dropped[parlay];
  update();
}

/** Pick a line for a leg; picking its original line undoes the adjustment. Also un-drops it. */
function adjustLeg(parlay, leg, to) {
  const p = byTicker.get(parlay);
  const original = p?.legs.find((l) => l.ticker === leg);
  if (!original) return;
  const map = (adjusted[parlay] ??= new Map());
  if (to === original.buy_ticker) map.delete(leg); else map.set(leg, to);
  if (!map.size) delete adjusted[parlay];
  dropped[parlay]?.delete(leg);
  if (dropped[parlay] && !dropped[parlay].size) delete dropped[parlay];
  update();
}

export function installBets() {
  $("bets").addEventListener("click", onClick);
  $("bets").addEventListener("input", (e) => {
    if (e.target.dataset.stake) stakes[e.target.dataset.stake] = parseFloat(e.target.value) || DEFAULT_STAKE;
    if (e.target.dataset.addstake) adding[e.target.dataset.addstake] = parseFloat(e.target.value) || DEFAULT_STAKE;
  });
  $("bets").addEventListener("mouseover", (e) => { hovered = e.target.closest(".bcard")?.dataset.key ?? null; });
  $("bets").addEventListener("mouseleave", () => { hovered = null; });
  // Cards that scrolled out below the window may now change shape (see "Cards on the page")
  let settle = null;
  addEventListener("scroll", () => { clearTimeout(settle); settle = setTimeout(update, 200); }, { passive: true });
  new ResizeObserver(() => {
    const cols = $("betsCols");
    if (columns && cols && document.body.dataset.view === "bets" && columnCount(cols.clientWidth) !== columns) layout();
  }).observe($("bets"));
  load();  // fills the tab count right away
  setInterval(() => { if (document.body.dataset.view === "bets" && !document.hidden) load(); }, POLL_MS);
  setInterval(reorderLegs, REORDER_MS);
}
