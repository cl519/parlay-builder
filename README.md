# Parlay Builder

![Parlay Builder](docs/screenshot.png)

A lightweight web app that connects to your [Kalshi](https://kalshi.com) account to build and
place NBA parlays, with live player stats on every leg.

It has two tabs. **Build** lets you browse every game's lines, tap them into a slip, and place it
at a live price. **My bets** lets you manage your open parlays: follow each leg live, swap or
raise legs and rebuy, add more, or cash out.

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

`app/kalshi.py` started from [yakub268/kalshi-mcp](https://github.com/yakub268/kalshi-mcp) (MIT).
Not affiliated with Kalshi or ESPN.
