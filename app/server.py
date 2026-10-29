"""
Local parlay builder for Kalshi NBA combos.

    ./parlay        (or: .venv/bin/python app/server.py)  ->  http://127.0.0.1:8787

GET  /                the page (with this run's token embedded)
GET  /static/...      page assets from web/
GET  /api/games       per-game menus from Kalshi's public market data
GET  /api/live        live scores + player box scores (ESPN), keyed by Kalshi player name
GET  /api/player      ?team=PHI&name=...: last 5 games + season averages (ESPN), for the hover card
GET  /api/headshot    ?team=PHI&name=...: redirects to the player's ESPN photo (404 if none)
GET  /api/balance     cash you can spend on parlays (private: needs the token)
GET  /api/bets        your open parlays with per-leg chances (private: needs the token)
GET  /api/history     your hit rate on each prop line this season, for Build (private: needs the token)
POST /api/move-funds  move all cash onto the parlay shard (stays in your account)
POST /api/preview     live price for the slip (1 leg: order book; 2+: RFQ cancelled at once), no money moves
POST /api/prepare     REAL MONEY step 1: fix the price for the confirm popup (holds a parlay quote)
POST /api/place       REAL MONEY step 2: buy at exactly that price or better, or nothing
POST /api/cancel      drop a prepared bet or cash-out offer
POST /api/cashout-quote  hold the best maker offer to buy back a parlay you hold
POST /api/cashout     REAL MONEY: sell it at exactly that offer, or nothing

Every POST needs this run's token (only our page has it), a localhost Host header
(blocks DNS rebinding) and, when sent, a localhost Origin (blocks other websites).
The server only listens on 127.0.0.1.
"""

import hmac
import json
import mimetypes
import os
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

import betting
import history
from bets import bets_payload
from config import PORT
from live_stats import live_payload
from menus import games_payload
from player_log import headshot_url, player_payload

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.realpath(os.path.join(HERE, "..", "web"))

TOKEN = secrets.token_urlsafe(32)
ALLOWED_HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
ALLOWED_ORIGINS = {f"http://{h}" for h in ALLOWED_HOSTS}


def _legs_and_stake(body):
    legs = [leg["ticker"] for leg in body.get("legs", [])]
    if not legs:
        raise ValueError("pick at least 1 leg")
    stake = float(body.get("stake", 0))
    if stake < 1:  # no upper cap: your balance is the limit, and the confirm popup shows the total
        raise ValueError("stake must be at least $1")
    return legs, stake


POST_ROUTES = {
    "/api/preview": lambda b: betting.preview_quote(*_legs_and_stake(b)),
    "/api/prepare": lambda b: betting.prepare_bet(*_legs_and_stake(b)),
    "/api/place": lambda b: betting.place_bet(b.get("bet_id", "")),
    "/api/cancel": lambda b: betting.cancel_bet(b.get("bet_id", "")),
    "/api/move-funds": lambda b: betting.move_funds_to_combo_shard(),
    "/api/cashout-quote": lambda b: betting.cashout_quote(b.get("ticker", "")),
    "/api/cashout": lambda b: betting.cash_out(b.get("bet_id", "")),
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _redirect(self, url):
        """To an image elsewhere; the browser may remember it for a day (rosters rarely change)."""
        if not url:
            return self._send(404, {"error": "no photo"})
        self.send_response(302)
        self.send_header("Location", url)
        self.send_header("Cache-Control", "max-age=86400")
        self.end_headers()

    def _trusted(self):
        """Only our own page, loaded from localhost, may POST."""
        if self.headers.get("Host") not in ALLOWED_HOSTS:
            return False
        origin = self.headers.get("Origin")
        if origin is not None and origin not in ALLOWED_ORIGINS:
            return False
        return hmac.compare_digest(self.headers.get("X-Token", ""), TOKEN)

    def _static(self, rel):
        path = os.path.realpath(os.path.join(WEB, rel))
        if not path.startswith(WEB + os.sep) or not os.path.isfile(path):
            return self._send(404, {"error": "not found"})
        ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        with open(path, "rb") as f:
            self._send(200, f.read(), ctype + ("; charset=utf-8" if ctype.startswith("text/") else ""))

    def do_GET(self):
        if self.headers.get("Host") not in ALLOWED_HOSTS:
            return self._send(403, {"error": "forbidden"})
        path = self.path.split("?", 1)[0]
        if path in ("/", "/index.html"):
            with open(os.path.join(WEB, "index.html"), "rb") as f:
                return self._send(200, f.read().replace(b"__TOKEN__", TOKEN.encode()), "text/html; charset=utf-8")
        if path.startswith("/static/"):
            return self._static(path[len("/static/"):])
        try:
            if path == "/api/games":
                return self._send(200, games_payload(force="refresh" in self.path))
            if path == "/api/live":
                return self._send(200, live_payload())
            if path in ("/api/player", "/api/headshot"):
                q = parse_qs(urlsplit(self.path).query)
                team, name = q.get("team", [""])[0], q.get("name", [""])[0]
                if path == "/api/player":
                    return self._send(200, player_payload(team, name))
                return self._redirect(headshot_url(team, name))
            if path == "/api/balance":
                if not self._trusted():
                    return self._send(403, {"error": "forbidden"})
                return self._send(200, betting.balance())
            if path == "/api/bets":
                if not self._trusted():
                    return self._send(403, {"error": "forbidden"})
                return self._send(200, bets_payload(force="refresh" in self.path))
            if path == "/api/history":
                if not self._trusted():
                    return self._send(403, {"error": "forbidden"})
                return self._send(200, history.hit_rates())
        except Exception as e:
            return self._send(502, {"error": str(e)})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if not self._trusted():
            return self._send(403, {"error": "forbidden"})
        route = POST_ROUTES.get(self.path)
        if not route:
            return self._send(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            return self._send(200, route(body))
        except ValueError as e:
            return self._send(400, {"error": str(e)})
        except Exception as e:
            return self._send(502, {"error": str(e)})


if __name__ == "__main__":
    mimetypes.add_type("text/javascript", ".js")
    try:
        betting.initialize()
    except Exception as e:  # no config yet, or a key file that can't be read
        raise SystemExit(f"Can't load your Kalshi API key: {e}")
    history.start()
    print(f"Parlay builder on http://127.0.0.1:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
