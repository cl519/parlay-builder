// Fraud Watch: players and teams you don't trust. Type a name to add one; on the board each gets
// a 🚩 by its name (a listed team: its headers and every one of its players). Saved on the
// server (~/.parlay/frauds.json), so every tab and browser has the same list.
//
// Shown in two places, the same list in each: a panel left of the games on wide windows, and a
// strip in the header on narrower ones (a sticky panel there would cover the games).

import { getJSON, post } from "./api.js";
import { esc, logoHTML, teamName } from "./format.js";
import { suggestFrauds } from "./fraudmatch.js";

let entries = [];
let gamesNow = () => [];
let changed = () => {};
const roots = [];

export const fraudPlayer = (name) => entries.some((e) => e.kind === "player" && e.name === name);
export const fraudTeam = (team) => entries.some((e) => e.kind === "team" && e.team === team);

// ---------- Saving ----------

let loaded = false;     // never save before the saved list is in: that would overwrite it
let saving = Promise.resolve();
let latest = 0;         // the newest change; older ones' replies are ignored

const showError = (text) => roots.forEach((r) => (r.el.querySelector(".fw-err").textContent = text));

export async function loadFrauds() {
  try {
    entries = (await getJSON("/api/frauds", { private: true })).entries;
    loaded = true;
    renderLists();
    changed();
  } catch (e) {
    showError(`Couldn't load your list: ${e.message}`);
  }
}

/** Show the change at once, then save it. Saves go one at a time, so the server ends on the newest. */
function save(next) {
  if (!loaded) { loadFrauds(); return; }
  const before = entries, n = ++latest;
  entries = next;
  renderLists();
  changed();
  saving = saving.then(() => post("/api/frauds", { entries: next })).then(
    (data) => { if (n === latest) entries = data.entries; },
    (e) => {
      if (n !== latest) return;
      entries = before;
      renderLists();
      changed();
      showError(`Couldn't save: ${e.message}`);
    });
}

// ---------- The panel ----------

const entryLabel = (e) => (e.kind === "team" ? teamName(e.team) : e.name);

function entryHTML(e, i) {
  return `<li class="fw-item">${logoHTML(e.team)}<span class="fw-name">${esc(entryLabel(e))}</span>`
    + `${e.kind === "player" ? `<span class="fw-team">${esc(e.team)}</span>` : ""}`
    + `<button data-fwdel="${i}" aria-label="Take ${esc(entryLabel(e))} off Fraud Watch">✕</button></li>`;
}

function renderLists() {
  for (const r of roots) {
    const list = r.el.querySelector(".fw-list");
    list.innerHTML = entries.map(entryHTML).join("")
      || '<li class="fw-empty">Nobody yet. Type a player or team above.</li>';
    r.el.querySelector(".fw-count").textContent = entries.length || "";
    r.el.classList.toggle("on", entries.length > 0);  // red only once someone's on it
    r.el.querySelector(".fw-err").textContent = "";
  }
}

function renderMenu(r) {
  const menu = r.el.querySelector(".fw-menu");
  if (!r.query.trim()) { menu.hidden = true; return; }
  r.options = suggestFrauds(gamesNow(), r.query, entries);
  menu.hidden = false;
  menu.innerHTML = r.options.length
    ? r.options.map((o, i) => `<button class="fw-opt ${i === r.active ? "on" : ""}" data-fwopt="${i}">${logoHTML(o.team)}`
      + `<span>${esc(o.kind === "team" ? teamName(o.team) : o.name)}</span><small>${o.kind === "team" ? "team" : esc(o.team)}</small></button>`).join("")
    : '<div class="fw-none">No player or team on the board matches</div>';
}

function add(r, option) {
  const { kind, name, team } = option;
  r.query = "";
  r.el.querySelector("input").value = "";
  renderMenu(r);
  save([...entries, kind === "team" ? { kind, team } : { kind, name, team }]);
}

/** Mount a Fraud Watch panel into `el` (call once per place it appears). */
export function mountFrauds(el, { games, onChange }) {
  gamesNow = games;
  changed = onChange;
  const r = { el, query: "", active: 0, options: [] };
  roots.push(r);
  el.innerHTML = `<div class="fw-head">🚩 Fraud Watch <span class="fw-count"></span></div>
    <div class="fw-search"><input type="search" placeholder="Add a player or team" autocomplete="off" spellcheck="false" aria-label="Add to Fraud Watch">
    <div class="fw-menu" hidden></div></div><ul class="fw-list"></ul><div class="fw-err"></div>`;
  const input = el.querySelector("input");
  input.addEventListener("input", () => { r.query = input.value; r.active = 0; renderMenu(r); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      r.active = (r.active + (e.key === "ArrowDown" ? 1 : -1) + r.options.length) % Math.max(r.options.length, 1);
      renderMenu(r);
    } else if (e.key === "Enter" && r.options[r.active]) add(r, r.options[r.active]);
    else if (e.key === "Escape") { r.query = ""; input.value = ""; renderMenu(r); }
  });
  el.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.fwopt != null) add(r, r.options[t.dataset.fwopt]);
    else if (t.dataset.fwdel != null) save(entries.filter((_, i) => i !== Number(t.dataset.fwdel)));
  });
  document.addEventListener("click", (e) => { if (!el.contains(e.target)) el.querySelector(".fw-menu").hidden = true; });
  input.addEventListener("focus", () => renderMenu(r));
  renderLists();
}
