# Multiplayer notes (from a reference Cyberpunk TCG site, Nov 2026)

Notes on how another fan site organises play, for features to add later. The look of
Afterlife's home screen now follows the same general style: dark panels, angular clipped buttons,
condensed display type, yellow and cyan accents, tabbed modes, deck cards showing the three Legends.
Afterlife keeps its own name, wordmark and wording.

## Play screen

- **Live counters** at the top: players online, live games, players queueing.
- **Getting-started strip** of steps with a progress bar (0%): sign up → create a deck → beat the
  easy bot → the hard bot → the expert bot → play an online match. It shows a new player what to do next.
- **Boss challenge**: a featured AI opponent ("boss") with an online indicator and a big Challenge button.
- **Mode tabs**:
  - *A friend*: private invite.
  - *Matchmaking*: ranked queue, with a badge showing the count in the queue.
  - *Daily Sealed*: everyone builds from the same daily random pool.
  - *Offline*: a bot, or two players on one screen.
- **Offline panel** (no account needed):
  - "Never played? Start here.": a guided tutorial game you win, using both starter decks.
  - Hotseat: a deck picker per player. Each deck is a card with three Legend art panels side by
    side, the deck name, and colour badges (x4 / x2 = RAM per colour). There's a chevron to expand
    the list, a note that it doesn't affect your rating, and a big full-width "Start hotseat" button.
- **Bot difficulty levels**: Easy, Hard, Expert.
- **Live games list**: format (CORE), turn number, both players with rank arrows, the colours each
  is playing, and a sort by Turn or MMR (rating).
- **Events**: scheduled tournaments ("Night Cup starts in 39 min" banner with Register).
- **Bottom navigation (phone)**: Decks, Cards, Play (raised, glowing centre button with a badge),
  Events, More.

## Ideas for Afterlife, roughly in order of effort

1. Bot difficulty (Easy / Hard / Expert): the bot already scores options. Easy plays more randomly,
   Expert looks one attack ahead.
2. A getting-started checklist on the home screen (tutorial → a drill → beat the bot → play a friend),
   saved in localStorage.
3. Deck builder and saved decks, which "Create deck" and "Decks" both need.
4. Card browser ("Cards" tab) with filters.
5. Spectating a friend's game: the host already sends full states, so a read-only third peer is cheap.
6. Matchmaking, live game lists, ratings and tournaments need a server, like Ready Room's async
   server. That's a bigger step: accounts, a lobby service, and rating storage.
7. Daily Sealed: a seeded daily card pool (the date is the seed), build a 40-card deck from it,
   then play. Works offline against the bot too.
