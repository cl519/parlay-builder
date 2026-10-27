// The filter bar on My bets: type a player's name (or a parlay ID), narrow it to a stat and a
// line if you like, then keep only the parlays with such a leg ("With") or hide them
// ("Without"). Each filter is a pill and all pills apply together. Kept for this visit only:
// a filter left on from yesterday would hide parlays without you noticing.

import { esc } from "./format.js";
import { normalizeName } from "./names.js";

/** A parlay's short ID: the end of its Kalshi ticker (…-AABN7QOAK -> N7QOAK). */
export const parlayId = (ticker) => ticker.split("-").at(-1).slice(-6);

/** A filter's leg test: that player, and that stat and line if it names them. */
const legMatches = (leg, f) => leg.player === f.player && (!f.stat || leg.stat === f.stat) && (f.line == null || leg.line === f.line);

/**
 * Whether parlay `p` (in `stack`, the parlays stacked with it) passes every filter. A parlay ID
 * with "With" keeps its whole stack, so you can see which stack a parlay landed in.
 */
export function passes(p, filters, stack = [p]) {
  return filters.every((f) => {
    const has = f.kind === "id"
      ? (f.hide ? [p] : stack).some((m) => parlayId(m.ticker) === f.id)
      : p.legs.some((l) => legMatches(l, f));
    return has !== f.hide;
  });
}

/** Players (with how many parlays have them) and parlay IDs matching what was typed. */
export function suggest(parlays, query) {
  const q = normalizeName(query);
  if (!q) return { players: [], ids: [] };
  const count = new Map();
  for (const p of parlays) for (const name of new Set(p.legs.map((l) => l.player).filter(Boolean))) count.set(name, (count.get(name) ?? 0) + 1);
  const players = [...count].map(([name, n]) => ({ name, n, key: normalizeName(name) }))
    .filter((x) => x.key.includes(q))
    .sort((a, b) => Number(b.key.split(" ").some((w) => w.startsWith(q))) - Number(a.key.split(" ").some((w) => w.startsWith(q))) || b.n - a.n)
    .slice(0, 8);
  const id = query.trim().toUpperCase();
  const ids = id.length >= 3 ? parlays.map((p) => parlayId(p.ticker)).filter((x) => x.includes(id)).slice(0, 4) : [];
  return { players, ids };
}

/** stat -> line -> how many parlays have that leg, for one player. */
export function optionsFor(parlays, player) {
  const stats = new Map();
  for (const p of parlays) {
    for (const key of new Set(p.legs.filter((l) => l.player === player).map((l) => `${l.stat}|${l.line}`))) {
      const [stat, line] = key.split("|");
      if (!stats.has(stat)) stats.set(stat, new Map());
      stats.get(stat).set(Number(line), (stats.get(stat).get(Number(line)) ?? 0) + 1);
    }
  }
  return stats;
}

export const filterLabel = (f) => (f.kind === "id" ? `Parlay ${f.id}`
  : f.player + (f.stat ? ` · ${f.line != null ? `${f.line}+ ` : ""}${f.stat}` : ""));

// ---------- The bar ----------

// A funnel, not a magnifying glass: it narrows what's below rather than finding something new
const FUNNEL = '<svg class="ficon" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12l-4.5 5.5V13l-3 1.5V8.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';

export const filters = [];
let parlaysNow = () => [];
let changed = () => {};
let root = null;
let query = "";
let picked = null;  // { kind: "player", player, stat, line } or { kind: "id", id }: choosing With / Without
let active = 0;     // highlighted suggestion, for the arrow keys

/** Mount the bar into `el`. `parlays()` gives the latest parlays; `onChange()` runs after a filter change. */
export function mountFilters(el, { parlays, onChange }) {
  root = el;
  parlaysNow = parlays;
  changed = onChange;
  el.innerHTML = `<div class="fsearch">${FUNNEL}<input type="search" placeholder="Filter parlays by player or ID" autocomplete="off" spellcheck="false" aria-label="Filter parlays">
    <div class="fmenu" hidden></div></div><div class="fpills"></div><span class="fcount"></span>`;
  const input = el.querySelector("input");
  input.addEventListener("input", () => { query = input.value; picked = null; active = 0; renderMenu(); });
  input.addEventListener("focus", renderMenu);
  input.addEventListener("keydown", onKey);
  el.addEventListener("click", onClick);
  document.addEventListener("click", (e) => { if (!root.contains(e.target)) closeMenu(); });
  renderPills();
}

function options() {
  const { players, ids } = suggest(parlaysNow(), query);
  return [...players.map((x) => ({ pick: { kind: "player", player: x.name, stat: null, line: null }, label: x.name, n: x.n })),
    ...ids.map((id) => ({ pick: { kind: "id", id }, label: `Parlay ${id}` }))];
}

