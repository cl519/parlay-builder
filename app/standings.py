"""
Every team's record from ESPN's standings, for the board: "7-5", last 10, streak and conference
seed, keyed by Kalshi team code. One call covers all 30 teams; it's cached for 10 minutes and a
failed fetch keeps the last good copy.
"""

import threading
import time

from live_stats import ESPN_TEAM
from net import get_json

STANDINGS_URL = "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings"
CACHE_SECONDS = 10 * 60

_cache = {"ts": 0.0, "data": None}
_lock = threading.Lock()


def parse_standings(data):
    """ESPN standings -> {team: {record, last10, streak, seed, conf}}."""
    teams = {}
    for conf in data.get("children", []):
        side = "East" if "East" in conf.get("name", "") else "West"
        for entry in conf.get("standings", {}).get("entries", []):
            stats = {s.get("name"): s.get("displayValue") for s in entry.get("stats", [])}
            abbr = entry["team"]["abbreviation"]
            seed = stats.get("playoffSeed")
            teams[ESPN_TEAM.get(abbr, abbr)] = {
                "record": stats.get("overall"),
                "last10": stats.get("Last Ten Games"),
                "streak": stats.get("streak"),
                "seed": int(float(seed)) if seed else None,
                "conf": side,
            }
    return teams


def standings_payload():
    with _lock:
        if not _cache["data"] or time.time() - _cache["ts"] > CACHE_SECONDS:
            try:
                _cache["data"] = {"teams": parse_standings(get_json(STANDINGS_URL))}
            except Exception as e:  # keep the last good records rather than blanking them
                _cache["data"] = _cache["data"] or {"teams": {}, "error": str(e)}
            _cache["ts"] = time.time()
        return _cache["data"]
