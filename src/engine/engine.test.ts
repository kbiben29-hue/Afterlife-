// Run with: npm test   (node:test via tsx — no extra test framework needed)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PLACEHOLDER_CARDS as CARDS } from '../data/placeholder'
import { apply, attackers, gigsToSteal, legalGigDice, newGame, streetCred, tryApply, unitPower } from './engine'
import { parseDeckList, randomDeck, validateDeck } from './decks'
import type { FieldUnit, GameState, PlayerId } from './types'

function started(seed = 42): GameState {
	let s = newGame({ seed, cards: CARDS, decks: [randomDeck(CARDS, 1, ['red', 'blue']), randomDeck(CARDS, 2, ['green', 'yellow'])] })
	const chooser = (s.pending as { player: PlayerId }).player
	s = apply(s, { t: 'chooseFirst', player: chooser, first: 0 })
	s = apply(s, { t: 'mulligan', player: 0, redraw: false })
	s = apply(s, { t: 'mulligan', player: 1, redraw: false })
	if (s.pending.kind === 'chooseGig') s = apply(s, { t: 'chooseGig', player: 0, dieId: '0-d4' })
	return s
}

/** Put a card straight onto a field for focused combat tests. */
function place(s: GameState, p: PlayerId, cardId: string, extra: Partial<FieldUnit> = {}): number {
	const uid = Math.max(...Object.keys(s.instances).map(Number)) + 1
	s.instances[uid] = { uid, cardId, owner: p }
	s.players[p].field.push({ uid, spent: false, lag: false, attackDespiteLag: false, goSolo: false, gear: [], powerThisTurn: 0, powerPermanent: 0, ...extra })
	return uid
}
function giveEddies(s: GameState, p: PlayerId, n: number) {
	for (let i = 0; i < n; i++) {
		const uid = Math.max(...Object.keys(s.instances).map(Number)) + 1
		s.instances[uid] = { uid, cardId: 'ph-RU01', owner: p }
		s.players[p].eddies.push({ uid, spent: false })
	}
}

test('random decks are legal', () => {
	for (let i = 0; i < 20; i++) assert.deepEqual(validateDeck(CARDS, randomDeck(CARDS, i)), [])
})

test('deck validation catches RAM, copies and size', () => {
	const errs = validateDeck(CARDS, { legends: ['ph-RL01', 'ph-RL02', 'ph-RL03'], main: [...Array(4).fill('ph-RU01'), 'ph-BU09'] })
	assert.ok(errs.some((e) => e.includes('copies')))
	assert.ok(errs.some((e) => e.includes('blue RAM')))
	assert.ok(errs.some((e) => e.includes('40–50')))
})

test('deck list import', () => {
	const { deck, unknown } = parseDeckList(CARDS, '1 R-L01\n1 R-L02\n1x R-L03\n3 R-U01\n3x R-U02\nNope')
	assert.equal(deck.legends.length, 3)
	assert.equal(deck.main.length, 6)
	assert.deepEqual(unknown, ['Nope'])
})

test('setup: hands of 6 (+1 draw for the first player), two Legends spent and kept spent on turn 1', () => {
	const s = started()
	assert.equal(s.players[0].hand.length, 7)
	assert.equal(s.players[1].hand.length, 6)
	assert.deepEqual(s.players[0].legends.map((l) => l.spent), [true, true, false])
	assert.equal(s.players[0].gigs.length, 1)
	assert.equal(s.pending.kind, 'main')
})

test('d20 is only taken last', () => {
	const s = started()
	s.players[0].fixer = s.players[0].fixer.filter((d) => d.sides === 20 || d.sides === 12)
	assert.deepEqual(legalGigDice(s.players[0]).map((d) => d.sides), [12])
})

