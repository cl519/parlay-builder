"""
Live pricing and real-money bet placement. The only module that signs Kalshi requests.

Flow: preview_quote (free) while building the slip; prepare_bet fixes the price for the
confirm popup; place_bet buys at exactly that price or better, or nothing. Cashing out a
parlay is the same two steps in reverse: cashout_quote holds a maker's offer, cash_out sells.

A parlay (2+ legs) is priced by market makers through an RFQ: prepare_bet holds the best
quote and place_bet accepts it. A single bet is a plain order on that market's book:
prepare_bet works out what the stake buys there, and place_bet sends an order capped at
the worst price in that plan, cancelling whatever can't fill at once.
"""

import math
import threading
import time
import uuid

import kalshi as k
from config import QUOTE_TTL_SECONDS

_lock = threading.Lock()  # kalshi.py shares one HTTP client and rate limiter


class QuoteGone(Exception):
    """The quote shown in the confirm popup can no longer be accepted; a fresh one is needed."""
_pending = {}             # bet_id -> what the confirm popup shows (an RFQ id for parlays)


def initialize():
    k.initialize()


def open_positions():
    """Open positions (combos include their legs). Read-only."""
    with _lock:
        return k._open_positions()


def first_buy_times(fills):
    """{ticker: when you first bought it (ISO time)}, from fills of any markets."""
    out = {}
    for f in fills:
        t, when = f.get("ticker") or f.get("market_ticker"), f.get("created_time")
        if f.get("action") == "buy" and t and when and (t not in out or when < out[t]):
            out[t] = when
    return out


_first_buys = {}  # ticker -> first buy time (None if no fill found); it never changes


def first_bought(tickers):
    """
    {ticker: when you first bought it}. That's when a parlay was placed: a position's own
    last_updated_ts moves every time you add more. Reads your whole fill history (1000 per
    request, ~2 requests) only when there's a ticker it hasn't seen. Read-only; on failure
    the missing ones map to None and are retried next time.
    """
    missing = [t for t in tickers if t not in _first_buys]
    if missing:
        try:
            found = first_buy_times(_pages("/portfolio/fills", "fills"))
            _first_buys.update({t: found.get(t) for t in missing})
        except Exception:
            pass
    return {t: _first_buys.get(t) for t in tickers}


def _pages(path, key, max_pages=20, **params):
    """Every record a paginated portfolio endpoint has (1000 a page, 20,000 at most). Read-only."""
    out, cursor = [], None
    for _ in range(max_pages):
        with _lock:
            page = k._request("GET", path, params={"limit": 1000, **params, **({"cursor": cursor} if cursor else {})})
        out += page.get(key, [])
        cursor = page.get("cursor")
        if not cursor:
            break
    return out


def bought_since(ts):
    """Every ticker you've bought YES on since `ts` (parlays are always YES), archived fills included. Read-only."""
    fills = _pages("/historical/fills", "fills", max_pages=50, min_ts=ts) + _pages("/portfolio/fills", "fills", max_pages=50, min_ts=ts)
    return {f["ticker"] for f in fills if f.get("action") == "buy" and f.get("side") == "yes"}


def recent_money(days=3):
    """(fills, settlements) of the last `days`: enough for any bet on tonight's slate. Read-only."""
    since = int(time.time()) - days * 86400
    return _pages("/portfolio/fills", "fills", min_ts=since), _pages("/portfolio/settlements", "settlements", min_ts=since)


_combo_shard = None


def _shards():
    """({shard: cash}, the shard combos trade on). Call with _lock held."""
    global _combo_shard
    if _combo_shard is None:
        c = k._request("GET", f"/multivariate_event_collections/{k.DEFAULT_COMBO_COLLECTION}")
        _combo_shard = c.get("multivariate_contract", c)["exchange_index"]
    data = k._request("GET", "/portfolio/balance")
    return {b["exchange_index"]: float(b["balance"]) for b in data.get("balance_breakdown", [])}, _combo_shard


