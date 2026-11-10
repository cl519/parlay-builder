import unittest

from frauds import clean


class CleanTest(unittest.TestCase):
    def test_keeps_order_drops_duplicates(self):
        entries = [{"kind": "player", "name": " Josh Giddey ", "team": "chi"}, {"kind": "team", "team": "MIL"},
                   {"kind": "player", "name": "Josh Giddey", "team": "CHI"}]
        self.assertEqual(clean(entries), [{"kind": "player", "name": "Josh Giddey", "team": "CHI"}, {"kind": "team", "team": "MIL"}])

    def test_rejects_bad_shapes(self):
        for bad in (None, {"kind": "team"}, [{"kind": "team"}], [{"kind": "coach", "name": "x"}], ["MIL"]):
            with self.assertRaises(ValueError):
                clean(bad)
