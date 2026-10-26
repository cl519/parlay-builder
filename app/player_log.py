"""
A player's recent games and season averages (ESPN's per-athlete game log), for the hover
card on a player's name, and their ESPN headshot for the board.

Kalshi only gives a name and a team, so the ESPN athlete is found on that team's roster.
Averages are computed from the same game list we show, rather than read from ESPN's
summary row, which can lag a game behind. Only finished regular-season games count.
"""

import threading
import time

from live_stats import ESPN_BASE, ESPN_TEAM, normalize_name
from net import get_json

ATHLETE_BASE = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes"
KALSHI_TO_ESPN = {kalshi: espn for espn, kalshi in ESPN_TEAM.items()}
ROSTER_SECONDS = 6 * 3600
LOG_SECONDS = 10 * 60
RECENT = 5
STATS = ("MIN", "FGM", "FGA", "3PM", "3PA", "PTS", "REB", "AST", "STL", "BLK")
HEADSHOT = "https://a.espncdn.com/i/headshots/nba/players/full/{}.png"  # ESPN's original (600x436, ~200KB), its largest

_rosters = {}  # Kalshi team code -> (fetched at, {normalized name: athlete id})
_photos = set()  # athlete ids ESPN has a headshot for
_logs = {}     # athlete id -> (fetched at, payload)
_lock = threading.Lock()


def find_athlete(roster, name):
    """Exact normalized name first; else a last name only one player on the roster has."""
    key = normalize_name(name)
    if key in roster:
        return roster[key]
    last = key.split(" ")[-1]
    same = [k for k in roster if k.split(" ")[-1] == last]
    return roster[same[0]] if len(same) == 1 else None


def _roster(team):
    with _lock:
        cached = _rosters.get(team)
    if cached and time.time() - cached[0] < ROSTER_SECONDS:
        return cached[1]
    espn = KALSHI_TO_ESPN.get(team, team).lower()
    athletes = get_json(f"{ESPN_BASE}/teams/{espn}/roster").get("athletes", [])
    roster = {normalize_name(a["displayName"]): a["id"] for a in athletes}
    with _lock:
        _rosters[team] = (time.time(), roster)
        _photos.update(a["id"] for a in athletes if a.get("headshot"))
    return roster


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def _made_tried(v):
    """ESPN's "5-12" -> (5, 12)."""
    made, _, tried = (v or "0-0").partition("-")
    return _int(made), _int(tried)


def parse_log(log):
    """ESPN game log -> {"games": newest first, finished regular-season only, "avg", "played"}."""
    idx = {label: i for i, label in enumerate(log.get("labels", []))}
    events = log.get("events", {})
    season = next((s for s in log.get("seasonTypes", []) if "Regular Season" in s.get("displayName", "")), {})
    games = []
    for cat in season.get("categories", []):
        for row in cat.get("events", []):
            ev = events.get(row.get("eventId"), {})
            if ev.get("gameResult") not in ("W", "L"):  # in progress or postponed
                continue
            stats = row.get("stats", [])
            get = lambda label: stats[idx[label]] if label in idx and idx[label] < len(stats) else None
            fgm, fga = _made_tried(get("FG"))
            tpm, tpa = _made_tried(get("3PT"))
            games.append({
                "date": ev.get("gameDate"),  # UTC instant; the page shows it in local time
                "opp": ev.get("opponent", {}).get("abbreviation", "?"),
                "at": ev.get("atVs") == "@",
                "result": ev["gameResult"],
                "MIN": _int(get("MIN")), "FGM": fgm, "FGA": fga, "3PM": tpm, "3PA": tpa,
                "PTS": _int(get("PTS")), "REB": _int(get("REB")), "AST": _int(get("AST")),
                "STL": _int(get("STL")), "BLK": _int(get("BLK")),
            })
    games.sort(key=lambda g: g["date"] or "", reverse=True)
    avg = {s: round(sum(g[s] for g in games) / len(games), 1) for s in STATS} if games else None
    return {"games": games[:RECENT], "avg": avg, "played": len(games)}


def player_payload(team, name):
    athlete = find_athlete(_roster(team), name)
    if athlete is None:
        return {"games": [], "avg": None, "played": 0, "missing": True}
    with _lock:
        cached = _logs.get(athlete)
    if cached and time.time() - cached[0] < LOG_SECONDS:
        return cached[1]
    payload = parse_log(get_json(f"{ATHLETE_BASE}/{athlete}/gamelog"))
    with _lock:
        _logs[athlete] = (time.time(), payload)
    return payload


def headshot_url(team, name):
    """The player's ESPN headshot, or None if they're not on the roster or have no photo."""
    athlete = find_athlete(_roster(team), name)
    with _lock:
        return HEADSHOT.format(athlete) if athlete in _photos else None
