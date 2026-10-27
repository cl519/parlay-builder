"""
Your open parlays, each leg annotated with what it needs and its live market chance.

Positions come from Kalshi (authenticated, via betting.open_positions); leg markets
are fetched in batches from the public API. Live stat/score progress is computed in
the browser from /api/live, so this module only describes the legs.
"""

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import betting
import nights
from menus import PUBLIC_BASE, SERIES
from net import get_json

CACHE_SECONDS = 15
BATCH = 50

_cache = {"ts": 0.0, "data": None, "refreshing": False}  # ts = when the cached build started
_cache_lock = threading.Lock()


def _dollars(v):
    return None if v in (None, "") else float(v)


def _markets(tickers):
    """Fetch markets 50 at a time (includes settled ones, with their result)."""
    chunks = [tickers[i:i + BATCH] for i in range(0, len(tickers), BATCH)]
    fetch = lambda chunk: get_json(f"{PUBLIC_BASE}/markets?limit={BATCH}&tickers={','.join(chunk)}").get("markets", [])
    with ThreadPoolExecutor(max_workers=4) as pool:
        return {m["ticker"]: m for batch in pool.map(fetch, chunks) for m in batch}


THIN = 0.10  # bid-ask gap at which the midpoint stops meaning anything (same as the board's thin dot)
LINE_KINDS = {"PTS", "REB", "AST", "3PT", "STL", "BLK", "STL+BLK", "total", "spread"}


def leg_chance(market, side):
    """
    Market-implied chance this leg comes in: 1/0 once settled, else the midpoint of its side.
    In a thin book (overnight, before makers show up: 23¢ bid / 70¢ ask) the midpoint is just
    the average of two far-off quotes, so use the last trade if it sits inside the spread,
    else the price you'd pay for this side, which is what Kalshi's app shows.
    """
    result = market.get("result")
    if result in ("yes", "no"):
        return 1.0 if result == side else 0.0
    if result == "scalar":  # player didn't play: settled at a fair price, which pays out as this
        value = _dollars(market.get("settlement_value_dollars"))
        return None if value is None else round(value if side == "yes" else 1 - value, 4)
    bid, ask = _dollars(market.get("yes_bid_dollars")), _dollars(market.get("yes_ask_dollars"))
    if bid is None or ask is None or ask <= 0:
        return None
    yes = (bid + ask) / 2
    if round(ask - bid, 4) >= THIN:
        last = _dollars(market.get("last_price_dollars"))
        yes = last if last and bid <= last <= ask else (ask if side == "yes" else bid)
    return round(yes if side == "yes" else 1 - yes, 4)


def family(ticker, side, kind):
    """
    What a leg asks, ignoring its line: Flagg 15+ PTS and 10+ PTS share a family, so a parlay
    with one swapped for the other is the same bet, adjusted. The line is the ticker's trailing
    number (…-DALCFLAGG32-15, …-261 for totals, …-MIA7 for spreads). Moneylines and anything
    else have no line, so their family is the market itself.
    """
    if kind not in LINE_KINDS:
        return f"{ticker}|{side}"
    head, last = ticker.rsplit("-", 1)
    return f"{head}-{last.rstrip('0123456789')}|{side}"


def _thin(market):
    bid, ask = _dollars(market.get("yes_bid_dollars")), _dollars(market.get("yes_ask_dollars"))
    return not market.get("result") and bid is not None and ask is not None and round(ask - bid, 4) >= THIN


def describe_leg(leg, market):
    """What a leg is (kind/stat/line/team) plus its status and chance - everything the UI needs."""
    ticker, side = leg["market_ticker"], leg["side"]
    series, game_key = ticker.split("-")[0], ticker.split("-")[1]
    kind = SERIES.get(series, "other")
    title = market.get("yes_sub_title") or ticker
    out = {
        "ticker": ticker,
        "buy_ticker": ticker if side == "yes" else ticker + ":no",  # how /api/prepare names this leg
        "side": side,
        "game": game_key,
        "kind": kind,
        "status": market.get("status"),            # active / closed / determined / finalized
        "result": market.get("result") or None,    # "yes" / "no" once decided; "scalar" = player didn't play
        "settled_value": _dollars(market.get("settlement_value_dollars")),  # the fair price a "scalar" leg counts as
        "chance": leg_chance(market, side),
        "thin": _thin(market),
        "family": family(ticker, side, kind),
    }
    if kind == "ml":
        out.update(team=ticker.rsplit("-", 1)[1], label=f"{ticker.rsplit('-', 1)[1]} ML")
    elif kind == "spread":
        fav = ticker.rsplit("-", 1)[1].rstrip("0123456789")
        x = float(market.get("floor_strike") or 0)
        dog = game_key[-3:] if fav == game_key[-6:-3] else game_key[-6:-3]
        out.update(team=fav if side == "yes" else dog, hcp=-x if side == "yes" else x,
                   label=f"{fav} -{x:g}" if side == "yes" else f"{dog} +{x:g}")
    elif kind == "total":
        x = float(market.get("floor_strike") or title.split()[1])
        out.update(line=x, dir="over" if side == "yes" else "under",
                   label=f"{'Over' if side == 'yes' else 'Under'} {x:g}")
    elif kind == "other":
        out.update(label=title if side == "yes" else f"NOT {title}")
    else:  # player prop
        name, line = title.rsplit(": ", 1) if ": " in title else (title, "0+")
        out.update(player=name, team=ticker.split("-")[2][:3],  # MILJJAQUEZ24 -> MIL, for the stats hover
                   stat=kind, line=int(line.rstrip("+")), label=f"{name} {line} {kind}")
    return out