def balance():
    """
    Cash per exchange shard. Combos can only spend what's on the collection's shard,
    so that's the number that matters here; money elsewhere needs a transfer first.
    """
    with _lock:
        shards, combo = _shards()
    available = shards.get(combo, 0.0)
    return {
        "available": round(available, 2),
        "elsewhere": round(sum(shards.values()) - available, 2),
        "shard": combo,
    }


def _transfer(dollars, source, destination):
    """Move cash between your own shards. Call with _lock held."""
    amount = math.floor(dollars * 10000)  # dollars -> centicents
    if amount > 0 and source != destination:
        k._request("POST", "/portfolio/intra_exchange_instance_transfer", json={
            "source": "event_contract", "destination": "event_contract", "amount": amount,
            "source_exchange_shard": source, "destination_exchange_shard": destination,
        })


def move_funds_to_combo_shard():
    """Move all cash from every other shard onto the combo shard. Stays inside your account."""
    with _lock:
        shards, combo = _shards()
        for shard, cash in shards.items():
            _transfer(cash, shard, combo)
    return balance()


def taker_fee(contracts, price):
    """Kalshi taker fee: 7% x contracts x P x (1-P), rounded up to the cent."""
    return math.ceil(0.07 * contracts * price * (1 - price) * 100 - 1e-9) / 100


def best_yes_quote(quotes):
    """Cheapest maker quote that sells us YES. Buying YES = taking the maker's NO bid, at 1 - no_bid."""
    best = None
    for q in quotes:
        no_bid = k._dollars(q.get("no_bid_dollars")) or 0
        size = float(q.get("no_contracts_fp") or 0)
        if no_bid <= 0 or size <= 0:
            continue
        price = round(1 - no_bid, 4)
        if best is None or price < best["price"]:
            best = {"quote_id": q["id"], "price": price, "no_bid": q.get("no_bid_dollars"), "contracts": size}
    return best


def _summary(best, rfq, legs, quotes):
    principal = round(best["contracts"] * best["price"], 2)
    fee = taker_fee(best["contracts"], best["price"])
    return {
        "legs": len(legs),
        "quotes": len(quotes),
        "price": best["price"],
        "naive": rfq["naive_parlay_price"],
        "contracts": best["contracts"],
        "principal": principal,
        "fee": fee,
        "total": round(principal + fee, 2),
        "payout": round(best["contracts"], 2),
    }


def _delete_rfq(rfq_id):
    try:
        k._request("DELETE", f"/communications/rfqs/{rfq_id}")
    except Exception:
        pass


def _quote(legs, stake, wait_seconds):
    """Open an RFQ sized to `stake` dollars (fees included) and collect maker quotes."""
    with _lock:
        # Never clear a quote that a confirm popup is holding
        rfq = k._create_combo_rfq_for_cost(k.DEFAULT_COMBO_COLLECTION, legs, stake, keep=set(_pending))
        try:
            quotes = k._poll_quotes(rfq["rfq_id"], wait_seconds)
        except Exception:
            _delete_rfq(rfq["rfq_id"])
            raise
    return rfq, quotes


def preview_quote(legs, stake):
    """Live price for the slip while building it. No money moves; the RFQ is cancelled immediately."""
    if len(legs) == 1:
        return _single_summary(_single_plan(legs[0], stake))
    rfq, quotes = _quote(legs, stake, 1.5)
    with _lock:
        _delete_rfq(rfq["rfq_id"])
    best = best_yes_quote(quotes)
    if best is None:
        return {"error": "No maker quoted this combo yet"}
    return _summary(best, rfq, legs, quotes)


def _expire_abandoned():
    """Cancel prepared quotes nobody confirmed in time (e.g. the page was reloaded mid-popup)."""
    for bet_id, p in list(_pending.items()):
        if time.time() - p["ts"] > QUOTE_TTL_SECONDS:
            _pending.pop(bet_id, None)
            if not bet_id.startswith("single-"):  # a single holds nothing on Kalshi
                with _lock:
                    _delete_rfq(bet_id)


