// Deck building: validation (3 Legends, 40–50 cards, 3 copies, RAM per colour), random decks, list import.

import { Rng } from './rng'
import { COLORS, type CardDef, type Color, type DeckList } from './types'
import { DECK_MAX, DECK_MIN, MAX_COPIES } from './engine'

/** RAM available per colour = sum of that colour's RAM across the 3 Legends. */
export function ramLimits(cards: Record<string, CardDef>, legends: string[]): Record<Color, number> {
	const out: Record<Color, number> = { red: 0, green: 0, blue: 0, yellow: 0 }
	for (const id of legends) {
		const d = cards[id]
		if (d?.color) out[d.color] += d.ram
	}
	return out
}

export function validateDeck(cards: Record<string, CardDef>, deck: DeckList): string[] {
	const errors: string[] = []
	if (deck.legends.length !== 3) errors.push(`Needs exactly 3 Legends (has ${deck.legends.length})`)
	const names = new Set(deck.legends.map((id) => cards[id]?.name))
	if (names.size !== deck.legends.length) errors.push('Legends must have different names')
	for (const id of deck.legends) if (cards[id]?.type !== 'legend') errors.push(`${cards[id]?.name ?? id} is not a Legend`)
	if (deck.main.length < DECK_MIN || deck.main.length > DECK_MAX)
		errors.push(`Main deck must be ${DECK_MIN}–${DECK_MAX} cards (has ${deck.main.length})`)
	const counts = new Map<string, number>()
	for (const id of deck.main) counts.set(id, (counts.get(id) ?? 0) + 1)
	const ram = ramLimits(cards, deck.legends)
	for (const [id, n] of counts) {
		const d = cards[id]
		if (!d) {
			errors.push(`Unknown card ${id}`)
			continue
		}
		if (d.type === 'legend') errors.push(`${d.name}: Legends don't go in the main deck`)
		if (n > MAX_COPIES) errors.push(`${d.name}: ${n} copies (max ${MAX_COPIES})`)
		if (d.color && d.ram > ram[d.color]) errors.push(`${d.name}: needs ${d.ram} ${d.color} RAM (deck has ${ram[d.color]})`)
	}
	return errors
}

/** Build a legal random deck around two colours from whatever card pool is loaded. */
export function randomDeck(cards: Record<string, CardDef>, seed: number, colors?: [Color, Color]): DeckList {
	const rng = new Rng(seed >>> 0 || 7)
	const all = Object.values(cards)
	const legendsOf = (c: Color) => all.filter((d) => d.type === 'legend' && d.color === c)
	const pair =
		colors ??
		(() => {
			const usable = COLORS.filter((c) => legendsOf(c).length > 0)
			const sh = rng.shuffle(usable)
			return [sh[0], sh[1] ?? sh[0]] as [Color, Color]
		})()
	const pool = rng.shuffle([...legendsOf(pair[0]), ...legendsOf(pair[1])])
	const legends: CardDef[] = []
	for (const d of pool) if (legends.length < 3 && !legends.some((l) => l.name === d.name)) legends.push(d)
	const deck: DeckList = { legends: legends.map((d) => d.id), main: [] }
	const ram = ramLimits(cards, deck.legends)
	const candidates = rng.shuffle(all.filter((d) => d.type !== 'legend' && d.color && ram[d.color] >= d.ram && ram[d.color] > 0))
	// Mostly Units (about two thirds), cheaper ones first so the deck has a curve, topped up with Gear and Programs.
	const byCost = (a: CardDef, b: CardDef) => (a.cost ?? 0) - (b.cost ?? 0) + (rng.float() - 0.5) * 4
	const units = candidates.filter((d) => d.type === 'unit').sort(byCost)
	const rest = candidates.filter((d) => d.type !== 'unit').sort(byCost)
	const add = (list: CardDef[], target: number) => {
		for (const d of list) {
			if (deck.main.length >= target) break
			if (deck.main.includes(d.id)) continue
			const copies = Math.min(MAX_COPIES, target - deck.main.length)
			for (let i = 0; i < copies; i++) deck.main.push(d.id)
		}
	}
	add(units, 27)
	add(rest, DECK_MIN)
	add(units, DECK_MIN)
	return deck
}

/**
 * Parse a pasted deck list. Accepts lines such as "3 Ruthless Lowlife", "3x Ruthless Lowlife"
 * or "Ruthless Lowlife" (1 copy). Legends are picked out by card type.
 */
export function parseDeckList(cards: Record<string, CardDef>, text: string): { deck: DeckList; unknown: string[] } {
	const norm = (s: string) =>
		s
			.toLowerCase()
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.replace(/[—–-]/g, ' ')
			.replace(/[^a-z0-9 ]/g, '')
			.replace(/\s+/g, ' ')
			.trim()
	const byName = new Map<string, CardDef>()
	for (const d of Object.values(cards)) {
		byName.set(norm(d.subtitle ? `${d.name} ${d.subtitle}` : d.name), d)
		if (!byName.has(norm(d.name))) byName.set(norm(d.name), d)
		byName.set(norm(d.id), d)
	}
	const deck: DeckList = { legends: [], main: [] }
	const unknown: string[] = []
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim()
		if (!line || /^(#|\/\/|legends?:?$|main( deck)?:?$|deck:?$)/i.test(line)) continue
		const m = line.match(/^(\d+)\s*x?\s+(.+)$/i)
		const n = m ? parseInt(m[1], 10) : 1
		const name = m ? m[2] : line
		const d = byName.get(norm(name))
		if (!d) {
			unknown.push(line)
			continue
		}
		for (let i = 0; i < n; i++) (d.type === 'legend' ? deck.legends : deck.main).push(d.id)
	}
	return { deck, unknown }
}
