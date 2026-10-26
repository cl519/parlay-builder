"""Minimal JSON-over-HTTPS fetching for public (unauthenticated) data sources."""

import json
import urllib.request


def get_json(url, timeout=20):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.load(r)
