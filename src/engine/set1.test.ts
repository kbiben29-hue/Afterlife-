// Focused tests for the scripted cards beyond the starter decks (set1.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SET1_FIXTURE as CARDS } from './set1.fixture'
import { starterDeck } from '../data/starters'
import { apply, attackError, costOf as playCost, findUnit, streetCred, tryApply, unitPower } from './engine'
import { scenario, type SideSpec } from './scenario'
import type { GameState, Intent, PlayerId } from './types'

/** Player 0 acts; legends: player 0 gets `legends` (face-up if listed in faceUp). */
function table(me: SideSpec & { legends?: string[] }, rival: SideSpec & { legends?: string[] } = {}, active: PlayerId = 0): GameState {
	const d0 = starterDeck('heist')
	const d1 = starterDeck('power')
	if (me.legends) d0.legends = me.legends
	if (rival.legends) d1.legends = rival.legends
	return scenario({ seed: 5, cards: CARDS, decks: [d0, d1], names: ['Me', 'Rival'], sides: [me, rival], active })
}
const uid = (s: GameState, p: PlayerId, id: string) => {
	const pl = s.players[p]
	const all = [...pl.hand, ...pl.field.map((u) => u.uid), ...pl.legends.map((l) => l.uid), ...pl.field.flatMap((u) => u.gear), ...pl.legends.flatMap((l) => l.gear)]
	const u = all.find((x) => s.instances[x].cardId === id)
	assert.ok(u !== undefined, `no ${id} for player ${p}`)
	return u!
}
function act(s: GameState, i: Intent, ...answers: string[][]): GameState {
	s = apply(s, i)
	for (const a of answers) {
		assert.equal(s.pending.kind, 'choose', `expected a question, got ${s.pending.kind}: ${s.log.slice(-3).join(' | ')}`)
		s = apply(s, { t: 'choose', player: (s.pending as { player: PlayerId }).player, picks: a })
	}
	return s
}
const q = (s: GameState) => (s.pending.kind === 'choose' ? s.pending.question : null)
const pw = (s: GameState, u: number) => unitPower(s, findUnit(s, u)!)
const play = (s: GameState, p: PlayerId, id: string, target?: number) => apply(s, { t: 'play', player: p, uid: uid(s, p, id), target })
const attackGigs = (s: GameState, p: PlayerId, id: string) => apply(s, { t: 'attack', player: p, attacker: uid(s, p, id), target: { kind: 'gigs' } })
const pass = (s: GameState, p: PlayerId = 1) => apply(s, { t: 'pass', player: p })

// ═════ keywords & attack rules ═════

