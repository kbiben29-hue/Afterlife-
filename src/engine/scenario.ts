// Build a game position directly (for combo drills and tests): skips setup and puts chosen cards
// into hands, fields, Legends, Gigs and Eddies. Pure and deterministic, like the rest of the engine.

import { newGame } from './engine'
import type { CardDef, DeckList, Die, DieSides, GameState, PlayerId } from './types'

export interface SideSpec {
	hand?: string[]
	/** Units in play; `gear` is attached; `ready` (default true) and `lag` (default false) */
	field?: { id: string; gear?: string[]; spent?: boolean; lag?: boolean }[]
	/** Legend card ids that start face-up; the others stay face-down */
	faceUp?: string[]
	/** Gig dice as [sides, value] */
	gigs?: [DieSides, number][]
	/** ready Eddies (sold cards) */
	eddies?: number
	/** cards put on top of the deck, in order */
	deckTop?: string[]
}

export interface ScenarioSpec {
	seed: number
	cards: Record<string, CardDef>
	decks: [DeckList, DeckList]
	names: [string, string]
	sides: [SideSpec, SideSpec]
	/** whose main phase it is (default 0) */
	active?: PlayerId
	turnsTaken?: number
}

export function scenario(spec: ScenarioSpec): GameState {
	const s = newGame({ seed: spec.seed, cards: spec.cards, decks: spec.decks, names: spec.names })
	let next = Math.max(...Object.keys(s.instances).map(Number)) + 1
	const mk = (p: PlayerId, id: string) => {
		const uid = next++
		s.instances[uid] = { uid, cardId: id, owner: p }
		return uid
	}
	/** take a copy of the card out of the deck if there is one, else make a new one */
	const take = (p: PlayerId, id: string) => {
		const pl = s.players[p]
		const i = pl.deck.findIndex((u) => s.instances[u].cardId === id)
		if (i >= 0) return pl.deck.splice(i, 1)[0]
		return mk(p, id)
	}
	for (const p of [0, 1] as PlayerId[]) {
		const pl = s.players[p]
		const sp = spec.sides[p]
		pl.deck.push(...pl.hand)
		pl.hand = []
		pl.turnsTaken = spec.turnsTaken ?? 3
		pl.mulliganed = true
		pl.hand = (sp.hand ?? []).map((id) => take(p, id))
		pl.field = (sp.field ?? []).map((f) => ({
			uid: take(p, f.id),
			spent: !!f.spent,
			lag: !!f.lag,
			attackDespiteLag: false,
			goSolo: false,
			gear: (f.gear ?? []).map((g) => take(p, g)),
			powerThisTurn: 0,
			powerPermanent: 0,
		}))
		for (const l of pl.legends) {
			l.faceUp = (sp.faceUp ?? []).includes(s.instances[l.uid].cardId)
			l.spent = false
			l.skipNextReady = false
		}
		// Eddies are sold cards: take them from the bottom of the deck
		for (let i = 0; i < (sp.eddies ?? 0) && pl.deck.length; i++) pl.eddies.push({ uid: pl.deck.pop()!, spent: false })
		const gigs = sp.gigs ?? []
		pl.gigs = gigs.map(([sides, value]): Die => ({ id: `${p}-d${sides}`, sides, value }))
		pl.fixer = pl.fixer.filter((d) => !gigs.some(([n]) => n === d.sides))
		const top = (sp.deckTop ?? []).map((id) => take(p, id))
		pl.deck.unshift(...top)
	}
	const a = spec.active ?? 0
	s.active = a
	s.firstPlayer = a
	s.turn = (spec.turnsTaken ?? 3) * 2 + 1
	s.pending = { kind: 'main', player: a }
	s.log = [`── Drill: ${s.players[a].name} to act ──`]
	return s
}
