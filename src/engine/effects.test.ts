// One test (at least) per scripted starter-deck card.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STARTER_FIXTURE as CARDS } from './starters.fixture'
import { starterDeck } from '../data/starters'
import { apply, newGame, streetCred, tryApply, unitPower, findUnit } from './engine'
import { legalIntents } from './moves'
import { validateDeck } from './decks'
import { chooseIntent } from '../bot/bot'
import type { Die, GameState, Intent, PlayerId } from './types'

/** Player 0 = The Heist, player 1 = Embracing Power; player 0's main phase, empty boards and hands. */
function table(seed = 7): GameState {
	const power = starterDeck('power')
	let s = newGame({ seed, cards: CARDS, decks: [starterDeck('heist'), power], names: ['Me', 'Rival'] })
	const chooser = (s.pending as { player: PlayerId }).player
	s = apply(s, { t: 'chooseFirst', player: chooser, first: 0 })
	s = apply(s, { t: 'mulligan', player: 0, redraw: false })
	s = apply(s, { t: 'mulligan', player: 1, redraw: false })
	for (const p of [0, 1] as PlayerId[]) {
		const pl = s.players[p]
		pl.deck.push(...pl.hand)
		pl.hand = []
		pl.fixer = []
		pl.gigs = []
		for (const l of pl.legends) {
			l.spent = false
			l.skipNextReady = false
		}
	}
	s.pending = { kind: 'main', player: 0 }
	s.active = 0
	return s
}
let nextUid = 1000
function card(s: GameState, p: PlayerId, id: string): number {
	const uid = nextUid++
	s.instances[uid] = { uid, cardId: id, owner: p }
	return uid
}
function hand(s: GameState, p: PlayerId, id: string) {
	const uid = card(s, p, id)
	s.players[p].hand.push(uid)
	return uid
}
function unit(s: GameState, p: PlayerId, id: string, opts: { spent?: boolean; gear?: string[] } = {}) {
	const uid = card(s, p, id)
	s.players[p].field.push({ uid, spent: !!opts.spent, lag: false, attackDespiteLag: false, goSolo: false, gear: (opts.gear ?? []).map((g) => card(s, p, g)), powerThisTurn: 0, powerPermanent: 0 })
	return uid
}
function eddies(s: GameState, p: PlayerId, n: number, spent = false) {
	for (let i = 0; i < n; i++) s.players[p].eddies.push({ uid: card(s, p, 'psycho-squad'), spent })
}
function gigs(s: GameState, p: PlayerId, dice: [number, number][]) {
	s.players[p].gigs = dice.map(([sides, value], i): Die => ({ id: `${p}-g${i}-d${sides}`, sides: sides as Die['sides'], value }))
}
/** Set a Legend slot to a given card (face-up or not). */
function legend(s: GameState, p: PlayerId, id: string, faceUp: boolean) {
	const slot = s.players[p].legends.find((l) => s.instances[l.uid].cardId === id)!
	slot.faceUp = faceUp
	return slot.uid
}
/** Apply an intent, then answer any questions in order. */
function act(s: GameState, i: Intent, ...answers: string[][]): GameState {
	s = apply(s, i)
	for (const a of answers) {
		assert.equal(s.pending.kind, 'choose', `expected a question, got ${s.pending.kind}`)
		s = apply(s, { t: 'choose', player: s.pending.player, picks: a })
	}
	return s
}
const P = (s: GameState) => s.pending
const q = (s: GameState) => (s.pending.kind === 'choose' ? s.pending.question : null)
const pass = (s: GameState) => apply(s, { t: 'pass', player: 1 })

// ═════ The Heist ═════

test('Dexter: on Play adjust a Gig by up to 1', () => {
	let s = table()
	eddies(s, 0, 3)
	gigs(s, 1, [[6, 4]])
	const d = hand(s, 0, 'dexter-deshawn-one-last-chance')
	s = apply(s, { t: 'play', player: 0, uid: d })
	assert.equal(P(s).kind, 'choose')
	s = act(s, { t: 'choose', player: 0, picks: ['1-g0-d6'] }, ['3'])
	assert.equal(s.players[1].gigs[0].value, 3)
	assert.equal(P(s).kind, 'main')
})

