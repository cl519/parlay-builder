# Parlay Builder

![Parlay Builder](docs/screenshot.png)

Build, place and track NBA parlays on [Kalshi](https://kalshi.com), with live player stats on every leg.

**Build:** tap lines from every game into a slip, see its live price, and place it.

**My bets:** follow your open parlays leg by leg, swap or raise legs and rebuy, add more, or cash out.

## Setup

1. **Get a Kalshi API key.** Go to [kalshi.com/account/profile](https://kalshi.com/account/profile),
   scroll to API Keys and create one. Copy the Key ID and keep the .txt file it downloads.

2. **Install.** In Terminal:

   ```
   git clone https://github.com/cl519/parlay-builder.git ~/parlay-builder
   cd ~/parlay-builder
   ./parlay setup
   ```

   Paste your Key ID, then drag the .txt file into the window.
   If macOS asks to install developer tools, click Install and run `./parlay setup` again.

3. **Start it.**

   ```
   ./parlay
   ```

   The site opens at http://127.0.0.1:8787.

## Commands

| | |
|---|---|
| `./parlay` | Start and open the site |
| `./parlay stop` | Stop it |
| `./parlay update` | Get the latest version |
| `./parlay setup` | Change your API key |

Bets use real money. Nothing is charged until you press Confirm.

`app/kalshi.py` started from [yakub268/kalshi-mcp](https://github.com/yakub268/kalshi-mcp) (MIT).
Not affiliated with Kalshi or ESPN.
