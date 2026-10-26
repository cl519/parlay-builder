// Bet slip: picked legs with live progress, plus a live combo price that re-quotes
// about a second after the slip stops changing.

import { post } from "./api.js";
import { cents, gameLabel, percent, usd } from "./format.js";
import { legProgress } from "./markets.js";
import { pickedLegs, state } from "./state.js";

const $ = (id) => document.getElementById(id);
const QUOTE_FIELDS = ["quotePrice", "quoteChance", "quoteCost", "quotePayout"];
const QUOTE_DEBOUNCE_MS = 1000;
const QUOTE_MAX_AGE_MS = 60000;

// Makers won't sell a parlay much below ~0.1¢, however many legs it has. Up to ~30 legs the best
// quote stays within 1.5x of the legs multiplied; once it's 3x+ the floor, not your legs, sets
// the price, and each extra leg adds risk without adding payout. (Measured 2026-10-22: 40 legs
// 3x, 50 legs 6x, 60 legs 28x, flattening at 0.08-0.09¢.)
const FLOOR_MARKUP = 3;

export function stake() {
  return Math.max(parseFloat($("stake").value) || 5, 1);
}

// A note describes the slip as it was when written ("Loaded 13 legs…"), so it reverts to
// the default hint as soon as the slip changes.
let defaultNote = null;
let noteFor = null;  // legsKey() the current note was written for; null while showing the default

const legsKey = () => Object.values(state.picks).map((l) => l.ticker).sort().join(",");

export function note(text, kind = "") {
  defaultNote ??= $("note").textContent;
  $("note").textContent = text;
  $("note").className = "note " + kind;
  noteFor = legsKey();
}

function expireNote() {
  if (noteFor === null || noteFor === legsKey()) return;
  $("note").textContent = defaultNote;
  $("note").className = "note";
  noteFor = null;
}

export function naivePrice() {
  const legs = pickedLegs();
  return legs.length < 2 ? null : legs.reduce((acc, l) => acc * (l.ask / 100), 1);
}

// ---------- Legs ----------

function progressHTML(leg) {
  const v = legProgress(leg);
  if (v == null) return "";
  return v >= leg.line ? ` <span class="prog done">✓ ${v}</span>` : ` <span class="prog">${v}/${leg.line}</span>`;
}

export function renderSlip() {
  const entries = Object.entries(state.picks);
  $("legCount").textContent = entries.length;
  expireNote();
  if (!entries.length) {
    $("legs").innerHTML = '<div class="empty">Tap a line to add it. Tap again to remove.</div>';
  } else {
    const order = state.games.map((g) => g.key);
    entries.sort((a, b) => order.indexOf(a[1].game) - order.indexOf(b[1].game));
    let html = "", currentGame = null;
    for (const [group, leg] of entries) {
      if (leg.game !== currentGame) {
        currentGame = leg.game;
        const g = state.games.find((x) => x.key === currentGame);
        html += `<div class="leg-game">${g ? gameLabel(g) : currentGame}</div>`;
      }
      html += `<div class="leg"><span class="t">${leg.label}${progressHTML(leg)}</span>`
        + `<span class="p">${cents(leg.ask)}</span><button data-rm="${group}" title="Remove">×</button></div>`;
    }
    $("legs").innerHTML = html;
  }
  scheduleQuote();
}

// ---------- Live price ----------

let quote = null;            // last preview for the current slip: { price, principal, fee, payout } or { error }
let quoteKey = "", quoteAt = 0;
let pendingKey = null;       // slip a price is scheduled or loading for
let timer = null, inFlight = false;

const slipKey = () => pickedLegs().map((l) => l.ticker).sort().join(",") + "|" + stake();

