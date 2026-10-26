// Place bet: live price -> confirm popup -> buy at exactly that price or better (or nothing).
// Parlays are priced by market makers (a held quote); a single leg buys off the order book.

import { post, postOnExit } from "./api.js";
import { refreshBalance } from "./balance.js";
import { percent, usd } from "./format.js";

const $ = (id) => document.getElementById(id);
let pendingBet = null;

function showModal(title, body, actions = []) {
  $("modalTitle").textContent = title;
  $("modalBody").innerHTML = body;
  $("modalActions").innerHTML = actions
    .map((a, i) => `<button class="btn ${a.primary ? "primary" : ""}" data-action="${i}">${a.label}</button>`).join("");
  $("modalActions").className = "modal-actions" + (actions.length === 1 ? " one" : "");
  $("modalActions").querySelectorAll("[data-action]").forEach((btn) => {
    btn.onclick = actions[+btn.dataset.action].onClick;
  });
  $("modalBg").hidden = false;
}

const closeModal = () => { $("modalBg").hidden = true; };
const isOpen = () => !$("modalBg").hidden;
const row = (k, v, cls = "") => `<div class="kv ${cls}"><span>${k}</span><span class="v">${v}</span></div>`;

async function cancelPending() {
  if (!pendingBet) return;
  const id = pendingBet;
  pendingBet = null;
  try { await post("/api/cancel", { bet_id: id }); } catch { /* best effort */ }
}

// Closing or reloading the page with the confirm popup open would strand the held quote,
// and Kalshi then refuses a new quote for the same combo. Release it on the way out.
window.addEventListener("pagehide", () => {
  if (pendingBet) postOnExit("/api/cancel", { bet_id: pendingBet });
});

const cancelAction = { label: "Cancel", onClick: () => { cancelPending(); closeModal(); } };
const closeAction = { label: "Close", onClick: closeModal };

function showError(title, message) {
  showModal(title, `<div class="note err">${message}</div>`, [closeAction]);
}

/**
 * Quote -> confirm -> place. `legs` are [{ ticker }] (":no" suffix for NO sides).
 * `onPlaced` runs after a confirmed fill. With `canKeep`, the success popup also offers
 * "Keep slip", which closes without calling `onPlaced` (to keep building on the same legs).
 */
export async function startPlaceBet(legs, amount, onPlaced, { canKeep = false } = {}) {
  const asking = legs.length === 1 ? `Checking what ${usd(amount)} buys on the order book`
    : `Asking market makers to price ${legs.length} legs for ${usd(amount)}`;
  showModal("Getting live price…",
    `<div class="spinner"></div><div class="note center">${asking}. Nothing is charged yet.</div>`,
    [cancelAction]);

  let q;
  try {
    q = await post("/api/prepare", { legs, stake: amount });
  } catch (e) {
    return showError("Couldn't get a price", e.message);
  }
  pendingBet = q.bet_id;
  if (!isOpen()) return cancelPending();  // user cancelled while it was loading

  const priceNote = q.single
    ? `average · never pays more than ${percent(q.limit)}¢`
    : `${q.naive ? `(legs multiplied: ${percent(q.naive)}¢) ` : ""}best of ${q.quotes} quotes`;
  const terms = q.single
    ? "Buys at these prices or better. If someone buys first, you get fewer contracts and pay less; never a higher price."
    : "Quote held for 2 minutes. You'll get exactly this price or nothing.";
  showModal(q.single ? "Confirm single bet" : "Confirm bet",
    (q.single ? row("Bet", legs[0].label || legs[0].ticker) : row("Legs", q.legs))
    + row("Price per contract", `${percent(q.price)}¢`)
    + `<div class="note right">${priceNote}</div>`
    + row("Contracts", q.contracts.toFixed(2))
    + row("Cost + fee", `${usd(q.principal)} + ${usd(q.fee)}`)
    + row(q.single ? "Up to" : "Total charged", usd(q.total), "total")
    + row(q.single ? "Pays if it hits" : "Pays if every leg hits", usd(q.payout), "win")
    + `<div class="note">${terms}</div>`,
    [cancelAction, { label: `Confirm ${usd(q.total)}`, primary: true, onClick: () => confirm(legs, amount, onPlaced, canKeep) }]);
}