test('Dexter: Defeated draws 2 when Street Cred differs by 10+', () => {
	let s = table()
	gigs(s, 0, [[20, 15]])
	gigs(s, 1, [[4, 1]])
	const d = unit(s, 0, 'dexter-deshawn-one-last-chance', { spent: true })
	const atk = unit(s, 1, 'psycho-squad')
	s.active = 1
	s.pending = { kind: 'main', player: 1 }
	const before = s.players[0].hand.length
	s = apply(s, { t: 'attack', player: 1, attacker: atk, target: { kind: 'unit', uid: d } })
	s = apply(s, { t: 'pass', player: 0 })
	assert.equal(s.players[0].hand.length, before + 2)
})

test('Offduty Malfini: spends itself and a rival Unit', () => {
	let s = table()
	eddies(s, 0, 4)
	const r = unit(s, 1, 'psycho-squad')
	const m = hand(s, 0, 'offduty-malfini')
	s = apply(s, { t: 'play', player: 0, uid: m })
	assert.equal(findUnit(s, m)!.spent, true)
	assert.equal(findUnit(s, r)!.spent, true)
})

test('T-Bug: Defeated looks at face-down Legends and may Call one free', () => {
	let s = table()
	const t = unit(s, 0, 't-bug-amateur-philosopher')
	// defeat it through Over the Edge from the rival
	gigs(s, 1, [[20, 12]])
	eddies(s, 1, 3)
	s.active = 1
	s.pending = { kind: 'main', player: 1 }
	const ote = hand(s, 1, 'over-the-edge')
	s = apply(s, { t: 'play', player: 1, uid: ote }) // the only legal target is picked automatically
	assert.equal(q(s)?.prompt.startsWith('T-Bug'), true)
	assert.equal(q(s)?.reveal?.length, 3)
	s = act(s, { t: 'choose', player: 0, picks: ['yes'] })
	assert.equal(s.players[0].knownLegends?.length, 3)
	if (P(s).kind === 'choose') s = apply(s, { t: 'choose', player: 0, picks: [] }) // it was Viktor: take nothing
	assert.equal(s.players[0].legends.filter((l) => l.faceUp).length, 1)
	assert.equal(P(s).kind, 'main')
	assert.equal(P(s).kind === 'main' && P(s).player, 1)
})

test('Heywood: defeat a Gear; draw if its cost matches a friendly Gig', () => {
	let s = table()
	eddies(s, 0, 6)
	gigs(s, 0, [[6, 2]])
	const host = unit(s, 1, 'psycho-squad', { gear: ['satori-sword-of-saburo'] })
	const g = findUnit(s, host)!.gear[0]
	const h = hand(s, 0, 'heywood-ripperdoc')
	s = act(s, { t: 'play', player: 0, uid: h }, [String(g)])
	assert.equal(findUnit(s, host)!.gear.length, 0)
	assert.ok(s.players[1].trash.includes(g))
	assert.equal(s.players[0].hand.length, 1)
})

test('Evelyn: on Attack draw 1, then discard 1 if ahead on Street Cred', () => {
	let s = table()
	gigs(s, 0, [[6, 5]])
	gigs(s, 1, [[4, 1]])
	const e = unit(s, 0, 'evelyn-parker-scheming-siren')
	const keep = hand(s, 0, 'minotaur')
	s = apply(s, { t: 'attack', player: 0, attacker: e, target: { kind: 'gigs' } })
	assert.equal(q(s)?.max, 1)
	const drawn = q(s)!.options.find((o) => o.uid !== keep)!.id
	s = act(s, { t: 'choose', player: 0, picks: [drawn] })
	assert.deepEqual(s.players[0].hand, [keep])
	assert.equal(P(s).kind, 'react')
})

test('Delamain Cab: readies an Eddie at end of turn after stealing', () => {
	let s = table()
	eddies(s, 0, 2, true)
	gigs(s, 1, [[6, 3]])
	const c = unit(s, 0, 'delamain-cab')
	s = pass(apply(s, { t: 'attack', player: 0, attacker: c, target: { kind: 'gigs' } }))
	assert.equal(s.players[0].gigs.length, 1)
	s = apply(s, { t: 'endTurn', player: 0 })
	// readied at end of turn; then it's the rival's turn, our eddies stay as they were
	assert.equal(s.players[0].eddies.filter((e) => !e.spent).length, 1)
})

