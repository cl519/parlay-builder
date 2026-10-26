import unittest

from betting import best_cashout_bid, best_yes_quote, fill_plan, first_buy_times, taker_fee


class TakerFeeTest(unittest.TestCase):
    def test_matches_real_fills(self):
        # Fees Kalshi actually charged on our first two parlays (2026-10-21)
        self.assertEqual(taker_fee(5, 0.158), 0.05)     # charged $0.0466 -> $0.05 rounded up
        self.assertEqual(taker_fee(560, 0.081), 2.92)   # charged $2.9181

    def test_rounds_up_to_the_cent(self):
        self.assertEqual(taker_fee(1, 0.5), 0.02)       # 0.0175


class BestYesQuoteTest(unittest.TestCase):
    def test_picks_cheapest_yes_and_skips_no_only_quotes(self):
        quotes = [
            {"id": "a", "no_bid_dollars": "0.8260", "no_contracts_fp": "5.00"},
            {"id": "b", "no_bid_dollars": "0.8420", "no_contracts_fp": "5.00"},  # cheapest YES: 15.8c
            {"id": "c", "no_bid_dollars": "0.0000", "no_contracts_fp": None},     # offers only NO
        ]
        best = best_yes_quote(quotes)
        self.assertEqual((best["quote_id"], best["price"], best["contracts"]), ("b", 0.158, 5.0))

    def test_none_when_nobody_sells_yes(self):
        self.assertIsNone(best_yes_quote([{"id": "c", "no_bid_dollars": "0", "no_contracts_fp": "0"}]))


class BestCashoutBidTest(unittest.TestCase):
    def test_highest_yes_bid_that_takes_every_contract(self):
        quotes = [
            {"id": "low", "yes_bid_dollars": "0.0420", "yes_contracts_fp": "633.31"},
            {"id": "high", "yes_bid_dollars": "0.0770", "yes_contracts_fp": "633.31"},
            {"id": "partial", "yes_bid_dollars": "0.0900", "yes_contracts_fp": "100.00"},
            {"id": "none", "yes_bid_dollars": "0.0000", "yes_contracts_fp": "633.31"},
        ]
        self.assertEqual(best_cashout_bid(quotes, 633.31)["quote_id"], "high")

    def test_none_when_nobody_bids(self):
        self.assertIsNone(best_cashout_bid([{"id": "a", "yes_bid_dollars": "0", "yes_contracts_fp": "5"}], 5))
        self.assertIsNone(best_cashout_bid([], 5))


class FillPlanTest(unittest.TestCase):
    def test_walks_the_book_cheapest_first(self):
        # Herro 35+ book on 2026-10-23: 25 at 65c, then 442 at 66c. 74 contracts = $48.59 + $1.17 fee.
        levels = fill_plan([(0.65, 25.48), (0.66, 442.0)], 50)
        self.assertEqual(levels, [(0.65, 25), (0.66, 49)])
        cost = sum(p * c for p, c in levels)
        self.assertLessEqual(cost + 0.07 * sum(c * p * (1 - p) for p, c in levels), 50)

    def test_stake_fits_inside_the_first_level(self):
        self.assertEqual(fill_plan([(0.40, 1000), (0.41, 1000)], 10), [(0.40, 23)])  # 24 would be $10.01 with fee

    def test_nothing_affordable_or_empty_book(self):
        self.assertEqual(fill_plan([(0.99, 10)], 0.5), [])
        self.assertEqual(fill_plan([], 50), [])

    def test_thin_book_takes_everything_there_is(self):
        self.assertEqual(fill_plan([(0.10, 3), (0.20, 2)], 100), [(0.10, 3), (0.20, 2)])


class FirstBuyTimesTest(unittest.TestCase):
    def test_earliest_buy_per_market_and_sells_are_ignored(self):
        fills = [
            {"ticker": "P", "action": "buy", "created_time": "2026-10-25T20:19:30Z"},   # Add more
            {"ticker": "P", "action": "sell", "created_time": "2026-10-25T20:01:00Z"},
            {"ticker": "Q", "action": "buy", "created_time": "2026-10-24T18:00:00Z"},
            {"ticker": "P", "action": "buy", "created_time": "2026-10-25T20:16:17Z"},   # the original bet
        ]
        self.assertEqual(first_buy_times(fills), {"P": "2026-10-25T20:16:17Z", "Q": "2026-10-24T18:00:00Z"})


if __name__ == "__main__":
    unittest.main()
