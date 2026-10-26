"""
A small Kalshi API client: signed requests, your positions, and parlay (combo) quotes.

Credentials come from ~/.parlay/config.json, written by `./parlay setup`:
  {"key_id": "...", "private_key": "~/.parlay/kalshi_private_key.pem"}
Both kinds of Kalshi API key work (Ed25519, Kalshi's default for new keys, and RSA).

Request signing and the combo helpers started as code from yakub268/kalshi-mcp
(MIT, see LICENSES/kalshi-mcp.txt). Not thread-safe on its own: betting.py serializes calls.
"""

import base64
import json
import logging
import os
import time
from typing import Dict, List, Optional

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

logger = logging.getLogger("kalshi")

API_BASE = "https://api.elections.kalshi.com/trade-api/v2"
HOME = os.path.expanduser(os.environ.get("PARLAY_HOME", "~/.parlay"))
CONFIG_PATH = os.path.join(HOME, "config.json")
MIN_REQUEST_INTERVAL = 0.15  # Kalshi's rate limit: stay under ~6 requests a second
DEFAULT_COMBO_COLLECTION = "KXMVESPORTSMULTIGAMEEXTENDED-R"  # NBA parlays live here

key_id = None
private_key = None
http_client: Optional[httpx.Client] = None
last_request_time = 0.0


class NotSetUp(Exception):
    """No usable API key yet: run ./parlay setup."""


def load_config():
    """{key_id, private_key (path)} from ~/.parlay/config.json, or NotSetUp."""
    try:
        with open(CONFIG_PATH) as f:
            config = json.load(f)
    except FileNotFoundError:
        raise NotSetUp(f"No API key set up yet ({CONFIG_PATH} is missing). Run: ./parlay setup") from None
    if not config.get("key_id") or not config.get("private_key"):
        raise NotSetUp(f"{CONFIG_PATH} needs key_id and private_key. Run: ./parlay setup")
    return config


def load_private_key(path):
    """The key file Kalshi gave you (Ed25519 or RSA, PEM text; the download is a .txt)."""
    with open(os.path.expanduser(path), "rb") as f:
        return serialization.load_pem_private_key(f.read(), password=None)


def sign(key, text):
    """
    Kalshi's request signature: the key signs `text`, base64. Ed25519 signs it as is; RSA uses
    PSS padding with SHA-256. Which one is decided by the key itself (from Kalshi's docs).
    """
    message = text.encode("utf-8")
    if isinstance(key, Ed25519PrivateKey):
        signature = key.sign(message)
    else:
        signature = key.sign(message, padding.PSS(mgf=padding.MGF1(hashes.SHA256()),
                                                  salt_length=padding.PSS.DIGEST_LENGTH), hashes.SHA256())
    return base64.b64encode(signature).decode("utf-8")


def initialize():
    """Load the API key. Raises NotSetUp (or the key file's own error) if it can't."""
    global key_id, private_key, http_client
    config = load_config()
    key_id = config["key_id"]
    private_key = load_private_key(config["private_key"])
    http_client = httpx.Client()


def _request(method: str, endpoint: str, retry: int = 0, **kwargs) -> Dict:
    """A signed request to Kalshi, at most one per 150ms; retries a 429 up to 3 times."""
    global last_request_time
    elapsed = time.time() - last_request_time
    if elapsed < MIN_REQUEST_INTERVAL:
        time.sleep(MIN_REQUEST_INTERVAL - elapsed)
    last_request_time = time.time()

    # Signed text: timestamp (ms) + method + path, without the query string
    timestamp = int(time.time() * 1000)
    headers = {
        "KALSHI-ACCESS-KEY": key_id,
        "KALSHI-ACCESS-SIGNATURE": sign(private_key, f"{timestamp}{method.upper()}/trade-api/v2{endpoint}"),
        "KALSHI-ACCESS-TIMESTAMP": str(timestamp),
        "Content-Type": "application/json",
    }
    kwargs.setdefault("timeout", 30)
    try:
        response = http_client.request(method, f"{API_BASE}{endpoint}", headers=headers, **kwargs)
        if response.status_code == 429 and retry < 3:
            time.sleep((2 ** retry) * 0.5)
            return _request(method, endpoint, retry=retry + 1, **kwargs)
        response.raise_for_status()
        # Some endpoints (e.g. accepting a quote) return 204 No Content
        if response.status_code == 204 or not response.content:
            return {}
        return response.json()
    except httpx.HTTPStatusError as e:
        logger.error(f"Kalshi API error {e.response.status_code}: {e.response.text}")
        raise RuntimeError(f"{e.response.status_code} {e.response.reason_phrase}: {e.response.text}") from e


