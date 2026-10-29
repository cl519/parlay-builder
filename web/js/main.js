// Wiring: data loading, polling and user events. Rendering lives in board.js / slip.js.

import { getJSON } from "./api.js";
import { renderBoard, refreshBoard, renderDays, syncGroup } from "./board.js";
import { dayLabel, esc } from "./format.js";
import { startPlaceBet } from "./place.js";
import { installBalance } from "./balance.js";
import { installBets, refreshBetsProgress, showBets } from "./bets.js";
import { note, renderSlip, stake } from "./slip.js";
import {
  clearPicks, days, onPicksChangedElsewhere, pickedLegs, removePick, setDay, setLive, setMenus, state, togglePick,
} from "./state.js";
import { installTooltips } from "./tooltip.js";

const $ = (id) => document.getElementById(id);
const MENU_POLL_MS = 30000;
const LIVE_POLL_MS = 20000;
const HISTORY_POLL_MS = 60000;  // the server syncs every 5 minutes; this just picks it up

let liveSig = "";

async function loadMenus(force = false) {
  $("updated").textContent = "Updating…";
  try {
    const data = await getJSON("/api/games" + (force ? "?refresh=1" : ""));
    setMenus(data.games);
    renderDays(days(), dayLabel);
    refreshBoard();
    renderSlip();
    $("updated").textContent = "Prices as of " + new Date(data.updated).toLocaleTimeString();
  } catch (e) {
    $("updated").textContent = "Load failed: " + e.message;
    if (!state.games.length) $("games").innerHTML = `<div class="loading">Couldn't load games: ${esc(e.message)}</div>`;
  }
}

async function loadLive() {
  try {
    const data = await getJSON("/api/live");
    const sig = JSON.stringify(data.games || {});
    if (sig === liveSig) return;  // nothing changed
    liveSig = sig;
    setLive(data);
    if (state.games.length) { refreshBoard(); renderSlip(); }
    refreshBetsProgress();
  } catch { /* live stats are a nice-to-have; keep the last ones */ }
}

async function loadHits() {
  try {
    const data = await getJSON("/api/history", { private: true });
    if (JSON.stringify(data.rates) === JSON.stringify(state.hits)) return;
    state.hits = data.rates;
    if (state.games.length) refreshBoard();
  } catch { /* hit rates are a nice-to-have; keep the last ones */ }
}

/** Picks changed wholesale (cleared, placed, another tab): patch every button, redraw the slip. */
function refreshAll() {
  refreshBoard();
  renderSlip();
}

function onClick(e) {
  const chip = e.target.closest(".chip[data-t]");
  if (chip && !chip.disabled) {
    togglePick(chip.dataset.g, chip.dataset.t);
    syncGroup(chip.dataset.g);
    renderSlip();
    return;
  }
  const remove = e.target.closest("[data-rm]");
  if (remove) {
    removePick(remove.dataset.rm);
    syncGroup(remove.dataset.rm);
    renderSlip();
  }
}

// The current view lives in the URL (#build / #bets), so reloads, bookmarks and the
// back button all keep you where you were. Tabs are plain links that change the hash.
const VIEWS = ["build", "bets"];

function applyView() {
  const view = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "build";
  if (document.body.dataset.view === view) return;
  document.body.dataset.view = view;
  $("tabs").querySelectorAll("[data-view]").forEach((t) => t.classList.toggle("on", t.dataset.view === view));
  if (view === "bets") showBets();
  window.scrollTo(0, 0);
}

function onDayClick(e) {
  const button = e.target.closest("[data-day]");
  if (!button) return;
  setDay(button.dataset.day);
  renderDays(days(), dayLabel);
  renderBoard();
  window.scrollTo(0, 0);
}

document.addEventListener("click", onClick);
$("days").addEventListener("click", onDayClick);
$("slipHead").addEventListener("click", () => $("slip").classList.toggle("open"));
$("stake").addEventListener("input", renderSlip);
$("refresh").addEventListener("click", () => loadMenus(true));
$("clearBtn").addEventListener("click", () => { clearPicks(); refreshAll(); note("Slip cleared."); });
$("placeBtn").addEventListener("click", () =>
  startPlaceBet(pickedLegs(), stake(), () => { clearPicks(); refreshAll(); }, { canKeep: true }));
window.addEventListener("hashchange", applyView);
onPicksChangedElsewhere(refreshAll);
installTooltips();
installBets();
installBalance();

applyView();
loadMenus();
loadLive();
loadHits();
setInterval(loadMenus, MENU_POLL_MS);
setInterval(loadLive, LIVE_POLL_MS);
setInterval(loadHits, HISTORY_POLL_MS);