test('MT0D12 Flathead: unblockable while behind on Street Cred', () => {
	let s = table()
	gigs(s, 0, [[4, 1]])
	gigs(s, 1, [[6, 6]])
	const f = unit(s, 0, 'mt0d12-flathead')
	const b = unit(s, 1, 'corpo-security')
	s = apply(s, { t: 'attack', player: 0, attacker: f, target: { kind: 'gigs' } })
	assert.ok(tryApply(s, { t: 'block', player: 1, blocker: b }).error)
	assert.ok(!legalIntents(s).some((i) => i.t === 'block'))
})

test('Kiroshi Optics: host attacks → look at a face-down Legend', () => {
	let s = table()
	const u = unit(s, 0, 'psycho-squad', { gear: ['kiroshi-optics'] })
	s = act(s, { t: 'attack', player: 0, attacker: u, target: { kind: 'gigs' } }, [String(s.players[0].legends[1].uid)])
	assert.deepEqual(s.players[0].knownLegends, [s.players[0].legends[1].uid])
	assert.equal(unitPower(s, findUnit(s, u)!), 7)
})

test('Mandibular Upgrade: grants Blocker', () => {
	let s = table()
	const blk = unit(s, 0, 'psycho-squad', { gear: ['mandibular-upgrade'] })
	const atk = unit(s, 1, 'emergency-atlus')
	gigs(s, 0, [[4, 3]])
	s.active = 1
	s.pending = { kind: 'main', player: 1 }
	s = apply(s, { t: 'attack', player: 1, attacker: atk, target: { kind: 'gigs' } })
	s = apply(s, { t: 'block', player: 0, blocker: blk })
	s = apply(s, { t: 'pass', player: 0 })
	assert.equal(findUnit(s, atk), undefined)
})

test('Zetatech Faceplate: host spent → adjust a Gig; 3+ different values draws 1', () => {
	let s = table()
	gigs(s, 0, [[4, 2], [6, 2], [8, 5]])
	const u = unit(s, 0, 'psycho-squad', { gear: ['zetatech-faceplate'] })
	s = act(s, { t: 'attack', player: 0, attacker: u, target: { kind: 'gigs' } }, ['0-g1-d6'], ['3'])
	assert.equal(s.players[0].hand.length, 1)
})

test('Tetratronic Rippler: host spent → may trash the top card', () => {
	let s = table()
	const u = unit(s, 0, 'psycho-squad', { gear: ['tetratronic-rippler'] })
	const top = s.players[0].deck[0]
	s = act(s, { t: 'attack', player: 0, attacker: u, target: { kind: 'gigs' } }, ['trash'])
	assert.ok(s.players[0].trash.includes(top))
})

test('Dying Night on V: decrease a Gig by 2, ready 2 Eddies at end of turn', () => {
	let s = table()
	gigs(s, 1, [[8, 7]])
	eddies(s, 0, 3, true)
	const v = unit(s, 0, 'v-corporate-exile', { gear: ['dying-night-v-s-pistol'] })
	s = act(s, { t: 'attack', player: 0, attacker: v, target: { kind: 'gigs' } }, ['1-g0-d8'], ['5'])
	assert.equal(s.players[1].gigs[0].value, 5)
	s = pass(s) // V has 10 power: steals the only Gig
	s = apply(s, { t: 'endTurn', player: 0 })
	assert.equal(s.players[0].eddies.filter((e) => !e.spent).length, 2)
})

test('Afterparty at Lizzie’s: adjust a Gig; 2+ different values draws 1', () => {
	let s = table()
	eddies(s, 0, 1)
	gigs(s, 0, [[4, 3], [6, 3]])
	const a = hand(s, 0, 'afterparty-at-lizzie-s')
	s = act(s, { t: 'play', player: 0, uid: a }, ['0-g1-d6'], ['4'])
	assert.equal(s.players[0].hand.length, 1)
})

