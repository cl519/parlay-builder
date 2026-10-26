"""
Live scores and player box scores from ESPN's public site feed (Kalshi has scores but
no per-player stats), keyed by Kalshi game key.

Games are looked up by date, not taken from Kalshi's open markets: a game must stay
visible after its markets close, until every bet on it settles. A failed fetch keeps
the last good data, so missing data never reads as "not started". Players are keyed
by normalized name; the page matches Kalshi's names to them (web/js/names.js).
"""

import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from net import get_json

ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
ESPN_TEAM = {"GS": "GSW", "NO": "NOP", "NY": "NYK", "SA": "SAS", "UTAH": "UTA", "WSH": "WAS"}
NAME_SUFFIXES = {"jr", "sr", "ii", "iii", "iv"}
EASTERN = ZoneInfo("America/New_York")
CACHE_SECONDS = 15

_cache = {"ts": 0.0, "data": None}
_cache_lock = threading.Lock()
_boxes = {}  # espn_id -> (state when fetched, box score): last good copy; final ones are never refetched


def normalize_name(name):
    """'Luka Dončić' -> 'luka doncic', 'Michael Porter Jr.' -> 'michael porter'."""
    name = unicodedata.normalize("NFKD", name.replace("\u2019", "'")).encode("ascii", "ignore").decode().lower()
    for ch in ".,'":
        name = name.replace(ch, "")
    words = name.replace("-", " ").split()
    return " ".join(w for w in words if w not in NAME_SUFFIXES)


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def _made_attempted(value):
    made, _, attempted = (value or "0-0").partition("-")
    return _int(made), _int(attempted)


def parse_box(summary):
    """ESPN game summary -> {normalized name: stats}. Players who haven't played are left out."""
    players = {}
    for team in summary.get("boxscore", {}).get("players", []):
        for block in team.get("statistics", []):
            labels = block.get("labels", [])
            for athlete in block.get("athletes", []):
                row = dict(zip(labels, athlete.get("stats", [])))
                if not row:
                    continue
                fgm, fga = _made_attempted(row.get("FG"))
                tpm, tpa = _made_attempted(row.get("3PT"))
                players[normalize_name(athlete["athlete"]["displayName"])] = {
                    "MIN": _int(row.get("MIN")), "PTS": _int(row.get("PTS")),
                    "REB": _int(row.get("REB")), "AST": _int(row.get("AST")),
                    "STL": _int(row.get("STL")), "BLK": _int(row.get("BLK")),
                    "FGM": fgm, "FGA": fga, "3PM": tpm, "3PA": tpa,
                }
    return players


def parse_out(summary):
    """
    ESPN game summary -> {normalized name: why} for players who are out tonight: listed "Out"
    on the injury report, or marked did-not-play in the box score. Kalshi doesn't flag this;
    their props settle at a fair price later (result "scalar"), so the leg isn't a loss.
    """
    out = {}
    for team in summary.get("injuries", []):
        for i in team.get("injuries", []):
            name = i.get("athlete", {}).get("displayName")
            if name and i.get("status") == "Out":
                why = (i.get("details") or {}).get("type")
                out[normalize_name(name)] = f"Out ({why.lower()})" if why else "Out"
    for team in summary.get("boxscore", {}).get("players", []):
        for block in team.get("statistics", []):
            for athlete in block.get("athletes", []):
                if athlete.get("didNotPlay"):
                    key = normalize_name(athlete["athlete"]["displayName"])
                    why = athlete.get("reason")
                    out.setdefault(key, f"Did not play ({why.lower()})" if why else "Did not play")
    return out


def _scoreboard(day):
    """ESPN games on one US-Eastern date, keyed like Kalshi's game keys, e.g. '26OCT22CLEPHI'."""
    games = {}
    for ev in get_json(f"{ESPN_BASE}/scoreboard?dates={day:%Y%m%d}").get("events", []):
        teams = {c["homeAway"]: c for c in ev["competitions"][0]["competitors"]}
        code = lambda side: ESPN_TEAM.get(teams[side]["team"]["abbreviation"], teams[side]["team"]["abbreviation"])
        status = ev["status"]["type"]
        games[f"{day:%y%b%d}".upper() + code("away") + code("home")] = {
            "espn_id": ev["id"],
            "state": status.get("state"),          # pre / in / post
            "detail": status.get("shortDetail"),   # "6:52 - 2nd", "Final"
            "away_score": _int(teams["away"].get("score")),
            "home_score": _int(teams["home"].get("score")),
        }
    return games


def _box(game):
    """
    (box score, who's out) for a started game. A final one is fetched once; a failed fetch
    keeps the last copy.
    """
    espn_id = game["espn_id"]
    cached = _boxes.get(espn_id)
    if cached and cached[0] == "post":
        return cached[1]
    try:
        summary = get_json(f"{ESPN_BASE}/summary?event={espn_id}")
        _boxes[espn_id] = (game["state"], (parse_box(summary), parse_out(summary)))
    except Exception:
        pass
    return _boxes.get(espn_id, (None, ({}, {})))[1]


def _build():
    today = datetime.now(EASTERN).date()
    games = {}
    for day in (today - timedelta(days=1), today):  # yesterday too: late finishes, bets awaiting settlement
        games.update(_scoreboard(day))
    started = [g for g in games.values() if g["state"] in ("in", "post")]
    with ThreadPoolExecutor(max_workers=6) as pool:
        for g, (box, out) in zip(started, pool.map(_box, started)):
            g["players"], g["out"] = box, out
    out = {key: {k: v for k, v in g.items() if k != "espn_id"} for key, g in games.items()}
    return {"games": out, "updated": datetime.now(timezone.utc).isoformat()}


def live_payload():
    with _cache_lock:
        if not _cache["data"] or time.time() - _cache["ts"] > CACHE_SECONDS:
            try:
                _cache["data"] = _build()
            except Exception as e:  # keep showing the last good data rather than blanking every game
                _cache["data"] = _cache["data"] or {"games": {}, "error": str(e)}
            _cache["ts"] = time.time()
        return _cache["data"]
