import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PLACEHOLDER_CARDS as CARDS } from '../data/placeholder'
import { apply, newGame } from './engine'
import { randomDeck } from './decks'
import { legalIntents } from './moves'
import { Rng } from './rng'
import { chooseIntent } from '../bot/bot'
import type { GameState } from './types'

const game = (seed: number) =>
	newGame({ seed, cards: CARDS, decks: [randomDeck(CARDS, seed * 3), randomDeck(CARDS, seed * 3 + 1)] })

test('random legal play never throws and games end', () => {
	for (let g = 1; g <= 150; g++) {
		let s: GameState = game(g)
		const rng = new Rng(g)
		let steps = 0
		while (s.pending.kind !== 'over' && steps < 3000) {
			const moves = legalIntents(s)
			// lean towards ending the turn so games finish
			const end = moves.find((m) => m.t === 'endTurn')
			const m = end && rng.float() < 0.25 ? end : moves[rng.int(moves.length)]
			s = apply(s, m)
			steps++
		}
		assert.equal(s.pending.kind, 'over', `game ${g} did not finish`)
	}
})

test('bot vs bot games finish', () => {
	const wins = [0, 0]
	for (let g = 1; g <= 60; g++) {
		let s: GameState = game(g)
		let steps = 0
		while (s.pending.kind !== 'over' && steps < 3000) {
			s = apply(s, chooseIntent(s)!)
			steps++
		}
		assert.equal(s.pending.kind, 'over')
		if (s.pending.kind === 'over') wins[s.pending.winner]++
	}
	assert.equal(wins[0] + wins[1], 60)
})
