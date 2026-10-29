"""
Your record on each player prop you've bet this season, for the "Hit rate" rows on Build.

Kept in ~/.parlay/history.json, outside the repo. A leg's result never changes, so each one is
looked up once and every sync after the first only reads what was bought since. Counted per
night, not per parlay: Podziemski 10+ PTS in 25 parlays on one night is one bet, hit or missed
once. Parlays come from your fills, so ones you cashed out count too.
"""

import json
import os
import threading
import time
from datetime import datetime, timezone

import betting
import kalshi
from bets import describe_leg
from menus import PUBLIC_BASE, SERIES
from net import get_json
from nights import game_date

SEASON_START = "2026-10-01"  # legs from games before this (last season) aren't counted
SYNC_SECONDS = 300
OVERLAP = 3600               # re-read the last hour of fills each sync, in case one arrived late
BATCH = 50
NOT_PROPS = {"ml", "spread", "total", "other"}

_lock = threading.Lock()
_data = None  # what's in history.json, once loaded


def _path():
    return os.path.join(kalshi.HOME, "history.json")


def _empty():
    return {"since": None, "combos": [], "open": [], "legs": {}}


def _load():
    try:
        with open(_path()) as f:
            return {**_empty(), **json.load(f)}
    except (OSError, ValueError):  # first run, or a damaged file: it's rebuilt from Kalshi
        return _empty()


def _save(data):
    tmp = _path() + ".tmp"
    with open(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:  # only you can read it
        json.dump(data, f)
    os.replace(tmp, _path())  # all or nothing: a crash mid-write never leaves half a file


def _fetch(path, tickers):
    """Markets by ticker, 50 a request, retrying Kalshi's rate limit. Missing ones are left out."""
    out = {}
    for i in range(0, len(tickers), BATCH):
        chunk = ",".join(tickers[i:i + BATCH])
        for attempt in range(4):
            try:
                out.update({m["ticker"]: m for m in get_json(f"{PUBLIC_BASE}{path}?limit={BATCH}&tickers={chunk}").get("markets", [])})
                break
            except Exception:
                time.sleep(2 * (attempt + 1))
    return out


def _markets(tickers):
    """Live markets first, then Kalshi's archive (markets settled before its cutoff move there)."""
    found = _fetch("/markets", tickers)
    missing = [t for t in tickers if t not in found]
    return {**found, **(_fetch("/historical/markets", missing) if missing else {})}


def _is_prop(ticker):
    return SERIES.get(ticker.split("-")[0], "other") not in NOT_PROPS and (game_date(ticker) or "") >= SEASON_START


def sync():
    """Read what you've bought since last time, then look up any legs not settled yet."""
    global _data
    data = _load() if _data is None else _data
    started = int(time.time())
    since = data["since"] or int(datetime.fromisoformat(SEASON_START).replace(tzinfo=timezone.utc).timestamp())
    bought = betting.bought_since(since - OVERLAP)

    done = set(data["combos"])
    combos = sorted(t for t in bought if t.startswith("KXMVE") and t not in done)
    legs = set(data["open"]) | {t for t in bought if _is_prop(t)}  # singles count as bets too
    for t, m in _markets(combos).items():
        selected = m.get("mve_selected_legs") or []
        if not selected:
            continue  # legs not listed yet: try again next sync
        legs |= {l["market_ticker"] for l in selected if l.get("side") == "yes" and _is_prop(l["market_ticker"])}
        done.add(t)

    legs -= set(data["legs"])
    still_open = []
    found = _markets(sorted(legs))
    for t in sorted(legs):
        leg = describe_leg({"market_ticker": t, "side": "yes"}, found.get(t, {}))
        if leg["kind"] in NOT_PROPS:
            continue
        if leg["result"] in ("yes", "no"):
            data["legs"][t] = [leg["player"], leg["stat"], leg["line"], game_date(t), leg["result"] == "yes"]
        elif leg["result"] == "scalar":
            data["legs"][t] = None  # he didn't play: neither a hit nor a miss
        else:
            still_open.append(t)

    data.update(since=started, combos=sorted(done), open=still_open)
    with _lock:
        _data = data
    _save(data)


def hit_rates():
    """{"Player|PTS|15": [hits, nights]} for every prop line you've bet that has settled."""
    with _lock:
        data = _data
    if data is None:
        return {"ready": False, "rates": {}}
    rates = {}
    for leg in data["legs"].values():
        if leg:
            player, stat, line, _, hit = leg
            r = rates.setdefault(f"{player}|{stat}|{line}", [0, 0])
            r[0] += hit
            r[1] += 1
    return {"ready": True, "rates": rates}


def start():
    """Keep the file current in the background: the first sync takes about a minute."""
    def loop():
        while True:
            try:
                sync()
            except Exception as e:
                print(f"History sync failed (will retry): {e}", flush=True)
            time.sleep(SYNC_SECONDS)
    threading.Thread(target=loop, daemon=True).start()
