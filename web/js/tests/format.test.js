// Run from the repo root: node --test web/js/tests/*.test.js

import assert from "node:assert/strict";
import { test } from "node:test";
import { esc, gameLabel } from "../format.js";

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