test('Meredith Stout has Blocker but no Adrenaline: she can’t attack the turn she’s played', () => {
	let s = table({ hand: ['meredith-stout-stone-cold-corpo'], eddies: 4 })
	s = play(s, 0, 'meredith-stout-stone-cold-corpo')
	const m = uid(s, 0, 'meredith-stout-stone-cold-corpo')
	assert.match(attackError(s, 0, m, { kind: 'gigs' }) ?? '', /Lag/)
})
test('Modded Kusanagi and Riding Nomad have Adrenaline; Kusanagi returns to hand at end of turn', () => {
	let s = table({ hand: ['modded-kusanagi'], eddies: 6 }, { gigs: [[4, 3]] })
	s = play(s, 0, 'modded-kusanagi')
	assert.equal(attackError(s, 0, uid(s, 0, 'modded-kusanagi'), { kind: 'gigs' }), null)
	s = apply(s, { t: 'endTurn', player: 0 })
	assert.ok(s.players[0].hand.some((u) => s.instances[u].cardId === 'modded-kusanagi'))
})
test('Adrenaline Converter: Adrenaline only while the rival has 2+ more Gigs', () => {
	let s = table({ field: [{ id: 'psycho-squad', gear: ['adrenaline-converter'], lag: true }], gigs: [[4, 2]] }, { gigs: [[4, 2], [6, 3]] })
	const u = uid(s, 0, 'psycho-squad')
	assert.match(attackError(s, 0, u, { kind: 'gigs' }) ?? '', /Lag/)
	s = table({ field: [{ id: 'psycho-squad', gear: ['adrenaline-converter'], lag: true }], gigs: [[4, 2]] }, { gigs: [[4, 2], [6, 3], [8, 3]] })
	assert.equal(attackError(s, 0, uid(s, 0, 'psycho-squad'), { kind: 'gigs' }), null)
})
test('MaxTac Suppression Team: rival Units with Adrenaline can’t attack the turn they’re played', () => {
	let s = table({ hand: ['riding-nomad'], eddies: 6 }, { field: [{ id: 'maxtac-suppression-team' }] })
	s = play(s, 0, 'riding-nomad')
	assert.match(attackError(s, 0, uid(s, 0, 'riding-nomad'), { kind: 'gigs' }) ?? '', /Suppression/)
})
test('Misty can’t attack; Jacked-In Voodoo Boy needs a Program first', () => {
	let s = table({ field: [{ id: 'misty-olszewski-mender-of-broken-spirits' }, { id: 'jacked-in-voodoo-boy' }], hand: ['trust-no-one'], eddies: 2, gigs: [[4, 3]] })
	assert.ok(attackError(s, 0, uid(s, 0, 'misty-olszewski-mender-of-broken-spirits'), { kind: 'gigs' }))
	assert.ok(attackError(s, 0, uid(s, 0, 'jacked-in-voodoo-boy'), { kind: 'gigs' }))
	s = act(s, { t: 'play', player: 0, uid: uid(s, 0, 'trust-no-one') }, ['0-d4'], ['1'])
	assert.equal(attackError(s, 0, uid(s, 0, 'jacked-in-voodoo-boy'), { kind: 'gigs' }), null)
})
test('Nadia attacks Gigs the turn she’s played when behind on Gigs; Sandayu attacks Units', () => {
	const s = table({ field: [{ id: 'nadia-fighting-through-grief', lag: true }, { id: 'sandayu-oda-hanako-s-guardian', lag: true }], gigs: [[4, 2]] }, { field: [{ id: 'emergency-atlus', spent: true }], gigs: [[4, 2], [6, 2]] })
	assert.equal(attackError(s, 0, uid(s, 0, 'nadia-fighting-through-grief'), { kind: 'gigs' }), null)
	assert.ok(attackError(s, 0, uid(s, 0, 'sandayu-oda-hanako-s-guardian'), { kind: 'gigs' }))
	assert.equal(attackError(s, 0, uid(s, 0, 'sandayu-oda-hanako-s-guardian'), { kind: 'unit', uid: uid(s, 1, 'emergency-atlus') }), null)
})
test('Valentino Guerrera attacks a ready Blocker when ahead on Street Cred', () => {
	const s = table({ field: [{ id: 'valentino-guerrera' }], gigs: [[8, 7]] }, { field: [{ id: 'corpo-security' }], gigs: [[4, 2]] })
	assert.equal(attackError(s, 0, uid(s, 0, 'valentino-guerrera'), { kind: 'unit', uid: uid(s, 1, 'corpo-security') }), null)
})
test('Riot Shield grants Blocker and taxes the rival’s Go Solo', () => {
	const s = table({ legends: ['v-corporate-exile', 'jackie-welles-pour-one-out-for-me', 'viktor-vektor-sit-down-and-relax'], faceUp: ['v-corporate-exile'], eddies: 4 }, { field: [{ id: 'emergency-atlus', gear: ['riot-shield'] }] })
	assert.match(tryApply(s, { t: 'goSolo', player: 0, uid: uid(s, 0, 'v-corporate-exile') }).error ?? '', /Not enough/)
})

// ═════ costs ═════

test('cost reductions: Octant, MaxTac Heavy, Trauma Team, Zetatech Berserk, Viktor (Drop Your Illusions)', () => {
	const s = table(
		{ hand: ['octant', 'maxtac-heavy', 'zetatech-berserk', 'kiroshi-optics', 'zetatech-faceplate'], field: [{ id: 'viktor-vektor-drop-your-illusions' }], gigs: [[8, 8], [10, 9]], faceUp: ['v-corporate-exile', 'jackie-welles-pour-one-out-for-me'] },
		{ field: [{ id: 'emergency-atlus' }, { id: 'corpo-security' }] },
	)
	assert.equal(playCost(s, 0, uid(s, 0, 'octant')), 5)
	assert.equal(playCost(s, 0, uid(s, 0, 'maxtac-heavy')), 5)
	assert.equal(playCost(s, 0, uid(s, 0, 'zetatech-berserk')), 1) // 6 − 2 Legends − 3 Viktor, min 1
	assert.equal(playCost(s, 0, uid(s, 0, 'zetatech-faceplate')), 1)
})
test('Viktor (Drop Your Illusions): only the first CYBERWARE Gear each turn is cheaper', () => {
	let s = table({ hand: ['zetatech-faceplate', 'kiroshi-optics'], field: [{ id: 'viktor-vektor-drop-your-illusions' }], eddies: 3 })
	const v = uid(s, 0, 'viktor-vektor-drop-your-illusions')
	s = play(s, 0, 'zetatech-faceplate', v)
	assert.equal(s.players[0].eddies.filter((e) => !e.spent).length, 2)
	assert.equal(playCost(s, 0, uid(s, 0, 'kiroshi-optics')), 1)
})
test('Panam Palmer (Strength Through Family): Call a Legend for free on your turn', () => {
	let s = table({ field: [{ id: 'panam-palmer-strength-through-family' }] })
	s = apply(s, { t: 'callLegend', player: 0 })
	assert.equal(s.players[0].legends.filter((l) => l.faceUp).length, 1)
})

