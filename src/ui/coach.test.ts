import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PLACEHOLDER_CARDS as CARDS } from '../data/placeholder'
import { apply, newGame, legalGigDice } from '../engine/engine'
import { randomDeck } from '../engine/decks'
import { chooseIntent } from '../bot/bot'
import { coachFor } from './coach'

test('the coach always has advice for the player, and points only at things that exist', () => {
	for (let g = 1; g <= 40; g++) {
		let s = newGame({ seed: g, cards: CARDS, decks: [randomDeck(CARDS, g), randomDeck(CARDS, g + 99)] })
		const seen = new Set<string>()
		while (s.pending.kind !== 'over') {
			if (s.pending.player === 0) {
				const c = coachFor(s, 0, seen)
				assert.ok(c, `no advice at ${s.pending.kind}`)
				seen.add(c!.key)
				const me = s.players[0]
				for (const h of c!.hint.hand ?? []) assert.ok(me.hand.includes(h))
				for (const u of c!.hint.units ?? []) assert.ok([...me.field, ...s.players[1].field].some((x) => x.uid === u))
				for (const l of c!.hint.legends ?? []) assert.ok(me.legends.some((x) => x.uid === l))
				if (s.pending.kind === 'chooseGig') assert.ok(legalGigDice(me).some((d) => d.id === c!.hint.dice![0]))
			}
			s = apply(s, chooseIntent(s)!)
		}
		assert.ok(coachFor(s, 0, new Set()))
	}
})