def _dollars(value) -> Optional[float]:
    return None if value in (None, "") else float(value)


# ---------- Positions ----------

def _open_positions() -> List[Dict]:
    """Non-zero market positions, with combo legs spelled out."""
    data = _request("GET", "/portfolio/positions", params={"count_filter": "position"})
    # position_fp is signed: positive = YES contracts, negative = NO
    held = [pos for pos in data.get("market_positions", []) if float(pos.get("position_fp", 0) or 0)]
    # Their markets in batches (one request per 100) rather than one request per position:
    # 50 positions took ~8s one by one behind the rate limit, and ~0.15s batched.
    markets = {}
    tickers = [pos.get("ticker") for pos in held]
    for i in range(0, len(tickers), 100):
        try:
            batch = _request("GET", "/markets", params={"tickers": ",".join(tickers[i:i + 100]), "limit": 100})
            markets.update({m.get("ticker"): m for m in batch.get("markets", [])})
        except Exception:
            pass  # those positions just come back without title/legs
    results = []
    for pos in held:
        qty = float(pos.get("position_fp", 0) or 0)
        cost = float(pos.get("market_exposure_dollars", 0) or 0)
        entry = {
            "ticker": pos.get("ticker"),
            "title": pos.get("ticker"),
            "side": "yes" if qty > 0 else "no",
            "quantity": abs(qty),
            "avg_price": round(cost / abs(qty), 4),
            "cost_dollars": cost,
            "fees_paid_dollars": float(pos.get("fees_paid_dollars", 0) or 0),
            "realized_pnl_dollars": float(pos.get("realized_pnl_dollars", 0) or 0),
            "exchange_index": pos.get("exchange_index"),
            "placed": pos.get("last_updated_ts"),  # last trade on this position
        }
        market = markets.get(pos.get("ticker"))
        if market:
            entry["title"] = market.get("yes_sub_title") or market.get("title") or entry["title"]
            entry["status"] = market.get("status")
            entry["yes_bid"] = _dollars(market.get("yes_bid_dollars"))
            legs = market.get("mve_selected_legs")
            if legs:
                entry["legs"] = [
                    {"market_ticker": l.get("market_ticker"), "side": l.get("side"),
                     "settled_value": l.get("yes_settlement_value_dollars")}
                    for l in legs
                ]
        results.append(entry)
    return results


# ---------- Parlays: create the combo market, ask makers for quotes (RFQ), accept one ----------

def _parse_legs(legs: List[str]) -> List[Dict]:
    """'TICKER' or 'TICKER:no' -> what Kalshi needs per leg (event ticker looked up, all legs in one request)."""
    parsed = []
    for leg in legs:
        ticker, _, side = leg.partition(":")
        side = (side or "yes").lower()
        if side not in ("yes", "no"):
            raise ValueError(f"leg side must be yes/no, got '{leg}'")
        parsed.append((ticker, side))
    # One request per 100 legs rather than one per leg (a 20-leg slip took ~3s one by one)
    tickers = list(dict.fromkeys(t for t, _ in parsed))
    markets = {}
    for i in range(0, len(tickers), 100):
        batch = _request("GET", "/markets", params={"tickers": ",".join(tickers[i:i + 100]), "limit": 100})
        markets.update({m.get("ticker"): m for m in batch.get("markets", [])})
    pairs = []
    for ticker, side in parsed:
        market = markets.get(ticker)
        if market is None:
            raise RuntimeError(f"Kalshi has no market {ticker}")
        pairs.append({
            "market_ticker": ticker,
            "event_ticker": market.get("event_ticker"),
            "side": side,
            "_label": market.get("yes_sub_title") or market.get("title"),
            "_yes_ask": _dollars(market.get("yes_ask_dollars" if side == "yes" else "no_ask_dollars")),
        })
    return pairs