test('Floor It (Quick): −1 power on the attacker, draw 1', () => {
	let s = table()
	gigs(s, 0, [[4, 3]])
	eddies(s, 0, 1)
	const atk = unit(s, 1, 'swordwise-huscle')
	const blk = unit(s, 0, 'secondhand-bombus')
	void blk
	const fi = hand(s, 0, 'floor-it')
	s.active = 1
	s.pending = { kind: 'main', player: 1 }
	s = apply(s, { t: 'attack', player: 1, attacker: atk, target: { kind: 'gigs' } })
	s = apply(s, { t: 'play', player: 0, uid: fi }) // one rival Unit: targeted automatically
	assert.equal(unitPower(s, findUnit(s, atk)!), 2)
	assert.equal(s.players[0].hand.length, 1)
	assert.equal(P(s).kind, 'react')
})

test('Reboot Optics: the next rival Unit to fight doesn’t defeat ours', () => {
	let s = table()
	eddies(s, 0, 2)
	const mine = unit(s, 0, 'psycho-squad', { spent: true })
	const atk = unit(s, 1, 'minotaur')
	const ro = hand(s, 0, 'reboot-optics')
	s.active = 1
	s.pending = { kind: 'main', player: 1 }
	s = apply(s, { t: 'attack', player: 1, attacker: atk, target: { kind: 'unit', uid: mine } })
	s = apply(s, { t: 'play', player: 0, uid: ro })
	s = apply(s, { t: 'pass', player: 0 })
	assert.ok(findUnit(s, mine))
})

test('Viktor Vektor: on Call take up to 2 cheap Gears from the top 5', () => {
	let s = table()
	eddies(s, 0, 1)
	const pl = s.players[0]
	pl.legends = pl.legends.filter((l) => s.instances[l.uid].cardId === 'viktor-vektor-sit-down-and-relax')
	const g1 = card(s, 0, 'kiroshi-optics')
	const g2 = card(s, 0, 'zetatech-faceplate')
	const u1 = card(s, 0, 'psycho-squad')
	pl.deck.unshift(u1, g1, g2)
	const deckSize = pl.deck.length
	s = act(s, { t: 'callLegend', player: 0 }, [String(g1), String(g2)])
	assert.ok(s.players[0].hand.includes(g1) && s.players[0].hand.includes(g2))
	assert.equal(s.players[0].deck.length, deckSize - 2)
	assert.ok(s.players[0].deck.slice(-3).includes(u1))
})

test('Jackie Welles: first Blue Unit each turn lowers a friendly Gig; hitting 1 draws', () => {
	let s = table()
	legend(s, 0, 'jackie-welles-pour-one-out-for-me', true)
	eddies(s, 0, 8)
	gigs(s, 0, [[6, 3]])
	const c = hand(s, 0, 'delamain-cab')
	s = act(s, { t: 'play', player: 0, uid: c }, ['0-g0-d6'], ['1'])
	assert.equal(s.players[0].gigs[0].value, 1)
	assert.equal(s.players[0].hand.length, 1)
	const c2 = hand(s, 0, 'psycho-squad')
	s = apply(s, { t: 'play', player: 0, uid: c2 })
	assert.equal(P(s).kind, 'main') // once per turn
})

// ═════ Embracing Power ═════

function rivalTurn(s: GameState) {
	s.active = 1
	s.pending = { kind: 'main', player: 1 }
	return s
}

test('Saburo: ARASAKA Units +1 power while attacking', () => {
	let s = rivalTurn(table())
	legend(s, 1, 'saburo-arasaka-stubborn-patriarch', true)
	const m = unit(s, 1, 'minotaur')
	assert.equal(unitPower(s, findUnit(s, m)!), 9)
	gigs(s, 0, [[4, 1], [6, 1], [8, 1]])
	s = apply(s, { t: 'attack', player: 1, attacker: m, target: { kind: 'gigs' } })
	assert.equal(unitPower(s, findUnit(s, m)!), 10)
	s = apply(s, { t: 'pass', player: 0 })
	assert.equal(P(s).kind === 'steal' && P(s).kind === 'steal' && (P(s) as { remaining: number }).remaining, 2)
})

