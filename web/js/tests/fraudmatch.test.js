import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestFrauds } from "../fraudmatch.js";

const player = (name, team, lines = 1) => ({ name, team, PTS: Array(lines).fill({}), REB: [], AST: [], PRA: [], "3PT": [], STL: [], BLK: [], "STL+BLK": [] });
const games = [{ players: [player("Jaylen Brown", "BOS", 5), player("Bruce Brown", "TOR", 2), player("Kelly Olynyk", "SAS")] }];

test("teams by code or name, then players by word start and prop count", () => {
  assert.deepEqual(suggestFrauds(games, "bro").map((o) => o.name ?? o.team), ["BKN", "Jaylen Brown", "Bruce Brown"]);  // Brooklyn
  assert.deepEqual(suggestFrauds(games, "nyk").map((o) => o.name ?? o.team), ["NYK", "Kelly Olynyk"]);  // teams first
  assert.deepEqual(suggestFrauds(games, "knicks").map((o) => o.team), ["NYK"]);
  assert.deepEqual(suggestFrauds(games, "new york").map((o) => o.team), ["NYK"]);
  assert.deepEqual(suggestFrauds(games, "cavs").map((o) => o.team), ["CLE"]);
  assert.deepEqual(suggestFrauds(games, "los angeles").map((o) => o.team), ["LAC", "LAL"]);
});

test("leaves out who's already listed", () => {
  const listed = [{ kind: "player", name: "Jaylen Brown", team: "BOS" }, { kind: "team", team: "NYK" }];
  assert.deepEqual(suggestFrauds(games, "brown", listed).map((o) => o.name), ["Bruce Brown"]);
  assert.deepEqual(suggestFrauds(games, "knicks", listed), []);
});
