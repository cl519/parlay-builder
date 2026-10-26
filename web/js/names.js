// Matching Kalshi player names to ESPN box scores. The server keys box scores by
// live_stats.normalize_name; normalizeName here must produce the same keys.

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

/** "Luka Dončić" -> "luka doncic", "Michael Porter Jr." -> "michael porter". */
export function normalizeName(name) {
  const ascii = name.replace(/’/g, "'").normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase();
  return ascii.replace(/[.,']/g, "").replace(/-/g, " ").split(/\s+/)
    .filter((w) => w && !SUFFIXES.has(w)).join(" ");
}

/**
 * A player's line in a box score ({ normalized name: stats }). Exact normalized match first;
 * otherwise a last-name match, but only when exactly one player in the game has it.
 */
export function findPlayer(box, name) {
  if (!box) return null;
  const key = normalizeName(name);
  if (box[key]) return box[key];
  const last = key.split(" ").at(-1);
  const sameLast = Object.keys(box).filter((k) => k.split(" ").at(-1) === last);
  return sameLast.length === 1 ? box[sameLast[0]] : null;
}