test('Yorinobu: first ARASAKA attack draws 1, discard 1 under 20 Street Cred', () => {
	let s = rivalTurn(table())
	legend(s, 1, 'yorinobu-arasaka-embracing-destruction', true)
	gigs(s, 1, [[20, 20]])
	const f = unit(s, 1, 'field-operator')
	s = apply(s, { t: 'attack', player: 1, attacker: f, target: { kind: 'gigs' } })
	assert.equal(s.players[1].hand.length, 1)
	assert.equal(P(s).kind, 'react')
})

test('Ruthless Lowlife can only attack Units; Corpo Security can’t attack', () => {
	let s = rivalTurn(table())
	const l = unit(s, 1, 'ruthless-lowlife')
	const c = unit(s, 1, 'corpo-security')
	assert.ok(tryApply(s, { t: 'attack', player: 1, attacker: l, target: { kind: 'gigs' } }).error)
	assert.ok(tryApply(s, { t: 'attack', player: 1, attacker: c, target: { kind: 'gigs' } }).error)
	const ok = legalIntents(s).filter((i) => i.t === 'attack')
	assert.equal(ok.length, 0)
})

test('Swordwise Huscle: draws when attacking with 5+ power', () => {
	let s = rivalTurn(table())
	const h = unit(s, 1, 'swordwise-huscle', { gear: ['mantis-blades'] })
	s = apply(s, { t: 'attack', player: 1, attacker: h, target: { kind: 'gigs' } })
	assert.equal(s.players[1].hand.length, 1)
})

test('Chrome Fang: rival can only steal Gigs worth no more than the attacker’s power', () => {
	let s = rivalTurn(table())
	eddies(s, 1, 5)
	gigs(s, 1, [[4, 1], [12, 11], [6, 3]])
	const cf = hand(s, 1, 'chrome-fang')
	s = apply(s, { t: 'play', player: 1, uid: cf })
	s = apply(s, { t: 'endTurn', player: 1 })
	s.pending = { kind: 'main', player: 0 }
	const v = unit(s, 0, 'heywood-ripperdoc') // 8 power: 1 Gig
	s = apply(s, { t: 'attack', player: 0, attacker: v, target: { kind: 'gigs' } })
	s = apply(s, { t: 'pass', player: 1 })
	assert.equal(P(s).kind, 'steal')
	assert.ok(tryApply(s, { t: 'steal', player: 0, dieId: '1-g1-d12' }).error)
	s = apply(s, { t: 'steal', player: 0, dieId: '1-g2-d6' })
	assert.equal(s.players[0].gigs.length, 1)
})

test('Minotaur: with more Street Cred, defeat a rival Unit with power 5 or less', () => {
	let s = rivalTurn(table())
	eddies(s, 1, 7)
	gigs(s, 1, [[8, 8]])
	gigs(s, 0, [[4, 2]])
	const small = unit(s, 0, 'dexter-deshawn-one-last-chance')
	unit(s, 0, 'heywood-ripperdoc')
	const m = hand(s, 1, 'minotaur')
	s = apply(s, { t: 'play', player: 1, uid: m }) // only one legal target: chosen automatically
	assert.equal(findUnit(s, small), undefined)
})

test('Field Operator: draws on even Street Cred only', () => {
	let s = rivalTurn(table())
	eddies(s, 1, 6)
	gigs(s, 1, [[4, 2]])
	s = apply(s, { t: 'play', player: 1, uid: hand(s, 1, 'field-operator') })
	assert.equal(s.players[1].hand.length, 1)
	gigs(s, 1, [[4, 3]])
	s = apply(s, { t: 'play', player: 1, uid: hand(s, 1, 'field-operator') })
	assert.equal(s.players[1].hand.length, 1)
})

test('Goro (Losing His Way): +5 when all Legends are face-up', () => {
	let s = rivalTurn(table())
	for (const l of s.players[1].legends) l.faceUp = true
	const g = unit(s, 1, 'goro-takemura-losing-his-way')
	s = apply(s, { t: 'attack', player: 1, attacker: g, target: { kind: 'gigs' } })
	assert.equal(unitPower(s, findUnit(s, g)!), 10) // 4 + 5, +1 from face-up Saburo
})