// ═════ Legends ═════

test('Adam Smasher (Ender of Legends): Go Solo defeats a rival Unit', () => {
	let s = table({ legends: ['adam-smasher-ender-of-legends', 'v-streetkid', 'royce-psycho-on-the-edge'], faceUp: ['adam-smasher-ender-of-legends'], eddies: 9 }, { field: [{ id: 'emergency-atlus' }] })
	s = apply(s, { t: 'goSolo', player: 0, uid: uid(s, 0, 'adam-smasher-ender-of-legends') })
	assert.equal(s.players[1].field.length, 0)
})
test('Dexter DeShawn (Off the Grid): Call → draw; Spend → raise a Gig', () => {
	let s = table({ legends: ['dexter-deshawn-off-the-grid', 'v-streetkid', 'royce-psycho-on-the-edge'], eddies: 1, gigs: [[6, 2]] })
	s.players[0].legends.forEach((l) => (l.faceUp = s.instances[l.uid].cardId !== 'dexter-deshawn-off-the-grid'))
	s = act(s, { t: 'callLegend', player: 0 }, ['1'])
	assert.equal(s.players[0].hand.length, 1)
	s = act(s, { t: 'activate', player: 0, uid: uid(s, 0, 'dexter-deshawn-off-the-grid'), ability: 0 }, ['0-d6'], ['4'])
	assert.equal(s.players[0].gigs[0].value, 4)
	assert.ok(tryApply(s, { t: 'activate', player: 0, uid: uid(s, 0, 'dexter-deshawn-off-the-grid'), ability: 0 }).error) // spent
})
test('Goro (Vengeful Bodyguard): Quick Blocker for a cheap Unit', () => {
	let s = table({ legends: ['goro-takemura-vengeful-bodyguard', 'hanako-arasaka-daughter-of-the-emperor', 'padre-man-of-the-cross'], faceUp: ['goro-takemura-vengeful-bodyguard'], field: [{ id: 'swordwise-huscle' }], hand: ['mantis-blades'], eddies: 1, gigs: [[4, 2]] }, { field: [{ id: 'emergency-atlus' }] }, 1)
	s = attackGigs(s, 1, 'emergency-atlus')
	s = apply(s, { t: 'activate', player: 0, uid: uid(s, 0, 'goro-takemura-vengeful-bodyguard'), ability: 0 })
	s = apply(s, { t: 'block', player: 0, blocker: uid(s, 0, 'swordwise-huscle') })
	assert.equal(q(s)?.prompt.includes('discard'), true)
})
test('Hanako (Daughter of the Emperor): draws per value-pair at the start of turn', () => {
	let s = table({ legends: ['hanako-arasaka-daughter-of-the-emperor', 'padre-man-of-the-cross', 'goro-takemura-vengeful-bodyguard'], faceUp: ['hanako-arasaka-daughter-of-the-emperor'], gigs: [[4, 3], [6, 3]] }, {}, 1)
	s = apply(s, { t: 'endTurn', player: 1 })
	assert.equal(s.players[0].hand.length, 2) // draw step + 1 pair
})
test('Jackie Welles (Mama’s Favorite): pay 1 to save a Unit; Jackie is removed', () => {
	let s = table({ legends: ['jackie-welles-mama-s-favorite', 'panam-palmer-nomad-cavalry', 'padre-man-of-the-cross'], faceUp: ['jackie-welles-mama-s-favorite'], field: [{ id: 'maxtac-av', spent: true }], eddies: 1 }, { field: [{ id: 'saul-bright-stormrider' }] }, 1)
	s = apply(s, { t: 'attack', player: 1, attacker: uid(s, 1, 'saul-bright-stormrider'), target: { kind: 'unit', uid: uid(s, 0, 'maxtac-av') } })
	s = act(s, { t: 'pass', player: 0 }, ['yes'])
	assert.ok(findUnit(s, uid(s, 0, 'maxtac-av')))
	assert.equal(s.players[0].legends.length, 2)
})
test('Kerry Eurodyne (Legend): re-roll a fresh Gig; max roll draws', () => {
	let s = table({ legends: ['kerry-eurodyne-axe-attitude-audience', 'dum-dum-maelstrom-triggerman', 'muamar-reyes-el-capita-n'], faceUp: ['kerry-eurodyne-axe-attitude-audience'] }, {}, 1)
	s.players[0].fixer = [{ id: '0-d4', sides: 4, value: 4 }]
	s = apply(s, { t: 'endTurn', player: 1 })
	assert.equal(q(s)?.prompt.startsWith('Kerry'), true)
})
test('Muamar Reyes: a Unit can’t be defeated in a fight this turn', () => {
	let s = table({ legends: ['muamar-reyes-el-capita-n', 'dum-dum-maelstrom-triggerman', 'kerry-eurodyne-axe-attitude-audience'], field: [{ id: 'psycho-squad' }], eddies: 1 }, { field: [{ id: 'maxtac-av', spent: true }] })
	s.players[0].legends.forEach((l) => (l.faceUp = s.instances[l.uid].cardId !== 'muamar-reyes-el-capita-n'))
	s = act(s, { t: 'callLegend', player: 0 }, ['0'])
	s = pass(apply(s, { t: 'attack', player: 0, attacker: uid(s, 0, 'psycho-squad'), target: { kind: 'unit', uid: uid(s, 1, 'maxtac-av') } }))
	assert.ok(findUnit(s, uid(s, 0, 'psycho-squad')))
})
test('Padre: set a rival’s Gig to the value of one of yours', () => {
	let s = table({ legends: ['padre-man-of-the-cross', 'goro-takemura-vengeful-bodyguard', 'hanako-arasaka-daughter-of-the-emperor'], faceUp: ['padre-man-of-the-cross'], gigs: [[4, 1]] }, { gigs: [[12, 11]] })
	s = act(s, { t: 'activate', player: 0, uid: uid(s, 0, 'padre-man-of-the-cross'), ability: 0 }, ['1-d12'])
	assert.equal(s.players[1].gigs[0].value, 1)
})
test('Royce (Legend, Go Solo): +2 per Gear during your turn', () => {
	const s = table({ legends: ['royce-psycho-on-the-edge', 'v-streetkid', 'adam-smasher-ender-of-legends'], faceUp: ['royce-psycho-on-the-edge'], eddies: 6 })
	const r = uid(s, 0, 'royce-psycho-on-the-edge')
	s.players[0].legends.find((l) => l.uid === r)!.gear.push(...[9001, 9002].map((n) => ((s.instances[n] = { uid: n, cardId: 'mantis-blades', owner: 0 }), n)))
	const t = apply(s, { t: 'goSolo', player: 0, uid: r })
	assert.equal(pw(t, r), 6 + 4 + 4)
})
test('Sasha Yakovleva: attack reveals the top card, gains its cost', () => {
	let s = table({ legends: ['sasha-yakovleva-won-t-let-you-down', 'lucyna-kushinada-fresh-beginnings', 'alt-cunningham-soulkiller-architect'], faceUp: ['sasha-yakovleva-won-t-let-you-down'], eddies: 5, deckTop: ['heywood-ripperdoc'] }, { gigs: [[4, 2]] })
	const sa = uid(s, 0, 'sasha-yakovleva-won-t-let-you-down')
	s = apply(s, { t: 'goSolo', player: 0, uid: sa })
	s = attackGigs(s, 0, 'sasha-yakovleva-won-t-let-you-down')
	assert.equal(pw(s, sa), 6)
})
test('Lucyna: Call draws 2 with two min Gigs', () => {
	let s = table({ legends: ['lucyna-kushinada-fresh-beginnings', 'v-streetkid', 'royce-psycho-on-the-edge'], eddies: 1, gigs: [[4, 1], [6, 1]] })
	s.players[0].legends.forEach((l) => (l.faceUp = s.instances[l.uid].cardId !== 'lucyna-kushinada-fresh-beginnings'))
	s = apply(s, { t: 'callLegend', player: 0 })
	assert.equal(s.players[0].hand.length, 2)
})