def _poll_quotes(rfq_id: str, wait_seconds: float) -> List[Dict]:
    """Open maker quotes on our request, collected for `wait_seconds`."""
    deadline = time.time() + wait_seconds
    while True:
        # Kalshi 403s quote listings without a user filter, even with rfq_id
        data = _request("GET", "/communications/quotes", params={"rfq_id": rfq_id, "rfq_user_filter": "self"})
        quotes = [q for q in data.get("quotes", []) if q.get("status") == "open"]
        if time.time() >= deadline:
            return quotes
        time.sleep(0.5)


def _same_size(rfq: Dict, payload: Dict) -> bool:
    if "target_cost_dollars" in payload:
        return _dollars(rfq.get("target_cost_dollars")) == float(payload["target_cost_dollars"])
    return _dollars(rfq.get("contracts_fp")) == float(payload.get("contracts", 0))


def _open_rfq(payload: Dict, keep=()) -> Dict:
    """
    POST a request for quotes. Kalshi rejects an identical open one (same market and size) with
    409 "already_exists", e.g. one stranded by a page reload: then delete just those exact
    duplicates and retry once. Requests in `keep` (held by a confirm popup) are never touched.
    """
    try:
        return _request("POST", "/communications/rfqs", json=payload)
    except RuntimeError as e:
        if "already_exists" not in str(e):
            raise
    stale = _request("GET", "/communications/rfqs", params={"user_filter": "self", "status": "open", "limit": 100})
    for rfq in stale.get("rfqs", []):
        if rfq["id"] in keep or rfq.get("market_ticker") != payload["market_ticker"] or not _same_size(rfq, payload):
            continue
        _request("DELETE", f"/communications/rfqs/{rfq['id']}")
    return _request("POST", "/communications/rfqs", json=payload)


def _create_combo_rfq_for_cost(collection_ticker: str, legs: List[str], target_cost_dollars: float, keep=()) -> Dict:
    """Create the parlay's market (same legs = same ticker), then ask makers to quote it at a dollar cost (fees included)."""
    pairs = _parse_legs(legs)
    created = _request(
        "POST",
        f"/multivariate_event_collections/{collection_ticker}",
        json={"selected_markets": [{k: p[k] for k in ("market_ticker", "event_ticker", "side")} for p in pairs]},
    )
    combo_ticker = created.get("market_ticker")
    rfq = _open_rfq({
        "market_ticker": combo_ticker,
        "target_cost_dollars": f"{target_cost_dollars:.2f}",
        "rest_remainder": False,
    }, keep=keep)
    naive = 1.0
    for p in pairs:
        naive = naive * p["_yes_ask"] if p["_yes_ask"] is not None and naive is not None else None
    return {
        "combo_ticker": combo_ticker,
        "rfq_id": rfq.get("id"),
        "naive_parlay_price": round(naive, 4) if naive is not None else None,
    }


def _accept_and_track(rfq_id: str, quote_id: str, side: str, combo_ticker: str = None) -> Dict:
    """REAL MONEY. Accept a maker's quote, wait for it to execute, and return its fills."""
    # accepted_side names the MAKER's bid being hit, not the side we end up holding:
    # to buy YES we take the maker's NO bid. Sending "yes" against a NO-only quote 400s.
    maker_side = "no" if side == "yes" else "yes"
    _request("PUT", f"/communications/rfqs/{rfq_id}/quotes/{quote_id}/accept", json={"accepted_side": maker_side})
    # The maker must confirm (a few seconds); poll for the outcome
    deadline = time.time() + 6
    quote = {}
    while time.time() < deadline:
        quote = _request("GET", f"/communications/rfqs/{rfq_id}/quotes/{quote_id}").get("quote", {})
        if quote.get("status") in ("executed", "cancelled"):
            break
        time.sleep(0.5)
    result = {
        "rfq_id": rfq_id,
        "quote_id": quote_id,
        "accepted_side": side,
        "quote_status": quote.get("status"),
        "cancellation_reason": quote.get("cancellation_reason"),
    }
    if combo_ticker:
        try:
            fills = _request("GET", "/portfolio/fills", params={"ticker": combo_ticker, "limit": 20})
            result["fills"] = fills.get("fills", [])
        except Exception as e:
            result["fills_error"] = str(e)
    return result
