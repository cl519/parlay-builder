import unittest

from standings import parse_standings


class ParseStandingsTest(unittest.TestCase):
    def test_record_streak_seed_and_kalshi_codes(self):
        data = {"children": [{"name": "Eastern Conference", "standings": {"entries": [{
            "team": {"abbreviation": "NY"},
            "stats": [{"name": "overall", "displayValue": "7-3"}, {"name": "Last Ten Games", "displayValue": "7-3"},
                      {"name": "streak", "displayValue": "W2"}, {"name": "playoffSeed", "displayValue": "4"}],
        }]}}, {"name": "Western Conference", "standings": {"entries": [{
            "team": {"abbreviation": "OKC"}, "stats": [{"name": "overall", "displayValue": "9-1"}],
        }]}}]}
        teams = parse_standings(data)
        self.assertEqual(teams["NYK"], {"record": "7-3", "last10": "7-3", "streak": "W2", "seed": 4, "conf": "East"})
        self.assertEqual((teams["OKC"]["record"], teams["OKC"]["conf"], teams["OKC"]["seed"]), ("9-1", "West", None))
