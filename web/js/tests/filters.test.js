// Run from the repo root: node --test web/js/tests/*.test.js

import assert from "node:assert/strict";
import { test } from "node:test";
import { optionsFor, parlayId, passes, suggest } from "../filters.js";

const leg = (player, stat, line) => ({ player, stat, line });
const A = { ticker: "KXMVE-S2026X-AABN7QOAK", legs: [leg("Jarrett Allen", "REB", 10), leg("Nikola Jokić", "PTS", 25)] };
const B = { ticker: "KXMVE-S2026Y-QQ1234567", legs: [leg("Jarrett Allen", "PTS", 15)] };
const C = { ticker: "KXMVE-S2026Z-ZZ0000001", legs: [leg("Rudy Gobert", "REB", 8)] };

test("parlayId: last 6 characters of the ticker", () => {
  assert.equal(parlayId(A.ticker), "N7QOAK");
});

test("passes: player, then stat, then line; With and Without; all filters together", () => {
  const allen = { kind: "player", player: "Jarrett Allen", stat: null, line: null, hide: false };
  assert.deepEqual([A, B, C].filter((p) => passes(p, [allen])), [A, B]);
  assert.deepEqual([A, B, C].filter((p) => passes(p, [{ ...allen, stat: "REB" }])), [A]);
  assert.deepEqual([A, B, C].filter((p) => passes(p, [{ ...allen, stat: "REB", line: 8 }])), []);
  assert.deepEqual([A, B, C].filter((p) => passes(p, [{ ...allen, hide: true }])), [C]);
  const noJokic = { kind: "player", player: "Nikola Jokić", stat: null, line: null, hide: true };
  assert.deepEqual([A, B, C].filter((p) => passes(p, [allen, noJokic])), [B]);
});

test("passes: a parlay ID with With keeps its whole stack", () => {
  const f = { kind: "id", id: "N7QOAK", hide: false };
  assert.equal(passes(B, [f], [A, B]), true);
  assert.equal(passes(C, [f], [C]), false);
  assert.equal(passes(A, [{ ...f, hide: true }], [A, B]), false);
  assert.equal(passes(B, [{ ...f, hide: true }], [A, B]), true);
});

test("suggest: names without accents, word starts first, and IDs", () => {
  assert.deepEqual(suggest([A, B, C], "jokic").players.map((x) => x.name), ["Nikola Jokić"]);
  assert.deepEqual(suggest([A, B, C], "jarr").players.map((x) => [x.name, x.n]), [["Jarrett Allen", 2]]);
  assert.deepEqual(suggest([A, B, C], "7qo").ids, ["N7QOAK"]);
  assert.deepEqual(suggest([A, B, C], " ").players, []);
});

test("optionsFor: stat -> line -> parlay count", () => {
  const o = optionsFor([A, B, C], "Jarrett Allen");
  assert.deepEqual([...o.keys()], ["REB", "PTS"]);
  assert.equal(o.get("REB").get(10), 1);
});
