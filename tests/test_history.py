import unittest

import history


class HitRatesTest(unittest.TestCase):
    def tearDown(self):
        history._data = None

    def test_not_ready_before_the_first_sync(self):
        history._data = None
        self.assertEqual(history.hit_rates(), {"ready": False, "rates": {}})

    def test_counts_nights_and_skips_games_he_missed(self):
        history._data = {**history._empty(), "legs": {
            "KXNBAPTS-26OCT28GSWMEM-GSWBPODZIEMSKI2-10": ["Brandin Podziemski", "PTS", 10, "2026-10-28", False],
            "KXNBAPTS-26OCT26GSWLAL-GSWBPODZIEMSKI2-10": ["Brandin Podziemski", "PTS", 10, "2026-10-26", True],
            "KXNBAPTS-26OCT24GSWPHX-GSWBPODZIEMSKI2-10": ["Brandin Podziemski", "PTS", 10, "2026-10-24", True],
            "KXNBAPTS-26OCT22GSWDEN-GSWBPODZIEMSKI2-10": None,  # didn't play
        }}
        self.assertEqual(history.hit_rates()["rates"], {"Brandin Podziemski|PTS|10": [2, 3]})

    def test_only_this_seasons_player_props(self):
        self.assertTrue(history._is_prop("KXNBAPTS-26OCT28GSWMEM-GSWBPODZIEMSKI2-10"))
        self.assertFalse(history._is_prop("KXNBAGAME-26OCT28GSWMEM-GSW"))        # moneyline
        self.assertFalse(history._is_prop("KXNBASPREAD-26OCT28GSWMEM-GSW5"))     # spread
        self.assertFalse(history._is_prop("KXNBAPTS-26APR20GSWMEM-GSWSCURRY30-25"))  # last season


if __name__ == "__main__":
    unittest.main()
