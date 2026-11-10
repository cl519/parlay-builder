"""
Read-only access for your iPhone app, over Tailscale (a private network of only your devices).

Off until you run ./parlay phone, which saves a token and your Mac's Tailscale address in
~/.parlay/phone.json. Then the server also listens on that address, separately from the page:
GET only, every request needs the token, and nothing that moves money is reachable. The site
on 127.0.0.1 is unchanged.
"""

import json
import os
import secrets
import subprocess
import threading
import time

import kalshi

TAILSCALE = "/Applications/Tailscale.app/Contents/MacOS/Tailscale"
RETRY_SECONDS = 30
# What the app may read. No POST route is reachable from the phone at all.
ROUTES = {"/api/bets", "/api/live", "/api/balance", "/api/history", "/api/player", "/api/headshot"}


def _path():
    return os.path.join(kalshi.HOME, "phone.json")


def load():
    try:
        with open(_path()) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def tailscale_ip():
    out = subprocess.run([TAILSCALE, "ip", "-4"], capture_output=True, text=True, timeout=10)
    if out.returncode != 0 or not out.stdout.strip():
        raise RuntimeError("Tailscale isn't connected: open it from the menu bar and log in")
    return out.stdout.split()[0]


def enable():
    """Save a token (kept if there is one) and the current Tailscale address."""
    config = load() or {"token": secrets.token_urlsafe(32)}
    config["host"] = tailscale_ip()
    tmp = _path() + ".tmp"
    with open(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:  # only you can read it
        json.dump(config, f)
    os.replace(tmp, _path())
    return config


def start(serve):
    """If enabled, serve(host) on the Tailscale address, retrying until Tailscale is up."""
    config = load()
    if not config:
        return

    def loop():
        while True:
            try:
                serve(config["host"])
            except OSError as e:  # Tailscale not connected yet, so its address can't be used
                print(f"Phone access waiting for Tailscale ({e}), retrying", flush=True)
                time.sleep(RETRY_SECONDS)
    threading.Thread(target=loop, daemon=True).start()


if __name__ == "__main__":
    c = enable()
    print(f"Phone access on: http://{c['host']}")