def prepare_bet(legs, stake):
    """REAL-MONEY step 1: hold the best quote so the confirm popup shows exactly what will fill."""
    _expire_abandoned()
    if len(legs) == 1:
        plan = _single_plan(legs[0], stake)
        bet_id = f"single-{uuid.uuid4()}"
        _pending[bet_id] = {**plan, "ts": time.time()}
        return {"bet_id": bet_id, **_single_summary(plan)}
    rfq, quotes = _quote(legs, stake, 3.0)
    best = best_yes_quote(quotes)
    if best is None:
        with _lock:
            _delete_rfq(rfq["rfq_id"])
        return {"error": "No market maker quoted this combo. Try fewer or different legs."}
    _pending[rfq["rfq_id"]] = {**best, "bid_field": "no_bid_dollars", "bid": best["no_bid"],
                               "ticker": rfq["combo_ticker"], "ts": time.time()}
    return {"bet_id": rfq["rfq_id"], **_summary(best, rfq, legs, quotes)}


def _accept_held(rfq_id, p, holding):
    """
    Accept the held quote only if it's still exactly what the popup showed; else QuoteGone.
    `holding` is the side we take: YES to buy a parlay, NO to sell one back (Kalshi nets it
    against our YES, closing the position). Call with _lock held.
    """
    if time.time() - p["ts"] > QUOTE_TTL_SECONDS:
        raise QuoteGone("That price is over 2 minutes old.")
    try:
        q = k._request("GET", f"/communications/rfqs/{rfq_id}/quotes/{p['quote_id']}").get("quote", {})
    except RuntimeError as e:
        if "404" in str(e):  # quote or whole request gone (maker pulled it, or another app replaced it)
            raise QuoteGone("That price was withdrawn before you confirmed.") from e
        raise
    if q.get("status") != "open" or q.get(p["bid_field"]) != p["bid"]:
        raise QuoteGone("The market maker pulled or changed that price.")
    return k._accept_and_track(rfq_id, p["quote_id"], holding, p["ticker"])


def place_bet(bet_id):
    """REAL-MONEY step 2: buy exactly what the confirm popup showed (or better), or nothing."""
    p = _pending.pop(bet_id, None)
    if not p:
        return {"error": "That quote isn't pending anymore.", "retry": True}
    if bet_id.startswith("single-"):
        return _place_single(p)
    started = time.time() - 5  # fills carry Kalshi's clock; allow a little skew
    with _lock:
        try:
            result = _accept_held(bet_id, p, "yes")
        except QuoteGone as e:
            return {"error": f"{e} Nothing was charged.", "retry": True}
        except Exception as e:
            return {"error": str(e)}
        finally:
            # Done with this request either way. Kalshi keeps a filled one open, and an open one
            # blocks re-pricing the same parlay and stake (409 already_exists, e.g. after Keep slip)
            _delete_rfq(bet_id)
    # Only this fill: the same parlay (same legs) may have been bought before
    fills = [f for f in result.get("fills") or [] if f.get("action") == "buy" and f.get("ts", 0) >= started]
    return {
        "status": result.get("quote_status"),
        "reason": result.get("cancellation_reason"),
        "filled": sum(float(f.get("count_fp") or 0) for f in fills),
        "price": p["price"],
        "fee": sum(float(f.get("fee_cost") or 0) for f in fills),
    }


def cancel_bet(bet_id):
    _pending.pop(bet_id, None)
    if not bet_id.startswith("single-"):  # a single holds nothing on Kalshi
        with _lock:
            _delete_rfq(bet_id)
    return {"ok": True}


# ---------- Cash out: sell a whole parlay back to market makers ----------
#
# Same RFQ as buying, other side: makers bid for YES too, and taking that bid sells our YES.
# This is what the Kalshi app's cash-out does (its fills show action "sell" at the maker's YES bid).

def best_cashout_bid(quotes, contracts):
    """Highest maker bid for YES that takes all `contracts`, or None (no bid usually means a dead parlay)."""
    best = None
    for q in quotes:
        bid = k._dollars(q.get("yes_bid_dollars")) or 0
        size = float(q.get("yes_contracts_fp") or 0)
        if bid <= 0 or size < contracts:
            continue
        if best is None or bid > best["price"]:
            best = {"quote_id": q["id"], "price": bid, "yes_bid": q.get("yes_bid_dollars")}
    return best


