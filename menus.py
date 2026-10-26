"""
Kalshi NBA markets -> per-game betting menus.

`assemble_games` is pure (markets in, menus out) so it can be unit tested;
`games_payload` adds fetching and a short cache.
"""

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from net import get_json

PUBLIC_BASE = "https://api.elections.kalshi.com/trade-api/v2"

# Kalshi series -> what it is on our menu
SERIES = {
    "KXNBAGAME": "ml",
    "KXNBATOTAL": "total",
    "KXNBASPREAD": "spread",
    "KXNBAPTS": "PTS",
    "KXNBAREB": "REB",
    "KXNBAAST": "AST",
    "KXNBA3PT": "3PT",
    "KXNBASTL": "STL",
    "KXNBABLK": "BLK",
    "KXNBASTOCK": "STL+BLK",
}
STATS = ["PTS", "REB", "AST", "3PT", "STL", "BLK", "STL+BLK"]

CACHE_SECONDS = 20
MILESTONE_TTL = 120

_cache = {"ts": 0.0, "data": None}
_cache_lock = threading.Lock()
_milestones = {}  # game event ticker -> (fetched_at, {"start": iso, "status": str})


def cents(value):
    """Kalshi dollar string ("0.5500") -> integer cents (55)."""
    if value in (None, ""):
        return None
    return round(float(value) * 100)


def _no_side(m, **fields):
    """The NO side of a market as its own leg ("TICKER:no"). Used for underdog spreads and unders."""
    return {
        "ticker": m["ticker"] + ":no",
        "event": m["event_ticker"],
        "ask": cents(m.get("no_ask_dollars")),
        "bid": cents(m.get("no_bid_dollars")),
        **fields,
    }


def assemble_games(markets_by_series):
    """Group raw Kalshi markets into one menu per game, each list ordered safest-first."""
    games = {}

    def game(key):
        return games.setdefault(key, {
            "key": key, "away": key[-6:-3], "home": key[-3:],
            "ml": [], "spread": [], "total": [], "players": {}, "sort": "",
        })

    for series, kind in SERIES.items():
        for m in markets_by_series.get(series, []):
            if m.get("status") != "active":
                continue
            g = game(m["event_ticker"].split("-", 1)[1])
            leg = {
                "ticker": m["ticker"],
                "event": m["event_ticker"],
                "ask": cents(m.get("yes_ask_dollars")),
                "bid": cents(m.get("yes_bid_dollars")),
            }
            if kind == "ml":
                team = m["ticker"].rsplit("-", 1)[1]
                g["ml"].append({**leg, "team": team, "label": m.get("yes_sub_title")})
                g["sort"] = m.get("occurrence_datetime") or ""
            elif kind == "spread":
                # Kalshi lists only "X wins by over N.5" (= X -N.5); its NO side is the opponent +N.5.
                fav = m["ticker"].rsplit("-", 1)[1].rstrip("0123456789")
                dog = g["home"] if fav == g["away"] else g["away"]
                line = float(m.get("floor_strike") or 0)
                g["spread"].append({**leg, "team": fav, "hcp": -line, "label": f"{fav} -{line:g}"})
                g["spread"].append(_no_side(m, team=dog, hcp=line, label=f"{dog} +{line:g}"))
            elif kind == "total":
                # "Over X" markets; their NO side is under X.
                line = float(m["yes_sub_title"].split()[1])
                g["total"].append({**leg, "line": line, "dir": "over", "label": f"Over {line:g}"})
                g["total"].append(_no_side(m, line=line, dir="under", label=f"Under {line:g}"))
            else:
                name, line = m["yes_sub_title"].rsplit(": ", 1)
                player = g["players"].setdefault(name, {
                    "name": name, "team": m["ticker"].split("-")[2][:3], **{s: [] for s in STATS},
                })
                player[kind].append({
                    **leg, "line": int(line.rstrip("+")), "label": f"{name} {line} {kind}",
                    "player": name, "stat": kind,
                })

    out = []
    for g in games.values():
        if not g["ml"]:
            continue  # props without an open moneyline belong to a finished game
        g["ml"].sort(key=lambda x: x["team"] != g["away"])
        g["spread"].sort(key=lambda x: -x["hcp"])
        g["total"].sort(key=lambda x: x["line"] if x["dir"] == "over" else -x["line"])
        players = list(g["players"].values())
        for p in players:
            for s in STATS:
                p[s].sort(key=lambda x: x["line"])
        # Home team first, then players with the most markets (starters) first
        players.sort(key=lambda p: (p["team"] != g["home"], -sum(len(p[s]) for s in STATS), p["name"]))
        g["players"] = players
        out.append(g)
    return out


def _series_markets(series):
    markets, cursor = [], None
    while True:
        url = f"{PUBLIC_BASE}/markets?series_ticker={series}&status=open&limit=1000"
        if cursor:
            url += f"&cursor={cursor}"
        data = get_json(url)
        markets += data.get("markets", [])
        cursor = data.get("cursor")
        if not cursor:
            return markets


def _milestone(event_ticker):
    """Scheduled tip-off + status. Market data has no start time; Kalshi milestones do."""
    hit = _milestones.get(event_ticker)
    if hit and time.time() - hit[0] < MILESTONE_TTL:
        return hit[1]
    info = {"start": None, "status": None}
    try:
        data = get_json(f"{PUBLIC_BASE}/milestones?limit=5&related_event_ticker={event_ticker}")
        for m in data.get("milestones", []):
            if m.get("type") == "basketball_game":
                info = {"start": m.get("start_date"), "status": m.get("details", {}).get("status")}
                break
    except Exception:
        pass
    _milestones[event_ticker] = (time.time(), info)
    return info


def _build():
    with ThreadPoolExecutor(max_workers=len(SERIES)) as pool:
        markets = dict(zip(SERIES, pool.map(_series_markets, SERIES)))
    games = assemble_games(markets)

    # Tip-off times only for games that already have props/totals (the next day or two)
    near = [g for g in games if g["players"] or g["total"]]
    with ThreadPoolExecutor(max_workers=8) as pool:
        for g, ms in zip(near, pool.map(lambda g: _milestone(f"KXNBAGAME-{g['key']}"), near)):
            g["start"], g["status"] = ms["start"], ms["status"]
            g["sort"] = ms["start"] or g["sort"]
    games.sort(key=lambda g: (g["sort"], g["key"]))
    return {"games": games, "updated": datetime.now(timezone.utc).isoformat()}


def games_payload(force=False):
    with _cache_lock:
        if force or not _cache["data"] or time.time() - _cache["ts"] > CACHE_SECONDS:
            _cache["data"] = _build()
            _cache["ts"] = time.time()
        return _cache["data"]