def _build():
    positions = betting.open_positions()
    # A parlay just placed can come back without its legs for a moment: look them up again,
    # and if they're still missing leave it for the next poll rather than show a fake single
    bare = [p["ticker"] for p in positions if not p.get("legs") and p["ticker"].startswith("KXMVE")]
    found = _markets(bare) if bare else {}
    for p in positions:
        legs = (found.get(p["ticker"]) or {}).get("mve_selected_legs")
        if legs:
            p["legs"] = [{"market_ticker": l["market_ticker"], "side": l["side"]} for l in legs]
    positions = [p for p in positions if p.get("legs") or not p["ticker"].startswith("KXMVE")]
    for p in positions:  # a single bet is shown as a one-leg card
        p.setdefault("legs", [{"market_ticker": p["ticker"], "side": p["side"]}])
    tickers = sorted({l["market_ticker"] for p in positions for l in p["legs"]})
    markets = _markets(tickers)
    first = betting.first_bought([p["ticker"] for p in positions])
    parlays = []
    for p in positions:
        legs = [describe_leg(l, markets.get(l["market_ticker"], {})) for l in p["legs"]]
        chances = [l["chance"] for l in legs]
        est = None if any(c is None for c in chances) else round(_product(chances), 6)
        parlays.append({
            "ticker": p["ticker"],
            "contracts": p["quantity"],
            "avg_price": p["avg_price"],
            "cost": round(p["cost_dollars"] + p["fees_paid_dollars"], 2),
            "payout": round(p["quantity"], 2),
            "placed": first.get(p["ticker"]) or p.get("placed"),  # first buy, so Add more doesn't move it
            "est_chance": est,   # product of leg chances: ignores correlation, so a rough guide
            "single": len(legs) == 1,
            "legs": legs,
        })
    link_replacements(parlays)
    _legs.update({p["ticker"]: [l["ticker"] for l in p["legs"]] for p in parlays})
    return {"parlays": parlays, "tonight": _tonight(parlays), "updated": datetime.now(timezone.utc).isoformat()}


_legs = {}  # bet ticker -> its leg tickers (a single is its own leg); a bet's legs never change


def _tonight(parlays):
    """Tonight's money (see nights.py), or None if Kalshi's records couldn't be read this time."""
    try:
        fills, settlements = betting.recent_money()
        unknown = sorted({x["ticker"] for x in fills + settlements} - _legs.keys())
        combos = [t for t in unknown if t.startswith("KXMVE")]
        _legs.update({t: [t] for t in unknown if t not in combos})
        for t, m in _markets(combos).items():  # only looked up once; a failed lookup retries next time
            if m.get("mve_selected_legs"):
                _legs[t] = [l["market_ticker"] for l in m["mve_selected_legs"]]
        night = nights.slate_today()
        return {"night": night, "rows": nights.night_rows(night, fills, settlements, parlays, lambda t: _legs.get(t, []))}
    except Exception as e:
        print(f"tonight's money failed: {e}", flush=True)
        return None


def link_replacements(parlays):
    """
    Link each parlay to the smallest other parlay asking the same questions or more, compared
    by leg family (see `family`), so dropping legs, adding legs and adjusting lines all keep a
    parlay in its stack. Works for bets made anywhere, nothing stored.

    Two parlays with the same families but different legs (only lines adjusted) link the later
    one to the earlier, so links always point to a bigger parlay or an older one: no cycles.
    The exact same legs twice is just the same bet placed twice, not a stack.
    """
    # Singles stay out: a straight bet on one leg isn't a smaller version of a parlay
    combos = [p for p in parlays if not p.get("single")]
    fams = {p["ticker"]: {l.get("family") or f"{l['ticker']}|{l['side']}" for l in p["legs"]} for p in combos}
    legs = {p["ticker"]: {(l["ticker"], l["side"]) for l in p["legs"]} for p in combos}
    order = {p["ticker"]: (p.get("placed") or "", p["ticker"]) for p in combos}

    def contains(big, small):
        if fams[small] < fams[big]:
            return True
        return fams[small] == fams[big] and legs[small] != legs[big] and order[big] < order[small]

    for p in parlays:
        t = p["ticker"]
        found = [o for o in fams if t in fams and o != t and contains(o, t)]
        p["parent"] = min(found, key=lambda o: (len(fams[o]), order[o])) if found else None


def _product(xs):
    out = 1.0
    for x in xs:
        out *= x
    return out


def _store(started, data):
    """Keep a build unless a newer one (e.g. forced right after a bet) already landed."""
    with _cache_lock:
        if started >= _cache["ts"]:
            _cache["data"], _cache["ts"] = data, started


def _refresh():
    started = time.time()
    try:
        _store(started, _build())
    except Exception as e:  # keep serving the last good data; the next poll tries again
        print(f"bets refresh failed: {e}", flush=True)
    finally:
        with _cache_lock:
            _cache["refreshing"] = False


def bets_payload(force=False):
    """
    Stale-while-revalidate: once the cache is old, return it right away and rebuild in the
    background, so the page never waits (data is at most one poll behind). Waits only for the
    very first build, and when forced (right after a bet, so it shows up).
    """
    if force or not _cache["data"]:
        started = time.time()
        _store(started, _build())
        return _cache["data"]
    with _cache_lock:
        if time.time() - _cache["ts"] > CACHE_SECONDS and not _cache["refreshing"]:
            _cache["refreshing"] = True
            threading.Thread(target=_refresh, daemon=True).start()
        return _cache["data"]