def cashout_quote(ticker):
    """Cash out step 1: hold the best offer for the whole parlay, for the confirm popup."""
    _expire_abandoned()
    with _lock:
        data = k._request("GET", "/portfolio/positions", params={"ticker": ticker, "count_filter": "position"})
    pos = next((m for m in data.get("market_positions", []) if m.get("ticker") == ticker), {})
    contracts = float(pos.get("position_fp") or 0)
    if contracts <= 0:
        raise ValueError("You don't hold this parlay anymore.")
    with _lock:
        rfq = k._open_rfq({"market_ticker": ticker, "contracts_fp": f"{contracts:.2f}", "rest_remainder": False},
                          keep=set(_pending))
        try:
            quotes = k._poll_quotes(rfq["id"], 3.0)
        except Exception:
            _delete_rfq(rfq["id"])
            raise
    best = best_cashout_bid(quotes, contracts)
    if best is None:
        with _lock:
            _delete_rfq(rfq["id"])
        return {"error": "No market maker will buy this parlay back right now. "
                         "That usually means a leg already lost or it's very unlikely to hit."}
    _pending[rfq["id"]] = {"quote_id": best["quote_id"], "bid_field": "yes_bid_dollars", "bid": best["yes_bid"],
                           "ticker": ticker, "price": best["price"], "ts": time.time()}
    proceeds = round(contracts * best["price"], 2)
    fee = taker_fee(contracts, best["price"])
    return {"bet_id": rfq["id"], "price": best["price"], "contracts": contracts, "quotes": len(quotes),
            "proceeds": proceeds, "fee": fee, "net": round(proceeds - fee, 2)}


def cash_out(bet_id):
    """REAL MONEY, cash out step 2: sell the whole parlay at exactly the offered price, or nothing."""
    p = _pending.pop(bet_id, None)
    if not p:
        return {"error": "That offer isn't pending anymore.", "retry": True}
    started = time.time() - 5  # fills carry Kalshi's clock; allow a little skew
    with _lock:
        try:
            result = _accept_held(bet_id, p, "no")
        except QuoteGone as e:
            return {"error": f"{e} Nothing was sold.", "retry": True}
        except Exception as e:
            return {"error": str(e)}
        finally:
            # Done with this request either way. Kalshi keeps a filled one open, and an open one
            # blocks re-pricing the same parlay and stake (409 already_exists, e.g. after Keep slip)
            _delete_rfq(bet_id)
    sold = [f for f in result.get("fills") or [] if f.get("action") == "sell" and f.get("ts", 0) >= started]
    filled = sum(float(f.get("count_fp") or 0) for f in sold)
    fee = sum(float(f.get("fee_cost") or 0) for f in sold)
    return {
        "status": result.get("quote_status"),
        "reason": result.get("cancellation_reason"),
        "sold": filled,
        "price": p["price"],
        "fee": round(fee, 2),
        "net": round(filled * p["price"] - fee, 2),
    }


# ---------- Single bets: one market, straight off its order book ----------

def _fee_estimate(levels):
    """Taker fee for buying `levels` ([(price, contracts)]), rounded up to the cent."""
    return math.ceil(sum(0.07 * c * p * (1 - p) for p, c in levels) * 100 - 1e-9) / 100


def fill_plan(asks, stake):
    """
    Whole contracts `stake` (fee included) buys from `asks` ([(price, size)], cheapest first).
    Returns [(price, contracts)] per level taken; empty if not even one contract fits.
    """
    taken = []
    for price, size in asks:
        lo, hi = 0, int(size)
        while lo < hi:  # most contracts at this level that still fit the stake
            mid = (lo + hi + 1) // 2
            levels = taken + [(price, mid)]
            if sum(p * c for p, c in levels) + _fee_estimate(levels) <= stake:
                lo = mid
            else:
                hi = mid - 1
        if lo:
            taken.append((price, lo))
        if lo < int(size):  # money ran out on this level; the next one only costs more
            break
    return taken


