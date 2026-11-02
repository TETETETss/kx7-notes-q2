# Notes

A small static site for a private set of mention-market notes. Times are WITA (UTC+8).

The live site is [https://tetetetss.github.io/kx7-notes-q2/](https://tetetetss.github.io/kx7-notes-q2/).

## Which file holds what

- `data/markets.json` — open markets. Edit `fairYes` (YES percent) and `context` on a strike. The page recomputes the call, the gap, and the best-spots list from those numbers plus the latest prices.
- `data/results.json` — past events. Each strike has what happened, the call, a score, and a reason.
- `data/research.json` — diplomacy list, state keyword boxes, method notes, and books that have already closed.
- `data/prices.json` — latest public prices and the WITA time they were fetched. The price job writes this file. Do not edit it by hand.

A yellow strike is one the notes flagged as outside the usual template.

## Jobs

- `.github/workflows/pages.yml` publishes this folder to GitHub Pages on every push to `main`.
- `.github/workflows/prices.yml` runs about every 10 minutes (and on demand). It reads each event's ticker or slug, fetches the public book, and commits `data/prices.json`. Books wider than 40 points are stored, then ignored for best spots.

No API keys are used.
