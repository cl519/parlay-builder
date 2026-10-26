// Run from the repo root: node --test web/js/tests/*.test.js

import assert from "node:assert/strict";
import { test } from "node:test";
import { findPlayer, normalizeName } from "../names.js";

test("normalizeName: accents, case, suffixes, punctuation (same rules as live_stats.normalize_name)", () => {
  assert.equal(normalizeName("Luka Dončić"), "luka doncic");
  assert.equal(normalizeName("Michael Porter Jr."), "michael porter");
  assert.equal(normalizeName("Day'Ron Sharpe"), "dayron sharpe");
  assert.equal(normalizeName("Shai Gilgeous-Alexander"), "shai gilgeous alexander");
  assert.equal(normalizeName("JALEN JOHNSON"), normalizeName("Jalen Johnson"));
  assert.equal(normalizeName("D’Angelo Russell"), normalizeName("DAngelo Russell"));
});

const BOX = { "luka doncic": { PTS: 30 }, "austin reaves": { PTS: 20 }, "jalen johnson": { PTS: 4 } };

test("findPlayer: exact match after normalizing", () => {
  assert.deepEqual(findPlayer(BOX, "Luka Dončić"), { PTS: 30 });
});

test("findPlayer: unique last name fallback", () => {
  assert.deepEqual(findPlayer(BOX, "Austin 'AR' Reaves"), { PTS: 20 });
});

test("findPlayer: ambiguous last name is not guessed", () => {
  assert.equal(findPlayer({ "jalen johnson": {}, "keldon johnson": {} }, "J. Johnson"), null);
});

test("findPlayer: player who hasn't played, or no box yet", () => {
  assert.equal(findPlayer(BOX, "Grayson Allen"), null);
  assert.equal(findPlayer(undefined, "Luka Dončić"), null);
});