function renderMenu() {
  const menu = root.querySelector(".fmenu");
  if (picked) {
    menu.hidden = false;
    menu.innerHTML = pickedHTML();
    return;
  }
  const list = options();
  if (!query.trim()) { menu.hidden = true; return; }
  menu.hidden = false;
  menu.innerHTML = list.length
    ? list.map((o, i) => `<button class="fopt ${i === active ? "on" : ""}" data-fopt="${i}">${esc(o.label)}`
      + `${o.n ? `<span>${o.n} ${o.n === 1 ? "parlay" : "parlays"}</span>` : ""}</button>`).join("")
    : '<div class="fnone">No player or parlay ID matches</div>';
}

/** After picking a player: optional stat and line, then With or Without. */
function pickedHTML() {
  const chip = (attr, value, on, text) => `<button class="fchip ${on ? "on" : ""}" ${attr}="${esc(value)}">${text}</button>`;
  let body = "";
  if (picked.kind === "player") {
    const stats = optionsFor(parlaysNow(), picked.player);
    body += `<div class="frow"><span>Stat</span>${chip("data-fstat", "", !picked.stat, "Any")}${[...stats.keys()]
      .map((s) => chip("data-fstat", s, picked.stat === s, esc(s))).join("")}</div>`;
    if (picked.stat) {
      const lines = [...(stats.get(picked.stat) ?? new Map())].sort((a, b) => a[0] - b[0]);
      body += `<div class="frow"><span>Line</span>${chip("data-fline", "", picked.line == null, "Any")}${lines
        .map(([l, n]) => chip("data-fline", l, picked.line === l, `${l}+ <small>${n}</small>`)).join("")}</div>`;
    }
  }
  return `<div class="fpick"><button class="fback" data-fback title="Back to the list">‹</button><b>${esc(filterLabel(picked))}</b></div>${body}
    <div class="factions"><button class="btn primary" data-fadd="with">With</button><button class="btn" data-fadd="without">Without</button>
    <span class="note">${picked.kind === "id" ? "With: just its stack. Without: hide it" : "Parlays with a leg like this, or without one"}</span></div>`;
}

function renderPills() {
  root.querySelector(".fpills").innerHTML = filters.map((f, i) => `<span class="fpill ${f.hide ? "without" : "with"}">`
    + `<button data-fmode="${i}" title="Switch between With and Without">${f.hide ? "Without" : "With"}</button>`
    + `<span>${esc(filterLabel(f))}</span><button data-fdel="${i}" aria-label="Remove this filter">✕</button></span>`).join("");
}

/** "Showing 2 of 65 · Clear" while filters are on: the pills are the cause, this is the effect. */
export function renderCount(shown, total) {
  const el = root?.querySelector(".fcount");
  if (!el) return;
  const html = filters.length ? `Showing ${shown} of ${total} · <button class="fclear" data-fclear>Clear</button>` : "";
  if (el.innerHTML !== html) el.innerHTML = html;
}

function closeMenu() {
  picked = null;
  if (root) root.querySelector(".fmenu").hidden = true;
}

function apply() {
  renderPills();
  changed();
}

function add(hide) {
  filters.push({ ...picked, hide });
  query = "";
  root.querySelector("input").value = "";
  closeMenu();
  apply();
}

function onKey(e) {
  const list = picked ? [] : options();
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    active = (active + (e.key === "ArrowDown" ? 1 : -1) + list.length) % Math.max(list.length, 1);
    renderMenu();
  } else if (e.key === "Enter") {
    if (picked) add(false);
    else if (list[active]) { picked = list[active].pick; renderMenu(); }
  } else if (e.key === "Escape") {
    if (picked) { picked = null; renderMenu(); } else closeMenu();
  }
}

function onClick(e) {
  const t = e.target.closest("button");
  if (!t) return;
  e.stopPropagation();  // a re-rendered menu must not count as a click outside
  const d = t.dataset;
  if (d.fopt != null) { picked = options()[d.fopt].pick; renderMenu(); }
  else if (d.fback != null) { picked = null; renderMenu(); root.querySelector("input").focus(); }
  else if (d.fstat != null) { picked = { ...picked, stat: d.fstat || null, line: null }; renderMenu(); }
  else if (d.fline != null) { picked = { ...picked, line: d.fline === "" ? null : Number(d.fline) }; renderMenu(); }
  else if (d.fadd) add(d.fadd === "without");
  else if (d.fmode != null) { filters[d.fmode].hide = !filters[d.fmode].hide; apply(); }
  else if (d.fdel != null) { filters.splice(d.fdel, 1); apply(); }
  else if (d.fclear != null) { filters.length = 0; apply(); }
}