def _asks(ticker, side):
    """What it costs to buy `side`, cheapest first: buying YES takes a NO bid at 1 - bid, and vice versa."""
    book = k._request("GET", f"/markets/{ticker}/orderbook").get("orderbook_fp", {})
    bids = book.get("no_dollars" if side == "yes" else "yes_dollars") or []
    return sorted((round(1 - float(price), 4), float(size)) for price, size in bids)


def _single_plan(leg, stake):
    """What `stake` buys on one market right now. `leg` is 'TICKER' or 'TICKER:no'."""
    ticker, _, side = leg.partition(":")
    side = side or "yes"
    with _lock:
        market = k._request("GET", f"/markets/{ticker}").get("market", {})
        asks = _asks(ticker, side)
    if market.get("status") != "active":
        raise ValueError("This market isn't open for trading right now.")
    levels = fill_plan(asks, stake)
    if not levels:
        raise ValueError("Nobody is selling this right now at a price your stake covers.")
    contracts = sum(c for _, c in levels)
    principal = round(sum(p * c for p, c in levels), 2)
    return {
        "ticker": ticker, "side": side, "shard": market["exchange_index"],
        "contracts": contracts, "limit": max(p for p, _ in levels),
        "principal": principal, "fee": _fee_estimate(levels),
    }


def _single_summary(plan):
    """Same fields as a parlay quote, so the slip and confirm popup show both alike."""
    return {
        "legs": 1,
        "single": True,
        "price": round(plan["principal"] / plan["contracts"], 4),  # average over the levels taken
        "limit": plan["limit"],                                    # the order never pays more than this
        "contracts": plan["contracts"],
        "principal": plan["principal"],
        "fee": plan["fee"],
        "total": round(plan["principal"] + plan["fee"], 2),
        "payout": plan["contracts"],
    }


def _place_single(p):
    """
    REAL MONEY: buy up to the planned contracts at the planned worst price or better; whatever
    can't fill at once is cancelled. Cash lives on the combo shard, so it's lent to the market's
    shard for the order and whatever is left there comes straight back.
    """
    if time.time() - p["ts"] > QUOTE_TTL_SECONDS:
        return {"error": "That price is over 2 minutes old. Nothing was charged.", "retry": True}
    worst_case = p["contracts"] * p["limit"] + 0.07 * p["contracts"] * 0.25 + 0.01  # fee peaks at 50¢
    with _lock:
        shards, home = _shards()
        lend = max(0.0, worst_case - shards.get(p["shard"], 0.0)) if p["shard"] != home else 0.0
        if lend > shards.get(home, 0.0):
            return {"error": f"Not enough cash: this needs up to ${worst_case:.2f}. Nothing was charged."}
        try:
            _transfer(math.ceil(lend * 100) / 100, home, p["shard"])
            order = k._request("POST", "/portfolio/events/orders", json={
                "ticker": p["ticker"],
                "side": "bid" if p["side"] == "yes" else "ask",  # one book in YES terms: buying NO = selling YES
                "count": f"{p['contracts']:.2f}",
                "price": f"{p['limit'] if p['side'] == 'yes' else 1 - p['limit']:.4f}",
                "time_in_force": "immediate_or_cancel",
                "self_trade_prevention_type": "taker_at_cross",
                "client_order_id": str(uuid.uuid4()),
                "exchange_index": p["shard"],
            })
        except Exception as e:
            return {"error": str(e)}
        finally:
            if p["shard"] != home:
                try:
                    _transfer(_shards()[0].get(p["shard"], 0.0), p["shard"], home)
                except Exception:
                    pass  # it stays on that shard; the header's "Move $X here" button brings it back
    filled = float(order.get("fill_count") or 0)
    yes_price = float(order.get("average_fill_price") or 0)
    return {
        "status": "executed" if filled > 0 else "not filled",
        "reason": None if filled > 0 else "nobody was selling at your price anymore",
        "filled": filled,
        "requested": p["contracts"],
        # NO-side fills are reported in YES terms (unverified: no NO single has filled yet)
        "price": yes_price if p["side"] == "yes" else round(1 - yes_price, 4),
        "fee": round(float(order.get("average_fee_paid") or 0) * filled, 2),
    }