async function confirm(legs, amount, onPlaced, canKeep) {
  const id = pendingBet;
  pendingBet = null;
  showModal("Placing bet…", '<div class="spinner"></div>');
  try {
    const r = await post("/api/place", { bet_id: id });
    if (r.status === "executed" && r.filled > 0) {
      refreshBalance();
      const partial = r.requested && r.filled < r.requested ? ` of ${r.requested.toFixed(2)}` : "";
      showModal("✅ Bet placed",
        row("Filled", `${r.filled.toFixed(2)}${partial} contracts`)
        + row("Price", `${percent(r.price)}¢`)
        + row("Fee", usd(r.fee))
        + row("Pays if it hits", usd(r.filled), "win total"),
        canKeep
          ? [{ label: "Keep slip", onClick: closeModal },
             { label: "Clear slip", primary: true, onClick: () => { onPlaced(); closeModal(); } }]
          : [{ label: "Done", primary: true, onClick: () => { onPlaced(); closeModal(); } }]);
    } else {
      showError("Not filled", `The order didn't fill (${r.status || "unknown"}${r.reason ? ": " + r.reason : ""}). `
        + "Nothing was charged. Try again for a fresh price.");
    }
  } catch (e) {
    if (e.data?.retry) {
      // The held price vanished (maker pulled it, or another app on your account replaced it)
      showModal("Price expired", `<div class="note">${e.message} Prices move fast during live games.</div>`,
        [closeAction, { label: "Get new price", primary: true, onClick: () => startPlaceBet(legs, amount, onPlaced, { canKeep }) }]);
    } else {
      showError("Not placed", e.message);
    }
  }
}

/**
 * Cash out a parlay: get the best maker offer for the whole thing -> confirm -> sell at exactly
 * that price (or nothing). `p` is a card from /api/bets; `onSold` runs after a confirmed sale.
 */
export async function startCashOut(p, onSold) {
  showModal("Getting cash-out offer…",
    `<div class="spinner"></div><div class="note center">Asking market makers what they'd pay for your `
    + `${p.legs.length}-leg parlay. Nothing is sold yet.</div>`,
    [cancelAction]);

  let q;
  try {
    q = await post("/api/cashout-quote", { ticker: p.ticker });
  } catch (e) {
    return showError("No cash-out offer", e.message);
  }
  pendingBet = q.bet_id;
  if (!isOpen()) return cancelPending();  // user cancelled while it was loading

  const result = q.net - p.cost;
  showModal("Cash out?",
    row("You paid", usd(p.cost))
    + row("Pays if every leg hits", usd(p.payout))
    + row("Offer per contract", `${percent(q.price, 2)}¢`)
    + `<div class="note right">best of ${q.quotes} offers · ${q.contracts.toFixed(2)} contracts</div>`
    + row("Sale − fee", `${usd(q.proceeds)} − ${usd(q.fee)}`)
    + row("You get", usd(q.net), "total win")
    + row(result >= 0 ? "Profit" : "Loss", `${result >= 0 ? "+" : "−"}${usd(Math.abs(result))}`)
    + "<div class=\"note\">Sells the whole parlay. Offer held for 2 minutes: exactly this price or nothing.</div>",
    [cancelAction, { label: `Cash out ${usd(q.net)}`, primary: true, onClick: () => confirmCashOut(p, onSold) }]);
}

async function confirmCashOut(p, onSold) {
  const id = pendingBet;
  pendingBet = null;
  showModal("Cashing out…", '<div class="spinner"></div>');
  try {
    const r = await post("/api/cashout", { bet_id: id });
    if (r.status === "executed" && r.sold > 0) {
      refreshBalance();
      showModal("✅ Cashed out",
        row("Sold", `${r.sold.toFixed(2)} contracts at ${percent(r.price, 2)}¢`)
        + row("Fee", usd(r.fee))
        + row("You got", usd(r.net), "win total"),
        [{ label: "Done", primary: true, onClick: () => { onSold(); closeModal(); } }]);
    } else {
      showError("Not sold", `The maker didn't confirm (${r.status || "unknown"}${r.reason ? ": " + r.reason : ""}). `
        + "You still hold the parlay. Try again for a fresh offer.");
    }
  } catch (e) {
    if (e.data?.retry) {
      showModal("Offer expired", `<div class="note">${e.message} Offers move fast during live games.</div>`,
        [closeAction, { label: "Get new offer", primary: true, onClick: () => startCashOut(p, onSold) }]);
    } else {
      showError("Not sold", e.message);
    }
  }
}
