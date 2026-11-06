// npm run sim -- 200   → computer-vs-computer games with the loaded/placeholder cards, to sanity-check the rules
import { PLACEHOLDER_CARDS as CARDS } from '../src/data/placeholder'
import { apply, newGame } from '../src/engine/engine'
import { randomDeck } from '../src/engine/decks'
import { chooseIntent } from '../src/bot/bot'

const games = Number(process.argv[2] ?? 100)
const reasons: Record<string, number> = {}
let turns = 0
for (let g = 1; g <= games; g++) {
	let s = newGame({ seed: g, cards: CARDS, decks: [randomDeck(CARDS, g * 3), randomDeck(CARDS, g * 3 + 1)] })
	while (s.pending.kind !== 'over') s = apply(s, chooseIntent(s)!)
	const r = s.pending.reason.replace(/^.*(starts the turn|Overtime|empty deck|concedes).*$/, '$1')
	reasons[r] = (reasons[r] ?? 0) + 1
	turns += s.turn
}
console.log(`${games} games`, reasons, `average ${(turns / games).toFixed(1)} turns`)
