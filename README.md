# Afterlife

Afterlife lets you play the
[_Cyberpunk Trading Card Game_](https://cyberpunktcg.com/) (WeirdCo, under licence from CD PROJEKT RED)
in a web browser. It is a fan project with no official standing. Two people can share one screen,
or you can play the built-in computer opponent. It runs on computers, iPads and phones using one
layout that is scaled to fit the screen, and every game is saved automatically and can be undone
move by move.

> [!WARNING]
> **Early test version.** The core rules are enforced and covered by automated tests, but most
> card abilities are not automated yet (see below).

## What the game does for you

Enforced by the rules engine (`src/engine/`):

- Setup: 3 face-down Legends in random order, d20 roll for who chooses first, the first player
  spends their two leftmost Legends (they stay spent through that first turn), 6-card hands and
  one mulligan.
- Start Phase: win check (7+ Gigs), ready, draw (an empty deck loses), gain a Gig — pick a die
  from the Fixer, roll it (the d20 only when it is the last die).
- Main Phase: sell one card a turn, pay costs with Eddies or by spending Legends (face-down, or
  face-up with a Sell tag), Call a Legend once a turn for 1 €$ (also as a reaction), play Units
  (with Lag), Gear (equip to a Unit or Legend, adds its power) and Programs, Go Solo.
- Attacks: only ready Units without Lag (or with Adrenaline / Go Solo) attack; only spent Units can
  be attacked; reactions (Call a Legend, Quick Programs, Blocker); fights (ties trade, 0 power never
  defeats); stealing ⌊power/10⌋+1 Gigs, chosen one at a time; a block on a direct attack steals nothing.
- Street Cred, Overtime (after both players' 7th turn, 7 Gigs wins at once), deck building rules
  (3 Legends with different names, 40–50 cards, 3 copies, RAM per colour).

**Card abilities** other than Adrenaline, Blocker, Quick and Go Solo are shown on the card and in the
log, and players apply them with the **table tools**: change a Unit's power, spend/ready, give
Adrenaline, defeat, return to hand, discard, draw, trash the top card, move or re-roll a Gig die,
flip a Legend. Scripting each card's ability is the next big job.

The computer opponent ("Street AI") plays Units, Gear, Go Solo and attacks sensibly, but it does not
read card text and it sells its Programs instead of playing them.

## Where the cards come from

No card scans or card wording are stored in this repository; that material belongs to WeirdCo and
CD PROJEKT RED. Without the card database, every card is drawn as a placeholder (colour, cost,
RAM, power and keyword chips), and the game is fully playable with a generic placeholder card pool.

`npm run fetch-cards` copies the card list and card renders from the official card database
([cyberpunktcg.com/cards](https://cyberpunktcg.com/cards), run on Netdeck.gg) onto your own computer
(`public/cards/`, gitignored). It first looks for the Netdeck.gg API behind the card database and
Deck Builder and takes every card in one go (keeping a raw copy in `vendor/cards/api-raw.json`). If no
API answers, it reads each public card page instead (`--pages` forces that; `--debug` keeps the raw
pages). That API is undocumented, so if cards come out wrong, send `public/cards/report.txt` and
`vendor/cards/api-raw.json` to Claude to fix the mapping in `tools/netdeck.ts`.

`npm run fetch-deck -- <Deck Builder link>` downloads a public deck as a card list (saved to `decks/`)
that you can paste into the setup screen.

With the database loaded you can paste a deck list on the setup screen (one card per line, e.g.
`3 Ruthless Lowlife`, Legends included) or let it build a random two-colour deck.

Knowing how to play is up to you — read the official
[gameplay guide](https://cyberpunktcg.com/gameplay-guide) and pick up a starter deck.

## Running it

On a Mac, double-click **Start Afterlife.command**. The first time, it installs everything and
downloads the cards; after that it just starts the game and opens your browser. (If macOS says it
can't be opened, right-click it and choose **Open**.)

Or from a terminal:

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # rules engine tests (node:test via tsx)
npm run sim -- 200   # computer-vs-computer games as a rules sanity check
npm run build        # static site in dist/ (works from any folder / GitHub Pages)
```

## Legal

Cyberpunk, Cyberpunk 2077 and related marks are trademarks of CD PROJEKT S.A. The Cyberpunk
Trading Card Game is published by WeirdCo. Neither has any connection to this project or has
approved it.
