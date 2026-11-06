# CLAUDE.md

Afterlife is an unofficial browser implementation of the _Cyberpunk Trading Card Game_ (WeirdCo):
a pure TypeScript rules engine, a React UI with one PC-style layout scaled to fit any screen
(desktop, iPad, iPhone — no separate tablet/phone layouts), hot-seat play and a simple computer
opponent. It is a sibling project of Ready Room (kbiben29-hue/readyroom) and follows the same ideas.

## Commands

```bash
npm run dev                 # Vite app on :5173
npm test                    # tsx --test src/**/*.test.ts (node:test, no vitest)
npx tsx --test src/engine/engine.test.ts
npm run sim -- 200          # bot-vs-bot games; prints how games end
npm run fetch-cards         # Netdeck.gg API (or card pages) -> public/cards/ (gitignored); --pages, --debug
npm run fetch-deck -- <url> # public Deck Builder deck -> decks/<id>.txt
npm run build               # vite build (base './')
npm run typecheck           # tsc -b (needs npm install for the React types)
```

## Layout

- `src/engine/types.ts` — CardDef, GameState, Pending (who must decide), Intent, ManualOp.
- `src/engine/engine.ts` — `newGame()`, `apply(state, intent)` (pure: clones, never mutates input),
  `tryApply()` for the UI, queries (`attackers`, `canPlay`, `unitPower`, `streetCred`…).
- `src/engine/moves.ts` — `legalIntents(state)`; used by the bot and the fuzz test.
- `src/engine/decks.ts` — deck validation (3 Legends, 40–50, 3 copies, RAM per colour), random decks,
  deck-list parsing.
- `src/bot/bot.ts` — greedy "Street AI".
- `src/data/placeholder.ts` — generic placeholder pool; `src/data/cards.ts` loads `public/cards/cards.json` when present.
- `src/ui/coach.ts` — tutorial coach: `INTRO` pages, `coachFor(state, me, seen)` explains the current step and
  turns the bot's suggested move into a `Hint` (glowing hand cards / units / dice / buttons); `eventNote()` for one-off notes.
- `src/ui/` — `Board.tsx` (table, prompt bar, table tools), `Setup.tsx`, `Card.tsx`, `styles.css`.
- `src/App.tsx` — fit-to-screen scaling of the 1600×1000 stage, history/undo, autosave (localStorage), bot loop.

## Online play

`src/net/transport.ts` (PeerJS loaded from unpkg on demand; `?net=local` = BroadcastChannel between
tabs, used for testing) and `src/net/online.ts` (protocol). The host (seat 0) is authoritative: it
applies its own and the guest's intents with the engine and sends `{type:'state'}` (cards stripped;
sent once in `start`). The guest (seat 1) validates locally with `tryApply`, sends `{type:'intent'}`,
and renders the host's states. Peer id = `afterlife-<code>`, stable per game, so a refreshed host
re-opens the same id and a guest's `hello` mid-game gets the current state. Undo is off online.

## Releases

`.github/workflows/release.yml` runs on every push to main: tests → web build deployed to this
repo's GitHub Pages (https://kbiben29-hue.github.io/Afterlife-/, Pages source "GitHub Actions") →
Tauri apps (`src-tauri/`, macOS universal .dmg + Windows NSIS .exe) → a new release on this repo with
the stable names `Afterlife-Mac.dmg` / `Afterlife-Windows-Setup.exe` (keeps the 3 newest). The repo is
public; only GITHUB_TOKEN is used.

Card data in published builds: `src/data/cards.ts` loads `public/cards/cards.json` if present (local
only), else fetches the Netdeck.gg API live on the player's device (desktop: through the
`cards_fetch_text` Tauri command, restricted to api.netdeck.gg; browser: plain fetch, which depends on
the API's CORS policy) and caches it in localStorage; images load from the API's image URLs.
The workflow fails if `dist/cards` exists, so card data is never published.

## Hard rules

- **Engine determinism**: no `Math.random`, `Date.now` or `new Date` in `src/engine/**` and
  `src/bot/**`; randomness comes from `state.rng` via `Rng` (`src/engine/rng.ts`).
- **The engine is DOM-free**: no imports from `src/ui`. Engine tests run in plain Node.
- **Rules source**: Cyberpunk TCG Comprehensive Rules (28 Aug 2026 edition) and the official
  Gameplay Guide. Cite rule numbers in comments where a ruling is non-obvious. Card text overrides rules.
- **Card data is never committed**: `public/cards/` and `vendor/` are gitignored. Placeholder cards
  must stay generic (no real names, text or art).
- Every rules change gets a test in `src/engine/*.test.ts`; run `npm test` and `npm run sim` before committing.

## Not done yet / next steps

1. Script card abilities (Play / Attack / Defeated / Call triggers, Spend activations, static
   effects) — add an effect registry keyed by card id; until then players use the table tools.
2. Verify `tools/netdeck.ts` / `tools/fetch-cards.ts` against the live API (written without access to it):
   known endpoints are `api.netdeck.gg/api/cyberpunk/decks/<uuid>` and `api.netdeck.gg/api/cards/cyberpunk/<slug>/image`;
   the card-list endpoint is discovered at run time. Fix `mapCard()` from `vendor/cards/api-raw.json`.
3. Deck builder screen; saved decks.
4. Online play (like Ready Room's async server) and a stronger bot.
