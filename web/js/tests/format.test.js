// Run from the repo root: node --test web/js/tests/*.test.js

import assert from "node:assert/strict";
import { test } from "node:test";
import { esc, foulsHTML, gameLabel, period } from "../format.js";

test("esc: markup in outside text shows as text", () => {
  assert.equal(esc('<img src=x onerror="alert(1)">'), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  assert.equal(esc("De'Aaron Fox & co"), "De&#39;Aaron Fox &amp; co");
});

test("esc: missing values are empty, numbers pass through", () => {
  assert.equal(esc(undefined), "");
  assert.equal(esc(null), "");
  assert.equal(esc(12), "12");
});

test("gameLabel escapes team codes", () => {
  assert.equal(gameLabel({ away: "BOS", home: "<b>" }), "BOS @ &lt;b&gt;");
});

test("foulsHTML: gray at 0-2, yellow at 3-4, red at 5, fouled out at 6", () => {
  assert.equal(foulsHTML(1), '<span class="fouls ">1 foul</span>');
  assert.equal(foulsHTML(2, true), '<span class="fouls ">2 PF</span>');
  assert.equal(foulsHTML(undefined), "");
  assert.match(foulsHTML(3), /warn">3 fouls</);
  assert.match(foulsHTML(4, true), /warn">4 PF</);
  assert.match(foulsHTML(5), /bad">5 fouls</);
  assert.match(foulsHTML(6), /bad">fouled out</);
});

test("period: ESPN's game status as a short quarter", () => {
  assert.equal(period("6:52 - 2nd"), "Q2");
  assert.equal(period("End of 3rd"), "End Q3");
  assert.equal(period("Halftime"), "Half");
  assert.equal(period("2:10 - OT"), "OT");
  assert.equal(period("0:30 - 2OT"), "2OT");
  assert.equal(period(undefined), "");
});
