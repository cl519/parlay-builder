import unittest

from bets import describe_leg, family, leg_chance, link_replacements


def parlay(ticker, *legs):
    return {"ticker": ticker, "legs": [{"ticker": t, "side": "yes"} for t in legs]}


class LinkReplacementsTest(unittest.TestCase):
    def test_subset_links_to_smallest_superset(self):
        original = parlay("P", "a", "b", "c", "d")
        first = parlay("C1", "a", "b", "c")      # dropped d
        second = parlay("C2", "a", "b")          # replacement of the replacement
        unrelated = parlay("X", "a", "z")
        link_replacements([original, first, second, unrelated])
        self.assertIsNone(original["parent"])
        self.assertEqual(first["parent"], "P")
        self.assertEqual(second["parent"], "C1")
        self.assertIsNone(unrelated["parent"])

    def test_parlay_inside_two_unrelated_parlays_gets_one_parent(self):
        p1 = parlay("P1", "a", "b", "x")          # shares only a, b with P2
        p2 = parlay("P2", "a", "b", "y", "z")
        child = parlay("C", "a", "b")             # a subset of both
        link_replacements([p1, p2, child])
        self.assertEqual(child["parent"], "P1")   # the smaller one; never both
        self.assertIsNone(p1["parent"])           # P1 and P2 don't contain each other: separate stacks
        self.assertIsNone(p2["parent"])

    def test_singles_stay_out_of_stacks(self):
        big = parlay("P", "a", "b")
        single = {**parlay("S", "a"), "single": True}
        link_replacements([big, single])
        self.assertIsNone(single["parent"])
        self.assertIsNone(big["parent"])

    def test_same_legs_is_not_a_replacement(self):
        a, b = parlay("A", "x", "y"), parlay("B", "x", "y")
        link_replacements([a, b])
        self.assertIsNone(a["parent"])
        self.assertIsNone(b["parent"])


    def test_adjusted_line_stays_in_the_stack(self):
        flagg15, flagg10 = "KXNBAPTS-G-DALCFLAGG32-15", "KXNBAPTS-G-DALCFLAGG32-10"
        legs = lambda *ts: [{"ticker": t, "side": "yes", "family": family(t, "yes", "PTS")} for t in ts]
        original = {"ticker": "P", "placed": "1", "legs": legs(flagg15, "KXNBAPTS-G-X1-20", "KXNBAPTS-G-Y2-5")}
        adjusted = {"ticker": "A", "placed": "2", "legs": legs(flagg10, "KXNBAPTS-G-X1-20", "KXNBAPTS-G-Y2-5")}
        trimmed = {"ticker": "T", "placed": "3", "legs": legs(flagg10, "KXNBAPTS-G-X1-25")}
        link_replacements([original, adjusted, trimmed])
        self.assertIsNone(original["parent"])        # the older of two same-question parlays leads
        self.assertEqual(adjusted["parent"], "P")
        self.assertEqual(trimmed["parent"], "P")     # smallest container; ties go to the older

    def test_mid_game_replace_chain_stays_in_the_stack(self):
        leg = lambda t: {"ticker": t, "side": "yes", "family": family(t, "yes", "PTS")}
        original = {"ticker": "P", "placed": "1", "legs": [leg(t) for t in
                    ("KXNBAPTS-G-HIT1-10", "KXNBAPTS-G-A1-15", "KXNBAPTS-G-B2-20", "KXNBAPTS-G-C3-5")]}
        # 1st replace: HIT left out (already hit), A adjusted 15+ -> 10+
        first = {"ticker": "R1", "placed": "2", "legs": [leg(t) for t in
                 ("KXNBAPTS-G-A1-10", "KXNBAPTS-G-B2-20", "KXNBAPTS-G-C3-5")]}
        # 2nd replace of the replacement: C dropped, B adjusted 20+ -> 15+
        second = {"ticker": "R2", "placed": "3", "legs": [leg(t) for t in ("KXNBAPTS-G-A1-10", "KXNBAPTS-G-B2-15")]}
        link_replacements([original, first, second])
        self.assertEqual(first["parent"], "P")
        self.assertEqual(second["parent"], "R1")

    def test_family_ignores_only_the_line(self):
        self.assertEqual(family("KXNBAPTS-G-DALCFLAGG32-15", "yes", "PTS"), family("KXNBAPTS-G-DALCFLAGG32-10", "yes", "PTS"))
        self.assertNotEqual(family("KXNBAPTS-G-DALCFLAGG32-15", "yes", "PTS"), family("KXNBAPTS-G-DALCFLAGG32-15", "no", "PTS"))
        self.assertEqual(family("KXNBASPREAD-G-MIA7", "yes", "spread"), family("KXNBASPREAD-G-MIA3", "yes", "spread"))
        self.assertNotEqual(family("KXNBAGAME-G-MIA", "yes", "ml"), family("KXNBAGAME-G-CHA", "yes", "ml"))
        self.assertEqual(family("KXLOLGAME-X-T1", "yes", "other"), "KXLOLGAME-X-T1|yes")


class LegChanceTest(unittest.TestCase):
    def test_settled_and_midpoint(self):
        self.assertEqual(leg_chance({"result": "yes"}, "yes"), 1.0)
        self.assertEqual(leg_chance({"result": "yes"}, "no"), 0.0)
        self.assertEqual(leg_chance({"yes_bid_dollars": "0.42", "yes_ask_dollars": "0.50"}, "yes"), 0.46)
        self.assertEqual(leg_chance({"yes_bid_dollars": "0.42", "yes_ask_dollars": "0.50"}, "no"), 0.54)
        self.assertIsNone(leg_chance({}, "yes"))

    def test_thin_book_uses_last_trade_or_your_price(self):
        thin = {"yes_bid_dollars": "0.23", "yes_ask_dollars": "0.70"}
        self.assertEqual(leg_chance({**thin, "last_price_dollars": "0.69"}, "yes"), 0.69)  # not the 46.5% midpoint
        self.assertEqual(leg_chance({**thin, "last_price_dollars": "0.0000"}, "yes"), 0.70)
        self.assertEqual(leg_chance({**thin, "last_price_dollars": "0.95"}, "yes"), 0.70)   # stale trade outside the book
        self.assertEqual(leg_chance(thin, "no"), 0.77)                                      # NO costs 1 - bid

    def test_player_who_didnt_play_counts_at_the_fair_price(self):
        settled = {"result": "scalar", "settlement_value_dollars": "0.0700"}
        self.assertEqual(leg_chance(settled, "yes"), 0.07)


class DescribeLegTest(unittest.TestCase):
    def test_prop_carries_player_and_team(self):
        leg = {"market_ticker": "KXNBAPTS-26OCT23CHIMIL-MILJJAQUEZ24-10", "side": "yes"}
        out = describe_leg(leg, {"yes_sub_title": "Jaime Jaquez Jr.: 10+"})
        self.assertEqual((out["player"], out["team"], out["stat"], out["line"]), ("Jaime Jaquez Jr.", "MIL", "PTS", 10))


if __name__ == "__main__":
    unittest.main()
