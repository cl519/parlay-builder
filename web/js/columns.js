// DOM plumbing for My bets: fixed columns (a card stays in the column it was dealt into until
// the next layout) and in-place card updates, so nothing is rebuilt and nothing jumps.

import { Idiomorph } from "./vendor/idiomorph.esm.js";
import { columnCount, shortestColumn } from "./order.js";

const SLIDE_MS = 250;

/**
 * Deal `cards` (in order) into fresh columns, each into the shortest column so far. Heights are
 * measured, not estimated. Returns the column count. The wrapper keeps its height while the
 * cards are moved, so the page never shrinks and loses your scroll position mid-way.
 */
export function placeInColumns(wrap, cards) {
  const n = columnCount(wrap.clientWidth);
  wrap.style.minHeight = wrap.offsetHeight + "px";
  const cols = Array.from({ length: n }, () => Object.assign(document.createElement("div"), { className: "bets-col" }));
  wrap.replaceChildren(...cols);
  for (const el of cards) cols[shortestColumn(cols.map((c) => c.offsetHeight))].append(el);
  wrap.style.minHeight = "";
  return n;
}

export const onScreen = (el) => {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < innerHeight;
};

/** Entirely below the window: changing it can't move anything you see. */
export const belowScreen = (el) => {
  const r = el.getBoundingClientRect();
  return r.height > 0 && r.top >= innerHeight;
};

/**
 * Update a card to `html` in place: only what changed is touched, so bars animate, the box
 * you're typing in keeps its value, and a hovered name keeps its tooltip. With `slide`, leg
 * rows that changed places glide there instead of jumping (only worth doing on screen).
 */
export function patch(el, html, slide = false) {
  const before = slide && onScreen(el) ? rowTops(el) : null;
  Idiomorph.morph(el, html, { morphStyle: "innerHTML", ignoreActiveValue: true });
  if (!before) return;
  for (const row of el.querySelectorAll(".bleg[id]")) {
    const dy = before.get(row.id) - row.getBoundingClientRect().top;
    if (dy) row.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: SLIDE_MS, easing: "ease-out" });
  }
}

const rowTops = (el) => new Map([...el.querySelectorAll(".bleg[id]")].map((r) => [r.id, r.getBoundingClientRect().top]));
