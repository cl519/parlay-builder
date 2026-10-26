// Header balance: cash on the shard combos trade on, plus a button to move the rest there.
// Refreshed after each bet and every minute while the page is visible.

import { getJSON, post } from "./api.js";
import { usd } from "./format.js";

const $ = (id) => document.getElementById(id);
const POLL_MS = 60000;

function show(b) {
  $("balance").hidden = false;
  $("balanceAmt").textContent = usd(b.available);
  $("balance").classList.toggle("low", b.available < 1);
  $("balance").title = b.elsewhere > 0.004
    ? `Available for parlays. Another ${usd(b.elsewhere)} is on a different Kalshi shard and needs moving before you can bet it.`
    : "Available for parlays";
  $("balanceMove").hidden = !(b.elsewhere > 0.004);
  $("balanceMove").textContent = `Move ${usd(b.elsewhere)} here`;
}

export async function refreshBalance() {
  try { show(await getJSON("/api/balance", { private: true })); }
  catch { /* keep the last number */ }
}

async function moveFunds() {
  const button = $("balanceMove");
  button.disabled = true;
  button.textContent = "Moving…";
  try { show(await post("/api/move-funds", {})); }
  catch (e) { button.textContent = "Move failed"; button.title = e.message; }
  finally { button.disabled = false; }
}

export function installBalance() {
  $("balanceMove").addEventListener("click", moveFunds);
  refreshBalance();
  setInterval(() => { if (!document.hidden) refreshBalance(); }, POLL_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshBalance(); });
}