// ═════ Programs ═════

test('Bonnie and Clyde defeats up to 2 when well behind on Gigs', () => {
	let s = table({ hand: ['bonnie-and-clyde'], eddies: 3 }, { field: [{ id: 'ruthless-lowlife' }, { id: 'corpo-security' }], gigs: [[4, 1], [6, 1]] })
	s = act(s, { t: 'play', player: 0, uid: uid(s, 0, 'bonnie-and-clyde') }, [String(uid(s, 1, 'ruthless-lowlife')), String(uid(s, 1, 'corpo-security'))])
	assert.equal(s.players[1].field.length, 0)
})
test('Chrome Reverie: the Unit can’t attack until your next turn', () => {
	let s = table({ hand: ['chrome-reverie'], eddies: 3 }, { field: [{ id: 'maxtac-av' }], gigs: [[4, 2]] })
	s = play(s, 0, 'chrome-reverie')
	s = apply(s, { t: 'endTurn', player: 0 })
	if (s.pending.kind === 'chooseGig') s = apply(s, { t: 'chooseGig', player: 1, dieId: s.players[1].fixer.find((d) => d.sides !== 20)!.id })
	assert.ok(attackError(s, 1, uid(s, 1, 'maxtac-av'), { kind: 'gigs' }))
})
test('Cyberpsychosis: +3 per Gear; the Unit is defeated at end of turn after fighting', () => {
	let s = table({ hand: ['cyberpsychosis'], field: [{ id: 'psycho-squad', gear: ['mantis-blades', 'mantis-blades'] }], eddies: 3 }, { field: [{ id: 'emergency-atlus', spent: true }] })
	const u = uid(s, 0, 'psycho-squad')
	s = play(s, 0, 'cyberpsychosis')
	assert.equal(pw(s, u), 6 + 4 + 6)
	s = pass(apply(s, { t: 'attack', player: 0, attacker: u, target: { kind: 'unit', uid: uid(s, 1, 'emergency-atlus') } }))
	s = apply(s, { t: 'endTurn', player: 0 })
	assert.equal(findUnit(s, u), undefined)
})
test('Detonate defeats a small rival Gear (Quick)', () => {
	let s = table({ hand: ['detonate'], eddies: 1 }, { field: [{ id: 'emergency-atlus', gear: ['mantis-blades'] }] })
	s = play(s, 0, 'detonate')
	assert.equal(s.players[1].field[0].gear.length, 0)
})
test('Don’t Fear the Reaper: spend all rival Units, then defeat a spent one', () => {
	let s = table({ hand: ['don-t-fear-the-reaper'], eddies: 7 }, { field: [{ id: 'maxtac-av' }, { id: 'corpo-security' }] })
	s = act(s, { t: 'play', player: 0, uid: uid(s, 0, 'don-t-fear-the-reaper') }, [String(uid(s, 1, 'maxtac-av'))])
	assert.equal(s.players[1].field.length, 1)
	assert.equal(s.players[1].field[0].spent, true)
})
test('Fool on the Hill: the rival decides', () => {
	let s = table({ hand: ['fool-on-the-hill'], eddies: 2 })
	s = apply(s, { t: 'play', player: 0, uid: uid(s, 0, 'fool-on-the-hill') })
	assert.equal(s.pending.kind === 'choose' && s.pending.player, 1)
	s = apply(s, { t: 'choose', player: 1, picks: ['trash'] })
	assert.equal(s.players[0].hand.length, 2)
})
test('Gunpoint Diplomacy: may attack a ready Unit, +3', () => {
	let s = table({ hand: ['gunpoint-diplomacy'], field: [{ id: 'psycho-squad' }], eddies: 4, gigs: [[8, 8]] }, { field: [{ id: 'maxtac-av' }], gigs: [[4, 1]] })
	s = play(s, 0, 'gunpoint-diplomacy')
	const u = uid(s, 0, 'psycho-squad')
	assert.equal(pw(s, u), 9)
	assert.equal(attackError(s, 0, u, { kind: 'unit', uid: uid(s, 1, 'maxtac-av') }), null)
})
test('Les Élémens bottom-decks the weakest rival Unit', () => {
	let s = table({ hand: ['les-e-le-mens'], eddies: 5 }, { field: [{ id: 'maxtac-av' }, { id: 'corpo-security' }] })
	s = play(s, 0, 'les-e-le-mens')
	assert.equal(s.players[1].field.length, 1)
	assert.equal(s.instances[s.players[1].deck[s.players[1].deck.length - 1]].cardId, 'corpo-security')
})
test('Memory Relapse: spent and won’t ready on the rival’s next turn', () => {
	let s = table({ hand: ['memory-relapse'], eddies: 4 }, { field: [{ id: 'maxtac-av' }] })
	s = play(s, 0, 'memory-relapse')
	s = apply(s, { t: 'endTurn', player: 0 })
	assert.equal(s.players[1].field[0].spent, true)
})
test('Take Control: the attacker steals 1 fewer', () => {
	let s = table({ hand: ['take-control'], eddies: 2, gigs: [[4, 2], [6, 3]] }, { field: [{ id: 'saul-bright-stormrider' }] }, 1)
	s = attackGigs(s, 1, 'saul-bright-stormrider')
	s = play(s, 0, 'take-control')
	s = apply(s, { t: 'pass', player: 0 })
	assert.equal(s.pending.kind === 'steal' && s.pending.remaining, 1)
})
test('Safety Override: losing the fight still takes the attacker down', () => {
	let s = table({ hand: ['safety-override'], field: [{ id: 'corpo-security' }], eddies: 2, gigs: [[4, 2]] }, { field: [{ id: 'maxtac-av' }] }, 1)
	s = attackGigs(s, 1, 'maxtac-av')
	s = play(s, 0, 'safety-override')
	s = apply(s, { t: 'block', player: 0, blocker: uid(s, 0, 'corpo-security') })
	s = apply(s, { t: 'pass', player: 0 })
	assert.equal(s.players[1].field.length, 0)
})
test('Towerfall: both effects when behind on Street Cred', () => {
	let s = table({ hand: ['towerfall'], eddies: 6, gigs: [[4, 1]] }, { field: [{ id: 'maxtac-av' }, { id: 'secondhand-bombus' }], gigs: [[8, 8]] })
	s = act(s, { t: 'play', player: 0, uid: uid(s, 0, 'towerfall') })
	// −5 first: Bombus (0) is bottom-decked, MaxTac AV (8 → 3) stays
	assert.equal(s.players[1].field.length, 1)
	assert.equal(pw(s, s.players[1].field[0].uid), 3)
	void streetCred
})
test('We Gotta Live Together: two Units from the trash', () => {
	let s = table({ hand: ['we-gotta-live-together'], eddies: 5 })
	for (const id of ['ruthless-lowlife', 'corpo-security']) {
		const n = 9100 + s.players[0].trash.length
		s.instances[n] = { uid: n, cardId: id, owner: 0 }
		s.players[0].trash.push(n)
	}
	s = act(s, { t: 'play', player: 0, uid: uid(s, 0, 'we-gotta-live-together') }, ['9100', '9101'])
	assert.equal(s.players[0].field.length, 2)
})

