"""
Money for one night's slate, from Kalshi's own records: what you paid in (buys + fees), what
came back (cash-outs + settlements), and what's locked in or still riding on open parlays.

A bet belongs to the night of its latest game, read from its legs' tickers (…-26OCT25MEMSAC-…),
so a bet placed the day before still counts for the night it's decided, and a late game that
settles after midnight stays on its night. Pure functions; the fetching is in betting.py.
"""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
ROLLOVER_HOURS = 6  # until 6am ET it's still last night's slate: late games end around 1am
MONTHS = {m: i + 1 for i, m in enumerate("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split())}


def slate_today(now=None):
    """The night on right now, as YYYY-MM-DD (ET, rolling over at 6am)."""
    now = now or datetime.now(timezone.utc)
    return (now.astimezone(ET) - timedelta(hours=ROLLOVER_HOURS)).date().isoformat()


def game_date(ticker):
    """KXNBAPTS-26OCT25MEMSAC-… -> 2026-10-25 (the event part starts YYMONDD), or None."""
    parts = ticker.split("-")
    key = parts[1] if len(parts) > 1 else ""
    try:
        return f"20{key[:2]}-{MONTHS[key[2:5]]:02d}-{int(key[5:7]):02d}"
    except (KeyError, ValueError):
        return None


def night_of(leg_tickers):
    """The night a bet is decided: its latest leg's game date (None if no leg has one)."""
    dates = [d for d in map(game_date, leg_tickers) if d]
    return max(dates) if dates else None


def fill_money(f):
    """
    (paid in, came back) for one fill, fees included. Kalshi records every fill as taking a
    side at that side's price; a sell takes the opposite side to close what you held, and each
    pair of opposite contracts pays $1 right away. So selling YES at 5¢ shows up as "sell no
    at 95¢" and returns $1 - 95¢ = 5¢ a contract.
    """
    count, fee = float(f["count_fp"]), float(f.get("fee_cost") or 0)
    price = float(f["yes_price_dollars"] if f["side"] == "yes" else f["no_price_dollars"])
    if f["action"] == "buy":
        return count * price + fee, 0.0
    return 0.0, count * (1 - price) - fee


def missed(leg):
    return leg.get("result") in ("yes", "no") and leg["result"] != leg["side"]


def night_rows(night, fills, settlements, parlays, legs_of):
    """
    One row per bet decided on `night`: {ticker, legs, staked, paid, locked, riding}.
      staked: buys + fees. paid: cash-outs + what settlements paid (revenue is in cents).
      locked: open parlays whose every leg Kalshi already settled your way (a didn't-play leg
              counts at its settled value). riding: the cost of open parlays still alive.
    `parlays` are the open ones from bets._build; `legs_of(ticker)` gives a bet's leg tickers.
    A parlay that settled between the two reads counts once, as paid.
    """
    rows = {}

    def row(ticker):
        if ticker not in rows:
            rows[ticker] = {"ticker": ticker, "legs": [{"ticker": t} for t in legs_of(ticker)],
                            "staked": 0.0, "paid": 0.0, "locked": 0.0, "riding": 0.0}
        return rows[ticker]

    mine = lambda t: night_of(legs_of(t)) == night
    for f in fills:
        if mine(f["ticker"]):
            paid_in, back = fill_money(f)
            r = row(f["ticker"])
            r["staked"] += paid_in
            r["paid"] += back
    settled = set()
    for s in settlements:
        if mine(s["ticker"]):
            settled.add(s["ticker"])
            row(s["ticker"])["paid"] += (s.get("revenue") or 0) / 100
    for p in parlays:
        if p["ticker"] in settled or not mine(p["ticker"]) or any(missed(l) for l in p["legs"]):
            continue
        r = row(p["ticker"])
        chances = [l.get("chance") for l in p["legs"]]
        if all(l.get("result") for l in p["legs"]) and None not in chances:
            value = p["payout"]
            for c in chances:
                value *= c
            r["locked"] += value
        else:
            r["riding"] += p["cost"]
    return [{**r, **{k: round(r[k], 2) for k in ("staked", "paid", "locked", "riding")}} for r in rows.values()]
