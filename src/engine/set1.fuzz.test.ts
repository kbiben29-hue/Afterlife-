// The whole automated card pool under random play and bot play: nothing throws, games end.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SET1_FIXTURE as CARDS } from './set1.fixture'
import { apply, newGame } from './engine'
import { randomDeck } from './decks'
import { legalIntents } from './moves'
import { Rng } from './rng'
import { chooseIntent } from '../bot/bot'
import type { GameState } from './types'

// Rebecca has no rules yet in the database
const POOL = Object.fromEntries(Object.entries(CARDS).filter(([id]) => id !== 'rebecca-having-a-moment'))
const game = (seed: number) => newGame({ seed, cards: POOL, decks: [randomDeck(POOL, seed * 7), randomDeck(POOL, seed * 7 + 3)] })

test('full card pool: random legal play never throws and games end', () => {
	for (let g = 1; g <= 120; g++) {
		let s: GameState = game(g)
		const rng = new Rng(g + 1000)
		let steps = 0
		while (s.pending.kind !== 'over' && steps < 4000) {
			const moves = legalIntents(s)
			assert.ok(moves.length > 0, `game ${g}: no legal moves in ${s.pending.kind}\n${s.log.slice(-8).join('\n')}`)
			const end = moves.find((m) => m.t === 'endTurn')
			const m = end && rng.float() < 0.25 ? end : moves[rng.int(moves.length)]
			try {
				s = apply(s, m)
			} catch (e) {
				assert.fail(`game ${g} step ${steps}: ${JSON.stringify(m)} → ${(e as Error).message}\n${s.log.slice(-10).join('\n')}`)
			}
			steps++
		}
		assert.equal(s.pending.kind, 'over', `game ${g} did not finish`)
	}
})

test('full card pool: bot vs bot games finish', () => {
	for (let g = 1; g <= 80; g++) {
		let s: GameState = game(g + 500)
		let steps = 0
		while (s.pending.kind !== 'over' && steps < 4000) {
			const i = chooseIntent(s)!
			try {
				s = apply(s, i)
			} catch (e) {
				assert.fail(`game ${g} step ${steps}: ${JSON.stringify(i)} → ${(e as Error).message}\n${s.log.slice(-10).join('\n')}`)
			}
			steps++
		}
		assert.equal(s.pending.kind, 'over', `game ${g} did not finish: ${s.log.slice(-5).join(' | ')}`)
	}
})
