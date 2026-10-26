// Run from slip/: node --test "web/js/tests/*.test.js"

import assert from "node:assert/strict";
import { test } from "node:test";
import { columnCount, matchCards, shortestColumn, stickyOrder } from "../order.js";

test("columnCount: 520px cards with 16px gaps, 1 to 3 columns", () => {
  assert.equal(columnCount(375), 1);
  assert.equal(columnCount(1055), 1);
  assert.equal(columnCount(1056), 2);
  assert.equal(columnCount(1180), 2);
  assert.equal(columnCount(5000), 3);
});

test("shortestColumn: shortest wins, leftmost on a tie", () => {
  assert.equal(shortestColumn([300, 120, 120]), 1);
  assert.equal(shortestColumn([0, 0]), 0);
});

const rankOf = (ranks) => (id) => ranks[id];

test("stickyOrder: margin 0 is a plain stable sort", () => {
  assert.deepEqual(stickyOrder(["a", "b", "c", "d"], rankOf({ a: 0.9, b: 0.2, c: 0.9, d: 0.5 })), ["b", "d", "a", "c"]);
});

test("stickyOrder: near-ties don't swap", () => {
  const ranks = { a: 0.79, b: 0.78 };  // b is 1 point shakier: not enough to move
  assert.deepEqual(stickyOrder(["a", "b"], rankOf(ranks), 0.05), ["a", "b"]);
});

test("stickyOrder: a leg that got much shakier rises past several", () => {
  const ranks = { a: 0.6, b: 0.7, c: 0.8, d: 0.3 };
  assert.deepEqual(stickyOrder(["a", "b", "c", "d"], rankOf(ranks), 0.05), ["d", "a", "b", "c"]);
});

test("stickyOrder: a hit leg (rank 3) sinks to the bottom", () => {
  const ranks = { a: 3, b: 0.5, c: 0.9 };
  assert.deepEqual(stickyOrder(["a", "b", "c"], rankOf(ranks), 0.05), ["b", "c", "a"]);
});

test("stickyOrder: doesn't change the input", () => {
  const prev = ["a", "b"];
  stickyOrder(prev, rankOf({ a: 1, b: 0 }));
  assert.deepEqual(prev, ["a", "b"]);
});

test("matchCards: a card keeps its stack when the top parlay is gone and a replacement joined", () => {
  const cards = new Map([["P", ["P", "R1"]], ["Q", ["Q"]]]);
  const stacks = [["Q"], ["R1", "R2"]];  // P settled, R2 is a new replacement
  assert.deepEqual([...matchCards(cards, stacks)], [[0, "Q"], [1, "P"]]);
});

test("matchCards: new stacks stay unmatched", () => {
  const out = matchCards(new Map([["P", ["P"]]]), [["N"], ["P"]]);
  assert.equal(out.has(0), false);
  assert.equal(out.get(1), "P");
});

test("matchCards: when a stack splits, the bigger part keeps the card", () => {
  const cards = new Map([["P", ["P", "A", "B"]]]);
  const out = matchCards(cards, [["B"], ["P", "A"]]);
  assert.equal(out.get(1), "P");
  assert.equal(out.has(0), false);
});
