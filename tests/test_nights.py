import unittest
from datetime import datetime, timezone

from nights import fill_money, game_date, night_of, night_rows, slate_today


def fill(ticker, action, side, count, yes_price, fee=0.0):
    return {"ticker": ticker, "action": action, "side": side, "count_fp": str(count), "fee_cost": str(fee),
            "yes_price_dollars": str(yes_price), "no_price_dollars": str(round(1 - yes_price, 4))}


def leg(ticker, result=None, chance=0.5, side="yes"):
    return {"ticker": ticker, "side": side, "result": result, "chance": chance}


TONIGHT, TOMORROW = "KXNBAPTS-26OCT25MEMSAC-MEMTJEROME2-20", "KXNBAPTS-26OCT26DALSAS-DALCFLAGG32-15"


class DatesTest(unittest.TestCase):
    def test_game_date_from_ticker(self):
        self.assertEqual(game_date(TONIGHT), "2026-10-25")
        self.assertEqual(game_date("KXLOLGAME-26OCT251500LYGEN-LY"), "2026-10-25")  # date then start time
        self.assertIsNone(game_date("KXMVECROSSCATEGORY-S2026XITSOMPYHQJBOMNE-5LITXFZQZ"))

    def test_a_bet_belongs_to_its_last_game(self):
        self.assertEqual(night_of([TOMORROW, TONIGHT]), "2026-10-26")
        self.assertIsNone(night_of([]))

    def test_slate_rolls_over_at_6am_eastern(self):
        self.assertEqual(slate_today(datetime(2026, 10, 26, 5, 30, tzinfo=timezone.utc)), "2026-10-25")  # 1:30am ET
        self.assertEqual(slate_today(datetime(2026, 10, 26, 11, 0, tzinfo=timezone.utc)), "2026-10-26")  # 7am ET


class MoneyTest(unittest.TestCase):
    def test_buy_costs_price_plus_fee(self):
        self.assertEqual(fill_money(fill("T", "buy", "yes", 100, 0.25, fee=1.5)), (26.5, 0.0))

    def test_selling_yes_shows_up_as_sell_no(self):
        # Sold YES at 5¢: Kalshi records "sell no at 95¢", which pays back 5¢ a contract
        staked, back = fill_money(fill("T", "sell", "no", 100, 0.05, fee=0.5))
        self.assertEqual(staked, 0.0)
        self.assertAlmostEqual(back, 4.5)


class NightRowsTest(unittest.TestCase):
    def rows(self, fills=(), settlements=(), parlays=()):
        legs = {"A": [TONIGHT], "B": [TONIGHT], "C": [TOMORROW, TONIGHT], "P": [TONIGHT]}
        return {r["ticker"]: r for r in night_rows("2026-10-25", list(fills), list(settlements), list(parlays), lambda t: legs.get(t, []))}

    def test_settled_win_counts_stake_and_revenue(self):
        r = self.rows([fill("A", "buy", "yes", 100, 0.2, fee=1)], [{"ticker": "A", "revenue": 10000}])["A"]
        self.assertEqual((r["staked"], r["paid"]), (21.0, 100.0))

    def test_other_nights_stay_out(self):
        self.assertEqual(self.rows([fill("C", "buy", "yes", 10, 0.5)]), {})

    def test_open_parlay_rides_at_its_cost(self):
        p = {"ticker": "P", "cost": 12.0, "payout": 80.0, "legs": [leg("x", "yes", 1.0), leg("y")]}
        self.assertEqual(self.rows(parlays=[p])["P"]["riding"], 12.0)

    def test_every_leg_settled_your_way_is_locked_in(self):
        p = {"ticker": "P", "cost": 12.0, "payout": 80.0, "legs": [leg("x", "yes", 1.0), leg("y", "scalar", 0.5)]}
        r = self.rows(parlays=[p])["P"]
        self.assertEqual((r["locked"], r["riding"]), (40.0, 0.0))  # a didn't-play leg pays at its value

    def test_dead_parlay_is_neither(self):
        p = {"ticker": "P", "cost": 12.0, "payout": 80.0, "legs": [leg("x", "no", 0.0), leg("y")]}
        self.assertEqual(self.rows(parlays=[p]), {})

    def test_settled_while_reading_counts_once(self):
        p = {"ticker": "P", "cost": 12.0, "payout": 80.0, "legs": [leg("x", "yes", 1.0)]}
        r = self.rows(settlements=[{"ticker": "P", "revenue": 8000}], parlays=[p])["P"]
        self.assertEqual((r["paid"], r["locked"]), (80.0, 0.0))


if __name__ == "__main__":
    unittest.main()