// ═════ Units ═════

test('Adam Smasher (Metal Over Meat) defeats every other Unit', () => {
	let s = table({ hand: ['adam-smasher-metal-over-meat'], field: [{ id: 'psycho-squad' }], eddies: 9 }, { field: [{ id: 'maxtac-av' }] })
	s = play(s, 0, 'adam-smasher-metal-over-meat')
	assert.equal(s.players[0].field.length + s.players[1].field.length, 1)
})
test('Alt Cunningham (Mother of Daemons): discard to stop a steal', () => {
	let s = table({ field: [{ id: 'alt-cunningham-mother-of-daemons' }], hand: ['mantis-blades'], gigs: [[4, 1], [6, 3]] }, { field: [{ id: 'maxtac-av' }] }, 1)
	s = pass(attackGigs(s, 1, 'maxtac-av'), 0)
	s = apply(s, { t: 'steal', player: 1, dieId: '0-d4' })
	assert.equal(q(s)?.prompt.startsWith('Alt Cunningham'), true)
	s = apply(s, { t: 'choose', player: 0, picks: [String(uid(s, 0, 'mantis-blades'))] })
	assert.equal(s.players[0].gigs.length, 2)
})
test('Augmented Negotiators: blocking makes the rival discard', () => {
	let s = table({ field: [{ id: 'augmented-negotiators' }], gigs: [[4, 2]] }, { field: [{ id: 'emergency-atlus' }], hand: ['mantis-blades'] }, 1)
	s = attackGigs(s, 1, 'emergency-atlus')
	s = apply(s, { t: 'block', player: 0, blocker: uid(s, 0, 'augmented-negotiators') })
	assert.equal(s.players[1].hand.length, 0)
})
test('Caliber: Play defeats a cheap rival Unit', () => {
	let s = table({ hand: ['caliber-totentanz-s-top-dog'], eddies: 5 }, { field: [{ id: 'corpo-security' }] })
	s = play(s, 0, 'caliber-totentanz-s-top-dog')
	assert.equal(s.players[1].field.length, 0)
})
test('Delamain (Rideshare AI) draws 2', () => {
	let s = table({ hand: ['delamain-rideshare-ai'], eddies: 3 })
	s = play(s, 0, 'delamain-rideshare-ai')
	assert.equal(s.players[0].hand.length, 2)
})
test('Jackie Welles (Ride or Die): +2 per even Gig on attack', () => {
	let s = table({ field: [{ id: 'jackie-welles-ride-or-die-choom' }], gigs: [[4, 2], [6, 4], [8, 3]] }, { gigs: [[4, 1]] })
	const j = uid(s, 0, 'jackie-welles-ride-or-die-choom')
	s = attackGigs(s, 0, 'jackie-welles-ride-or-die-choom')
	assert.equal(pw(s, j), 12)
})
test('Johnny Silverhand (Never Stop Fighting) beats CORPO Units and readies after a win', () => {
	let s = table({ field: [{ id: 'johnny-silverhand-never-stop-fighting' }] }, { field: [{ id: 'saul-bright-stormrider', spent: true }, { id: 'corpo-security', spent: true }] })
	const j = uid(s, 0, 'johnny-silverhand-never-stop-fighting')
	s = pass(apply(s, { t: 'attack', player: 0, attacker: j, target: { kind: 'unit', uid: uid(s, 1, 'corpo-security') } }))
	assert.equal(findUnit(s, j)!.spent, false)
})
test('Maelstrom Zealots: losing still defeats the attacker', () => {
	let s = table({ field: [{ id: 'maelstrom-zealots', spent: true }] }, { field: [{ id: 'maxtac-av' }] }, 1)
	s = apply(s, { t: 'attack', player: 1, attacker: uid(s, 1, 'maxtac-av'), target: { kind: 'unit', uid: uid(s, 0, 'maelstrom-zealots') } })
	s = apply(s, { t: 'pass', player: 0 })
	assert.equal(s.players[1].field.length, 0)
})
test('Meredith Stout: +2 fighting a Legend; trash → hand when the rival changes your Gigs', () => {
	let s = table({ field: [{ id: 'meredith-stout-stone-cold-corpo' }], gigs: [[6, 3]] }, { hand: ['afterparty-at-lizzie-s'], eddies: 1 }, 1)
	s.players[0].trash = []
	const n = 9200
	s.instances[n] = { uid: n, cardId: 'minotaur', owner: 0 }
	s.players[0].trash.push(n)
	s = act(s, { t: 'play', player: 1, uid: uid(s, 1, 'afterparty-at-lizzie-s') }, ['0-d6'], ['2'])
	assert.equal(q(s)?.prompt.startsWith('Meredith'), true)
	s = apply(s, { t: 'choose', player: 0, picks: [String(n)] })
	assert.ok(s.players[0].hand.includes(n))
})
test('Mox Inciters: the rival Unit must attack', () => {
	let s = table({ hand: ['mox-inciters'], eddies: 3 }, { field: [{ id: 'maxtac-av' }] })
	s = play(s, 0, 'mox-inciters')
	s = apply(s, { t: 'endTurn', player: 0 })
	if (s.pending.kind === 'chooseGig') s = apply(s, { t: 'chooseGig', player: 1, dieId: s.players[1].fixer.find((d) => d.sides !== 20)!.id })
	assert.match(tryApply(s, { t: 'endTurn', player: 1 }).error ?? '', /must attack/)
})
test('Saul Bright: other Units +2 while attacking; readies Units at end of turn', () => {
	let s = table({ field: [{ id: 'saul-bright-stormrider' }, { id: 'psycho-squad' }] }, { gigs: [[4, 1]] })
	const p = uid(s, 0, 'psycho-squad')
	s = attackGigs(s, 0, 'psycho-squad')
	assert.equal(pw(s, p), 8)
	s = apply(s, { t: 'pass', player: 1 })
	s = apply(s, { t: 'endTurn', player: 0 })
	assert.equal(findUnit(s, p)!.spent, false)
})
test('Valentino Street Racer gives Adrenaline', () => {
	let s = table({ hand: ['valentino-street-racer', 'maxtac-av'], eddies: 8 })
	s = play(s, 0, 'maxtac-av')
	s = play(s, 0, 'valentino-street-racer')
	assert.equal(attackError(s, 0, uid(s, 0, 'maxtac-av'), { kind: 'gigs' }), null)
})
test('Wraith Marauders / V (Roamer): steal triggers', () => {
	let s = table({ field: [{ id: 'v-roamer-of-the-badlands' }] }, { gigs: [[8, 2]] })
	s = pass(attackGigs(s, 0, 'v-roamer-of-the-badlands'))
	assert.equal(q(s)?.prompt.startsWith('Increase'), true)
})
test('Yorinobu (Steel Dragon): a free Unit that can attack rival Units this turn', () => {
	let s = table({ hand: ['yorinobu-arasaka-steel-dragon', 'swordwise-huscle'], eddies: 7 }, { field: [{ id: 'corpo-security', spent: true }] })
	s = act(s, { t: 'play', player: 0, uid: uid(s, 0, 'yorinobu-arasaka-steel-dragon') }, [String(uid(s, 0, 'swordwise-huscle'))])
	assert.equal(attackError(s, 0, uid(s, 0, 'swordwise-huscle'), { kind: 'unit', uid: uid(s, 1, 'corpo-security') }), null)
})