test('sell once per turn, then pay with the Eddie', () => {
	let s = started()
	const card = s.players[0].hand.find((u) => CARDS[s.instances[u].cardId].sell)!
	s = apply(s, { t: 'sell', player: 0, uid: card })
	assert.equal(s.players[0].eddies.length, 1)
	const again = tryApply(s, { t: 'sell', player: 0, uid: s.players[0].hand[0] })
	assert.match(again.error!, /already sold/)
})

test('Units enter with Lag; Adrenaline ignores it', () => {
	const s = started()
	const a = place(s, 0, 'ph-RU01', { lag: true })
	const b = place(s, 0, 'ph-RU05', { lag: true })
	assert.deepEqual(attackers(s, 0), [b])
	assert.ok(!attackers(s, 0).includes(a))
})

test('ready Units cannot be attacked', () => {
	const s = started()
	const a = place(s, 0, 'ph-RU04')
	const d = place(s, 1, 'ph-GU04')
	const r = tryApply(s, { t: 'attack', player: 0, attacker: a, target: { kind: 'unit', uid: d } })
	assert.match(r.error!, /Ready Units/)
})

test('fights: higher wins, ties trade, 0 power never defeats', () => {
	const fight = (pa: string, pd: string) => {
		let s = started()
		const a = place(s, 0, pa)
		const d = place(s, 1, pd, { spent: true })
		s = apply(s, { t: 'attack', player: 0, attacker: a, target: { kind: 'unit', uid: d } })
		s = apply(s, { t: 'pass', player: 1 })
		return [s.players[0].field.some((u) => u.uid === a), s.players[1].field.some((u) => u.uid === d)]
	}
	assert.deepEqual(fight('ph-RU06', 'ph-GU04'), [true, false]) // 5 v 4
	assert.deepEqual(fight('ph-RU04', 'ph-GU04'), [false, false]) // 4 v 4
	let s = started()
	const a = place(s, 0, 'ph-RU04', { powerThisTurn: -4 })
	const d = place(s, 1, 'ph-GU04', { spent: true, powerThisTurn: -4 })
	s = apply(s, { t: 'attack', player: 0, attacker: a, target: { kind: 'unit', uid: d } })
	s = apply(s, { t: 'pass', player: 1 })
	assert.equal(s.players[0].field.length + s.players[1].field.length, 2) // 0 v 0: nobody defeated
})

test('steal count is floor(power/10)+1 and 0 power steals nothing', () => {
	assert.deepEqual([0, 1, 9, 10, 19, 20, -3].map(gigsToSteal), [0, 1, 1, 2, 2, 3, 0])
})

test('direct attack steals; attacker chooses when there is a choice', () => {
	let s = started()
	s.players[1].gigs = [
		{ id: '1-d6', sides: 6, value: 3 },
		{ id: '1-d8', sides: 8, value: 5 },
		{ id: '1-d10', sides: 10, value: 7 },
	]
	const a = place(s, 0, 'ph-RU10') // power 11 → steals 2
	s = apply(s, { t: 'attack', player: 0, attacker: a, target: { kind: 'gigs' } })
	s = apply(s, { t: 'pass', player: 1 })
	assert.deepEqual(s.pending, { kind: 'steal', player: 0, remaining: 2 })
	s = apply(s, { t: 'steal', player: 0, dieId: '1-d10' })
	s = apply(s, { t: 'steal', player: 0, dieId: '1-d8' })
	assert.equal(s.players[0].gigs.length, 3)
	assert.equal(s.players[1].gigs.length, 1)
	assert.equal(s.pending.kind, 'main')
	assert.equal(streetCred(s.players[1]), 3)
})

test('Blocker redirects a direct attack and no Gigs are stolen', () => {
	let s = started()
	s.players[1].gigs = [{ id: '1-d6', sides: 6, value: 3 }]
	const a = place(s, 0, 'ph-RU02') // 3 power
	const b = place(s, 1, 'ph-GU03') // blocker, 1 power
	s = apply(s, { t: 'attack', player: 0, attacker: a, target: { kind: 'gigs' } })
	s = apply(s, { t: 'block', player: 1, blocker: b })
	s = apply(s, { t: 'pass', player: 1 })
	assert.equal(s.players[1].gigs.length, 1)
	assert.ok(!s.players[1].field.some((u) => u.uid === b))
})

