# The app's modules import each other by plain name (they run from app/), so tests do too.
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app"))
