import unittest

from player_log import find_athlete, parse_log

LABELS = ["MIN", "FG", "FG%", "3PT", "3P%", "FT", "FT%", "REB", "AST", "BLK", "STL", "PF", "TO", "PTS"]


def row(event_id, mins, threes, reb, ast, blk, stl, pts):
    return {"eventId": event_id, "stats": [str(mins), "5-10", "50.0", threes, "0", "0-0", "0", str(reb),
                                           str(ast), str(blk), str(stl), "0", "0", str(pts)]}


def event(date, result="W", at="vs", opp="NY"):
    return {"gameDate": date, "gameResult": result, "atVs": at, "opponent": {"abbreviation": opp}}


def log(regular_rows, events, preseason_rows=()):
    return {"labels": LABELS, "events": events, "seasonTypes": [
        {"displayName": "2026-27 Regular Season", "categories": [{"events": list(regular_rows)}]},
        {"displayName": "2026-27 Preseason", "categories": [{"events": list(preseason_rows)}]},
    ]}


class ParseLogTest(unittest.TestCase):
    def test_no_games_yet(self):
        self.assertEqual(parse_log(log([], {})), {"games": [], "avg": None, "played": 0})
        self.assertEqual(parse_log({}), {"games": [], "avg": None, "played": 0})

    def test_fewer_than_five_games_newest_first_with_averages(self):
        out = parse_log(log(
            [row("a", 30, "1-4", 10, 5, 1, 3, 17), row("b", 34, "2-3", 9, 7, 0, 1, 14)],
            {"a": event("2026-10-20T23:00Z", "L", "@", "BOS"), "b": event("2026-10-22T23:00Z")},
        ))
        self.assertEqual(out["played"], 2)
        self.assertEqual([g["PTS"] for g in out["games"]], [14, 17])
        first = out["games"][1]
        self.assertEqual((first["opp"], first["at"], first["result"], first["3PM"], first["STL"]), ("BOS", True, "L", 1, 3))
        self.assertEqual(out["avg"]["PTS"], 15.5)
        self.assertEqual(out["avg"]["3PM"], 1.5)

    def test_skips_preseason_and_unfinished_games_and_keeps_five(self):
        rows = [row(str(i), 30, "0-0", 5, 5, 0, 0, 10 + i) for i in range(7)]
        events = {str(i): event(f"2026-11-0{i + 1}T23:00Z") for i in range(7)}
        events["6"]["gameResult"] = None  # in progress
        out = parse_log(log(rows, events, preseason_rows=[row("p", 20, "0-0", 1, 1, 0, 0, 99)]))
        self.assertEqual(out["played"], 6)
        self.assertEqual([g["PTS"] for g in out["games"]], [15, 14, 13, 12, 11])
        self.assertEqual(out["avg"]["PTS"], 12.5)


class FindAthleteTest(unittest.TestCase):
    ROSTER = {"lebron james": "1966", "bronny james": "4683774", "joel embiid": "3059318"}

    def test_exact_then_unique_last_name(self):
        self.assertEqual(find_athlete(self.ROSTER, "LeBron James"), "1966")
        self.assertEqual(find_athlete(self.ROSTER, "Joel Embiid Jr."), "3059318")
        self.assertEqual(find_athlete(self.ROSTER, "J. Embiid"), "3059318")

    def test_ambiguous_or_unknown(self):
        self.assertIsNone(find_athlete(self.ROSTER, "B. James"))
        self.assertIsNone(find_athlete(self.ROSTER, "Nobody Here"))


if __name__ == "__main__":
    unittest.main()