function scheduleQuote() {
  // Background refreshes re-render the slip; only re-quote if it changed, or the price is over a
  // minute old and you're actually looking at it (Build tab, visible window).
  const lookingAtSlip = !document.hidden && document.body.dataset.view === "build";
  if (slipKey() === quoteKey && (Date.now() - quoteAt < QUOTE_MAX_AGE_MS || !lookingAtSlip)) {
    clearTimeout(timer);  // back to a slip we already priced: drop the price we were about to fetch
    pendingKey = null;
    return paint();
  }
  if (slipKey() === pendingKey) return paint(true);  // a redraw, not a change: let the pending price finish
  clearTimeout(timer);
  if (!pickedLegs().length) { quote = null; pendingKey = null; return paint(); }
  pendingKey = slipKey();
  paint(true);
  timer = setTimeout(fetchQuote, QUOTE_DEBOUNCE_MS);
}

async function fetchQuote() {
  if (inFlight) return;  // the request in flight re-runs when it lands
  if (!$("modalBg").hidden) {  // a confirm popup is holding a quote; don't compete with it
    timer = setTimeout(fetchQuote, 2000);
    return;
  }
  inFlight = true;
  const key = slipKey();
  let result;
  try { result = await post("/api/preview", { legs: pickedLegs(), stake: stake() }); }
  catch (e) { result = { error: e.message }; }
  inFlight = false;
  // Keep the answer if it's still for the slip on screen. Compare the slip itself, not "did
  // anything redraw": background refreshes redraw every 20-30s, and a big slip takes ~6s to
  // price, so counting redraws threw away good answers over and over (endless skeleton).
  if (key !== slipKey()) return fetchQuote();
  quote = result;
  quoteKey = key;
  pendingKey = null;
  quoteAt = Date.now();
  paint();
}

/** Fill the price panel. While a new quote loads, old numbers are replaced by skeletons. */
function paint(loading = false) {
  const n = pickedLegs().length;
  const naive = naivePrice();
  $("naivePrice").textContent = naive == null ? "–" : `${percent(naive, 2)}¢`;
  $("quoteDot").className = "dot-live " + (loading ? "busy" : quote && !quote.error ? "on" : "");
  $("placeBtn").disabled = !n;
  $("placeBtn").textContent = n === 1 ? "Place single bet" : "Place bet";
  $("floorWarn").hidden = true;  // only a fresh quote can show it

  if (!n) {
    QUOTE_FIELDS.forEach((id) => ($(id).textContent = "–"));
    $("headPrice").textContent = "";
  } else if (loading) {
    const widths = { quotePrice: 44, quoteChance: 86, quoteCost: 92, quotePayout: 70 };
    for (const [id, w] of Object.entries(widths)) $(id).innerHTML = `<span class="skel" style="width:${w}px"></span>`;
    $("headPrice").innerHTML = '<span class="skel" style="width:32px"></span>';
  } else if (quote && !quote.error) {
    $("quotePrice").textContent = `${percent(quote.price)}¢`;
    $("quoteChance").textContent = `${percent(quote.price)}% · ${(1 / quote.price).toFixed(1)}x`;
    $("quoteCost").textContent = `${usd(quote.principal)} + ${usd(quote.fee)}`;
    $("quotePayout").textContent = usd(quote.payout);
    $("headPrice").textContent = `${(1 / quote.price).toFixed(1)}x`;
    paintFloorWarning(naive);
  } else if (quote?.error) {
    $("quotePrice").textContent = "no quote";
    ["quoteChance", "quoteCost", "quotePayout"].forEach((id) => ($(id).textContent = "–"));
    $("headPrice").textContent = "";
  }
}

/** Warn when the price sits at the makers' floor instead of reflecting the legs. */
function paintFloorWarning(naive) {
  const markup = naive ? quote.price / naive : 0;
  if (markup < FLOOR_MARKUP) return;
  $("floorWarn").innerHTML = `<b>At the makers' price floor.</b> You're paying ${Math.round(markup)}x what `
    + `these legs multiply to (${percent(naive, 3)}¢), so more legs add risk but barely raise the payout. `
    + "Dropping your shakiest legs would barely lower it.";
  $("floorWarn").hidden = false;
}
