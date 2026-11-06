// npm run fetch-deck -- <Deck Builder link or deck id>
// Prints the deck as "N Card Name" lines (paste them into the setup screen) and saves them to decks/<id>.txt.
// Works for public decks. Decks are your own lists, so decks/ is safe to commit.
import { mkdir, writeFile } from 'node:fs/promises'
import { fetchDeckList } from './netdeck'

const arg = process.argv[2]
if (!arg) {
	console.error('Usage: npm run fetch-deck -- https://cyberpunktcg.com/decks/<id>')
	process.exit(1)
}
const text = await fetchDeckList(arg)
const id = arg.match(/[0-9a-f-]{36}/i)?.[0] ?? 'deck'
await mkdir('decks', { recursive: true })
await writeFile(`decks/${id}.txt`, text + '\n')
console.log(text)
console.log(`\nSaved to decks/${id}.txt`)
