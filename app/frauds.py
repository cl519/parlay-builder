"""
Fraud Watch: the players and teams you don't trust, flagged on the board. Kept in
~/.parlay/frauds.json so it's there in every tab, every browser and after a restart.

A list of entries in the order you added them:
    {"kind": "player", "name": "Josh Giddey", "team": "CHI"}
    {"kind": "team", "team": "MIL"}
"""

import json
import os
import threading

import kalshi

MAX_ENTRIES = 200
_lock = threading.Lock()


def _path():
    return os.path.join(kalshi.HOME, "frauds.json")


def clean(entries):
    """Keep only well-formed entries, once each, in order. Raises ValueError on a bad shape."""
    if not isinstance(entries, list) or len(entries) > MAX_ENTRIES:
        raise ValueError(f"expected a list of at most {MAX_ENTRIES} entries")
    out, seen = [], set()
    for e in entries:
        kind = e.get("kind") if isinstance(e, dict) else None
        team = str(e.get("team") or "")[:4].upper() if kind else ""
        if kind == "player" and str(e.get("name") or "").strip():
            entry = {"kind": "player", "name": str(e["name"]).strip()[:60], "team": team}
            key = ("player", entry["name"])
        elif kind == "team" and team:
            entry, key = {"kind": "team", "team": team}, ("team", team)
        else:
            raise ValueError("each entry needs kind 'player' (with a name) or 'team' (with a team)")
        if key not in seen:
            seen.add(key)
            out.append(entry)
    return out


def load():
    try:
        with open(_path()) as f:
            return {"entries": clean(json.load(f))}
    except (OSError, ValueError, AttributeError):
        return {"entries": []}


def save(body):
    entries = clean(body.get("entries"))
    with _lock:
        tmp = _path() + ".tmp"
        with open(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
            json.dump(entries, f, indent=1)
        os.replace(tmp, _path())  # all or nothing: a crash mid-write never leaves half a file
    return {"entries": entries}
