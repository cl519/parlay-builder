"""Settings shared by the parlay builder's server modules."""

import os

# A second copy on another port gets its own browser storage (separate slip) - handy for testing.
PORT = int(os.environ.get("PARLAY_PORT", "8787"))

QUOTE_TTL_SECONDS = 120   # a prepared quote must be confirmed within this
