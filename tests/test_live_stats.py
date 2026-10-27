import unittest

from live_stats import normalize_name, parse_box, parse_out


class NormalizeNameTest(unittest.TestCase):
    # web/js/names.js normalizeName must agree; its tests use the same cases.
    def test_accents_case_suffixes_punctuation(self):
        self.assertEqual(normalize_name("Luka Dončić"), "luka doncic")
        self.assertEqual(normalize_name("Michael Porter Jr."), "michael porter")
        self.assertEqual(normalize_name("Day'Ron Sharpe"), "dayron sharpe")
        self.assertEqual(normalize_name("Shai Gilgeous-Alexander"), "shai gilgeous alexander")
        self.assertEqual(normalize_name("JALEN JOHNSON"), normalize_name("Jalen Johnson"))
        self.assertEqual(normalize_name("D\u2019Angelo Russell"), normalize_name("DAngelo Russell"))


class ParseBoxTest(unittest.TestCase):
    def test_reads_labels_and_made_attempted(self):
        summary = {"boxscore": {"players": [{"statistics": [{
            "labels": ["MIN", "PTS", "FG", "3PT", "FT", "REB", "AST", "TO", "STL", "BLK", "OREB", "DREB", "PF"],
            "athletes": [
                {"athlete": {"displayName": "CJ McCollum"}, "active": True, "stats": ["7", "5", "2-2", "1-3", "0-0", "0", "1", "0", "2", "0", "0", "0", "4"]},
                {"athlete": {"displayName": "Did Not Play"}, "stats": []},
            ],
        }]}]}}
        box = parse_box(summary)
        self.assertEqual(set(box), {"cj mccollum"})
        cj = box["cj mccollum"]
        self.assertEqual((cj["PTS"], cj["FGM"], cj["FGA"], cj["3PM"], cj["3PA"], cj["STL"], cj["PF"], cj["ON"]), (5, 2, 2, 1, 3, 2, 4, True))


class ParseOutTest(unittest.TestCase):
    def test_injury_report_and_did_not_play(self):
        summary = {
            "injuries": [{"injuries": [
                {"athlete": {"displayName": "VJ Edgecombe"}, "status": "Out", "details": {"type": "Abdomen"}},
                {"athlete": {"displayName": "Kelly Oubre Jr."}, "status": "Day-To-Day"},   # might play
            ]}],
            "boxscore": {"players": [{"statistics": [{"athletes": [
                {"athlete": {"displayName": "VJ Edgecombe"}, "didNotPlay": True, "reason": "COACH'S DECISION"},
                {"athlete": {"displayName": "Andre Drummond"}, "didNotPlay": True, "reason": "COACH'S DECISION"},
                {"athlete": {"displayName": "Tyrese Maxey"}, "stats": ["36"]},
            ]}]}]},
        }
        self.assertEqual(parse_out(summary, final=True), {
            "vj edgecombe": "Out (abdomen)",                        # the injury report's reason wins
            "andre drummond": "Did not play (coach's decision)",
        })
        # Mid-game, "did not play" only means not in yet: just the injury report counts
        self.assertEqual(parse_out(summary, final=False), {"vj edgecombe": "Out (abdomen)"})


if __name__ == "__main__":
    unittest.main()
