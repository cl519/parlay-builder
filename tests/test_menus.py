import unittest

from menus import assemble_games, cents


def market(ticker, sub_title, yes_bid, yes_ask, **extra):
    return {
        "ticker": ticker, "event_ticker": "-".join(ticker.split("-")[:2]), "status": "active",
        "yes_sub_title": sub_title,
        "yes_bid_dollars": f"{yes_bid:.4f}", "yes_ask_dollars": f"{yes_ask:.4f}",
        "no_bid_dollars": f"{1 - yes_ask:.4f}", "no_ask_dollars": f"{1 - yes_bid:.4f}",
        **extra,
    }


ML = [
    market("KXNBAGAME-26OCT21GSWLAL-LAL", "Los Angeles L", 0.55, 0.56),
    market("KXNBAGAME-26OCT21GSWLAL-GSW", "Golden State", 0.44, 0.45),
]


class AssembleGamesTest(unittest.TestCase):
    def test_cents(self):
        self.assertEqual(cents("0.5500"), 55)
        self.assertIsNone(cents(None))

    def test_moneyline_away_team_first(self):
        g = assemble_games({"KXNBAGAME": ML})[0]
        self.assertEqual((g["away"], g["home"]), ("GSW", "LAL"))
        self.assertEqual([l["team"] for l in g["ml"]], ["GSW", "LAL"])

    def test_game_without_moneyline_is_dropped(self):
        props = [market("KXNBAPTS-26OCT21GSWLAL-LALLDONCIC77-25", "Luka Dončić: 25+", 0.85, 0.86)]
        self.assertEqual(assemble_games({"KXNBAPTS": props}), [])

    def test_spread_yields_both_sides(self):
        spread = [market("KXNBASPREAD-26OCT21GSWLAL-LAL6", "Los Angeles L wins by over 5.5 points",
                         0.55, 0.56, floor_strike=5.5)]
        g = assemble_games({"KXNBAGAME": ML, "KXNBASPREAD": spread})[0]
        by_label = {l["label"]: l for l in g["spread"]}
        self.assertEqual(by_label["LAL -5.5"]["ask"], 56)
        self.assertEqual(by_label["GSW +5.5"]["ticker"], "KXNBASPREAD-26OCT21GSWLAL-LAL6:no")
        self.assertEqual(by_label["GSW +5.5"]["ask"], 45)  # NO ask = 1 - YES bid
        self.assertEqual([l["hcp"] for l in g["spread"]], [5.5, -5.5])  # safest first

    def test_totals_overs_and_unders_safest_first(self):
        totals = [market(f"KXNBATOTAL-26OCT21GSWLAL-{n}", f"Over {n}.5 points", 0.5, 0.51) for n in (220, 230)]
        g = assemble_games({"KXNBAGAME": ML, "KXNBATOTAL": totals})[0]
        self.assertEqual([l["label"] for l in g["total"] if l["dir"] == "over"], ["Over 220.5", "Over 230.5"])
        self.assertEqual([l["label"] for l in g["total"] if l["dir"] == "under"], ["Under 230.5", "Under 220.5"])

    def test_player_props_grouped_and_sorted(self):
        props = [
            market("KXNBAPTS-26OCT21GSWLAL-LALLDONCIC77-30", "Luka Dončić: 30+", 0.6, 0.62),
            market("KXNBAPTS-26OCT21GSWLAL-LALLDONCIC77-25", "Luka Dončić: 25+", 0.85, 0.86),
            market("KXNBAREB-26OCT21GSWLAL-GSWDGREEN23-8", "Draymond Green: 8+", 0.2, 0.24),
        ]
        g = assemble_games({"KXNBAGAME": ML, "KXNBAPTS": props[:2], "KXNBAREB": props[2:]})[0]
        luka, draymond = g["players"]  # home team (LAL) first
        self.assertEqual(luka["name"], "Luka Dončić")
        self.assertEqual([l["line"] for l in luka["PTS"]], [25, 30])
        self.assertEqual(luka["PTS"][0]["label"], "Luka Dončić 25+ PTS")
        self.assertEqual((luka["PTS"][0]["player"], luka["PTS"][0]["stat"]), ("Luka Dončić", "PTS"))
        self.assertEqual(draymond["team"], "GSW")


if __name__ == "__main__":
    unittest.main()