test('Call a Legend: once per turn, also as a reaction', () => {
	let s = started()
	giveEddies(s, 0, 2)
	giveEddies(s, 1, 2)
	s = apply(s, { t: 'callLegend', player: 0 })
	assert.equal(s.players[0].legends.filter((l) => l.faceUp).length, 1)
	assert.match(tryApply(s, { t: 'callLegend', player: 0 }).error!, /already/)
	const a = place(s, 0, 'ph-RU02')
	s = apply(s, { t: 'attack', player: 0, attacker: a, target: { kind: 'gigs' } })
	s = apply(s, { t: 'callLegend', player: 1 })
	assert.equal(s.players[1].legends.filter((l) => l.faceUp).length, 1)
})

test('Gear adds power; Go Solo Legend can attack and is removed when defeated', () => {
	let s = started()
	giveEddies(s, 0, 10)
	const u = place(s, 0, 'ph-RU01')
	const gearUid = Math.max(...Object.keys(s.instances).map(Number)) + 1
	s.instances[gearUid] = { uid: gearUid, cardId: 'ph-RG02', owner: 0 }
	s.players[0].hand.push(gearUid)
	s = apply(s, { t: 'play', player: 0, uid: gearUid, target: u })
	assert.equal(unitPower(s, s.players[0].field[0]), 4)

	const legend = s.players[0].legends[2]
	s.instances[legend.uid].cardId = 'ph-RL03'
	legend.faceUp = true
	s = apply(s, { t: 'goSolo', player: 0, uid: legend.uid })
	assert.ok(attackers(s, 0).includes(legend.uid))
	const big = place(s, 1, 'ph-GU10', { spent: true })
	s = apply(s, { t: 'attack', player: 0, attacker: legend.uid, target: { kind: 'unit', uid: big } })
	s = apply(s, { t: 'pass', player: 1 })
	assert.ok(s.players[0].removed.includes(legend.uid))
})

test('7 Gigs at the start of your turn wins', () => {
	let s = started()
	s.players[1].gigs = [4, 6, 8, 10, 12, 20, 6].map((n, i) => ({ id: `x${i}`, sides: n as 6, value: 1 }))
	s = apply(s, { t: 'endTurn', player: 0 })
	assert.deepEqual(s.pending.kind === 'over' && s.pending.winner, 1)
})

test('drawing from an empty deck loses', () => {
	let s = started()
	s.players[1].deck = []
	s = apply(s, { t: 'endTurn', player: 0 })
	assert.equal(s.pending.kind === 'over' && s.pending.winner, 0)
})

test('Overtime starts after both players take their 7th turn, then 7 Gigs wins at once', () => {
	let s = started()
	const pass = () => {
		if (s.pending.kind === 'chooseGig') s = apply(s, { t: 'chooseGig', player: s.pending.player, dieId: legalGigDice(s.players[s.pending.player])[0].id })
		s = apply(s, { t: 'endTurn', player: s.active })
	}
	for (let i = 0; i < 13; i++) pass()
	assert.equal(s.overtime, false)
	pass() // end of the second player's 7th turn
	assert.equal(s.overtime, true)
	assert.equal(s.pending.kind, 'main')
	// Give player 0 a 7th die via the table tools: overtime check fires immediately.
	s = apply(s, { t: 'manual', player: s.active, m: { op: 'moveDie', dieId: s.players[1].gigs[0].id } })
	const holder = s.players[0].gigs.length >= 7 ? 0 : 1
	assert.equal(s.pending.kind === 'over' && s.pending.winner, holder)
})

test('games are deterministic for a seed', () => {
	const a = started(99)
	const b = started(99)
	assert.deepEqual(a, b)
})