test('MaxTac AV: swap a friendly Gig with a rival Gig', () => {
	let s = rivalTurn(table())
	eddies(s, 1, 5)
	gigs(s, 1, [[4, 1]])
	gigs(s, 0, [[12, 11]])
	s = act(s, { t: 'play', player: 1, uid: hand(s, 1, 'maxtac-av') }, ['1-g0-d4'])
	assert.equal(s.players[1].gigs[0].value, 11)
	assert.equal(s.players[0].gigs[0].value, 1)
})

test('Radioport: host spent → look; Call it free if ARASAKA', () => {
	let s = rivalTurn(table())
	const u = unit(s, 1, 'emergency-atlus', { gear: ['arasaka-emergency-radioport'] })
	const saburo = s.players[1].legends.find((l) => s.instances[l.uid].cardId === 'saburo-arasaka-stubborn-patriarch')!.uid
	s = act(s, { t: 'attack', player: 1, attacker: u, target: { kind: 'gigs' } }, [String(saburo)], ['yes'])
	assert.equal(s.players[1].legends.find((l) => l.uid === saburo)!.faceUp, true)
	assert.equal(s.players[1].calledThisTurn, true)
})

test('Satori: win a fight → draw 1', () => {
	let s = rivalTurn(table())
	const a2 = unit(s, 1, 'emergency-atlus', { gear: ['satori-sword-of-saburo'] })
	const t2 = unit(s, 0, 'evelyn-parker-scheming-siren', { spent: true })
	s = apply(s, { t: 'attack', player: 1, attacker: a2, target: { kind: 'unit', uid: t2 } })
	s = apply(s, { t: 'pass', player: 0 })
	assert.equal(s.players[1].hand.length, 1)
})

test('Sandevistan: host readies at end of turn', () => {
	let s = rivalTurn(table())
	const a = unit(s, 1, 'emergency-atlus', { gear: ['sandevistan'] })
	s = apply(apply(s, { t: 'attack', player: 1, attacker: a, target: { kind: 'gigs' } }), { t: 'pass', player: 0 })
	s = apply(s, { t: 'endTurn', player: 1 })
	assert.equal(findUnit(s, a)!.spent, false) // ready to block on the rival's turn
})

test('Industrial Assembly: raise a Gig by up to 4; a Gig of 8+ draws 1', () => {
	let s = rivalTurn(table())
	eddies(s, 1, 1)
	gigs(s, 1, [[12, 5]])
	s = act(s, { t: 'play', player: 1, uid: hand(s, 1, 'industrial-assembly') }, ['1-g0-d12'], ['9'])
	assert.equal(s.players[1].gigs[0].value, 9)
	assert.equal(s.players[1].hand.length, 1)
})

test('Shattered Memories: both discard and draw 5; match a Gig to draw 2 more', () => {
	let s = rivalTurn(table())
	eddies(s, 1, 4)
	gigs(s, 1, [[4, 3]])
	hand(s, 1, 'minotaur')
	hand(s, 0, 'minotaur')
	hand(s, 0, 'minotaur')
	s = apply(s, { t: 'play', player: 1, uid: hand(s, 1, 'shattered-memories') })
	assert.equal(s.players[0].hand.length, 5)
	assert.equal(s.players[1].hand.length, 7)
})

test('Corporate Surveillance: spend a rival Unit costing 4 or less', () => {
	let s = rivalTurn(table())
	eddies(s, 1, 2)
	const cheap = unit(s, 0, 'delamain-cab')
	unit(s, 0, 'heywood-ripperdoc')
	s = apply(s, { t: 'play', player: 1, uid: hand(s, 1, 'corporate-surveillance') })
	assert.equal(findUnit(s, cheap)!.spent, true)
})

// ═════ whole games ═════

test('starter decks are legal 40-card decks', () => {
	for (const id of ['heist', 'power'] as const) assert.deepEqual(validateDeck(CARDS, starterDeck(id)), [])
})

test('starter decks: bot-vs-bot games finish and every question gets answered', () => {
	for (let seed = 1; seed <= 25; seed++) {
		const power = starterDeck('power')
			let s = newGame({ seed, cards: CARDS, decks: [starterDeck('heist'), power] })
		let n = 0
		while (s.pending.kind !== 'over' && n++ < 3000) {
			const i = chooseIntent(s)!
			s = apply(s, i)
		}
		assert.equal(s.pending.kind, 'over', `seed ${seed} did not finish`)
	}
	void streetCred
})