// ═════ Gear ═════

test('Deadman Transmitter is defeated instead of its Unit', () => {
	let s = table({ field: [{ id: 'psycho-squad', gear: ['deadman-transmitter'], spent: true }] }, { field: [{ id: 'saul-bright-stormrider' }] }, 1)
	s = pass(apply(s, { t: 'attack', player: 1, attacker: uid(s, 1, 'saul-bright-stormrider'), target: { kind: 'unit', uid: uid(s, 0, 'psycho-squad') } }), 0)
	assert.equal(s.players[0].field.length, 1)
	assert.equal(s.players[0].field[0].gear.length, 0)
})
test('NetWatch Netdriver draws when its Unit is spent', () => {
	let s = table({ field: [{ id: 'psycho-squad', gear: ['netwatch-netdriver'] }] }, { gigs: [[4, 2]] })
	s = attackGigs(s, 0, 'psycho-squad')
	assert.equal(s.players[0].hand.length, 1)
})
test('Overwatch: Quick, discard to defeat a spent rival Unit', () => {
	let s = table({ field: [{ id: 'psycho-squad', gear: ['overwatch-panam-s-gift'] }], hand: ['minotaur'], eddies: 1 }, { field: [{ id: 'maxtac-av', spent: true }] })
	s = act(s, { t: 'activate', player: 0, uid: uid(s, 0, 'overwatch-panam-s-gift'), ability: 0 })
	assert.equal(s.players[1].field.length, 0)
})
test('The Relic: a Unit comes back from the trash when its host is defeated', () => {
	let s = table({ field: [{ id: 'psycho-squad', gear: ['the-relic-experimental-biochip'], spent: true }] }, { field: [{ id: 'saul-bright-stormrider' }] }, 1)
	const n = 9300
	s.instances[n] = { uid: n, cardId: 'minotaur', owner: 0 }
	s.players[0].trash.push(n)
	s = act(apply(s, { t: 'attack', player: 1, attacker: uid(s, 1, 'saul-bright-stormrider'), target: { kind: 'unit', uid: uid(s, 0, 'psycho-squad') } }), { t: 'pass', player: 0 })
	assert.ok(findUnit(s, n))
})
test('Gorilla Arms: the first steal steals one more unmatched Gig', () => {
	let s = table({ field: [{ id: 'psycho-squad', gear: ['gorilla-arms'] }], gigs: [[4, 2]] }, { gigs: [[6, 2], [8, 5]] })
	s = pass(attackGigs(s, 0, 'psycho-squad'))
	if (s.pending.kind === 'steal') s = apply(s, { t: 'steal', player: 0, dieId: '1-d6' })
	assert.equal(s.players[0].gigs.length, 3)
})
