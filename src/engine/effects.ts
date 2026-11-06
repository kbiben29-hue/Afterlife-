// Card abilities. Each ability is a small script keyed by `${cardId}:${trigger}`. Scripts run
// inside a Task; when one needs a decision it calls `c.ask(...)`. If that question has no answer
// yet, the task stops (nothing it did is kept), the player is asked, and the task re-runs from
// the start with the recorded answers. Engine state is deterministic, so re-runs replay exactly.
//
// Scripted so far: every card in the two Welcome to Night City starter decks (The Heist,
// Embracing Power). Other cards keep working by hand with the table tools.

import {
	def,
	defeatUnit,
	drawCards,
	findUnit,
	freeCallLegend,
	nameOf,
	overtimeCheckPublic,
	ownerOf,
	spendCard,
	streetCred,
	unitPower,
} from './engine'
import { Rng } from './rng'
import { other, type ChoiceOption, type Die, type GameState, type PlayerId, type Question, type Task } from './types'

export class NeedChoice {
	constructor(
		public player: PlayerId,
		public question: Question,
	) {}
}

export interface Ctx {
	s: GameState
	owner: PlayerId
	rival: PlayerId
	source: number
	data: Record<string, unknown>
	/** ask a player; returns the picked option ids */
	ask(player: PlayerId, q: Question): string[]
	log(line: string): void
}

type Handler = (c: Ctx) => void

// ───────── helpers used by card scripts ─────────

const tag = (s: GameState, uid: number, t: string) => def(s, uid).tags.some((x) => x.toLowerCase() === t.toLowerCase())
const credOf = (s: GameState, p: PlayerId) => streetCred(s.players[p])
/** Null Street Cred (no Gigs) counts as smaller than any number (CR 5.11.4.2). */
export const credLess = (a: number | null, b: number | null) => (a === null ? b !== null : b !== null && a < b)
const allGigs = (s: GameState) => [...s.players[0].gigs.map((d) => ({ d, p: 0 as PlayerId })), ...s.players[1].gigs.map((d) => ({ d, p: 1 as PlayerId }))]
const dieName = (s: GameState, viewer: PlayerId, d: Die, p: PlayerId) => `${p === viewer ? 'Your' : `${s.players[p].name}'s`} d${d.sides} (${d.value})`
const distinctValues = (dice: Die[]) => new Set(dice.map((d) => d.value)).size
const findDie = (s: GameState, id: string) => allGigs(s).find((x) => x.d.id === id)

function one(c: Ctx, player: PlayerId, prompt: string, options: ChoiceOption[], optional = false, reveal?: number[]): string | null {
	if (options.length === 0) return null
	const picks = c.ask(player, { prompt, options, min: optional ? 0 : 1, max: 1, ...(reveal ? { reveal } : {}) })
	return picks[0] ?? null
}

/** "Adjust / increase / decrease a Gig by up to N": pick a die, then the new value. */
function changeGig(c: Ctx, mode: 'adjust' | 'increase' | 'decrease', upTo: number, onlyFriendly = false, scoreFor?: (d: Die, p: PlayerId, nv: number) => number): { die: Die; p: PlayerId; from: number } | null {
	const { s, owner } = c
	const dice = allGigs(s).filter((x) => (!onlyFriendly || x.p === owner) && reachable(x.d, mode, upTo).length > 0)
	if (dice.length === 0) return null
	const verb = mode === 'adjust' ? 'Adjust' : mode === 'increase' ? 'Increase' : 'Decrease'
	const pick = one(
		c,
		owner,
		`${verb} a ${onlyFriendly ? 'friendly ' : ''}Gig by up to ${upTo}: choose a die (or skip).`,
		dice.map(({ d, p }) => ({
			id: d.id,
			label: dieName(s, owner, d, p),
			dieId: d.id,
			score: Math.max(...reachable(d, mode, upTo).map((nv) => (scoreFor ? scoreFor(d, p, nv) : defaultGigScore(owner, p, d.value, nv)))),
		})),
		true,
	)
	if (!pick) return null
	const x = findDie(s, pick)!
	const values = reachable(x.d, mode, upTo)
	const nv = one(
		c,
		owner,
		`New value for ${dieName(s, owner, x.d, x.p)}:`,
		values.map((v) => ({ id: String(v), label: `${x.d.value} → ${v}`, score: scoreFor ? scoreFor(x.d, x.p, v) : defaultGigScore(owner, x.p, x.d.value, v) })),
	)
	if (nv === null) return null
	const from = x.d.value
	x.d.value = Number(nv)
	c.log(`${s.players[owner].name} changes ${x.p === owner ? 'their' : `${s.players[x.p].name}'s`} d${x.d.sides} from ${from} to ${x.d.value}.`)
	return { die: x.d, p: x.p, from }
}
function reachable(d: Die, mode: 'adjust' | 'increase' | 'decrease', upTo: number): number[] {
	const out: number[] = []
	for (let k = 1; k <= upTo; k++) {
		if (mode !== 'decrease' && d.value + k <= d.sides) out.push(d.value + k)
		if (mode !== 'increase' && d.value - k >= 1) out.push(d.value - k)
	}
	return out.sort((a, b) => a - b)
}
/** By default: raise your own Street Cred, lower the rival's. */
const defaultGigScore = (me: PlayerId, p: PlayerId, from: number, to: number) => (p === me ? to - from : from - to)

function chooseUnit(c: Ctx, prompt: string, uids: number[], optional: boolean, score: (uid: number) => number): number | null {
	const pick = one(
		c,
		c.owner,
		prompt,
		uids.map((uid) => ({ id: String(uid), label: `${nameOf(c.s, uid)} (${Math.max(0, unitPower(c.s, findUnit(c.s, uid)!))})`, uid, score: score(uid) })),
		optional,
	)
	return pick === null ? null : Number(pick)
}
const power = (s: GameState, uid: number) => Math.max(0, unitPower(s, findUnit(s, uid)!))
const rivalUnits = (c: Ctx) => c.s.players[c.rival].field.map((u) => u.uid)

function lookAtLegend(c: Ctx, optional: boolean): number | null {
	const pl = c.s.players[c.owner]
	const down = pl.legends.filter((l) => !l.faceUp)
	if (down.length === 0) return null
	const known = new Set(pl.knownLegends ?? [])
	const pick = one(
		c,
		c.owner,
		'Look at one of your face-down Legends:',
		down.map((l) => ({ id: String(l.uid), label: `Legend in slot ${pl.legends.indexOf(l) + 1}${known.has(l.uid) ? ` (${nameOf(c.s, l.uid)})` : ''}`, uid: l.uid, score: known.has(l.uid) ? 0 : 1 })),
		optional,
	)
	if (pick === null) return null
	const uid = Number(pick)
	pl.knownLegends = [...new Set([...(pl.knownLegends ?? []), uid])]
	c.log(`${pl.name} looks at a face-down Legend.`)
	return uid
}

/** "Discard N": the owner picks cards from their hand. */
function discardFromHand(c: Ctx, n: number) {
	const pl = c.s.players[c.owner]
	const k = Math.min(n, pl.hand.length)
	if (k === 0) return
	const picks = c.ask(c.owner, {
		prompt: `Discard ${k} card${k > 1 ? 's' : ''} from your hand.`,
		options: pl.hand.map((u) => ({ id: String(u), label: nameOf(c.s, u), uid: u, score: -(def(c.s, u).cost ?? 0) - (def(c.s, u).type === 'unit' ? 1 : 0) })),
		min: k,
		max: k,
	})
	for (const id of picks) {
		const uid = Number(id)
		pl.hand.splice(pl.hand.indexOf(uid), 1)
		pl.trash.push(uid)
		c.log(`${pl.name} discards ${nameOf(c.s, uid)}.`)
	}
}

// ───────── the scripts ─────────

export const HANDLERS: Record<string, Handler> = {
	// ═════ The Heist (Yellow / Blue) ═════

	// Legend — on Call: search the top 5 for up to 2 Gears costing 2 or less.
	'viktor-vektor-sit-down-and-relax:call': (c) => {
		const pl = c.s.players[c.owner]
		const top = pl.deck.slice(0, 5)
		const gears = top.filter((u) => def(c.s, u).type === 'gear' && (def(c.s, u).cost ?? 0) <= 2)
		let take: number[] = []
		if (gears.length) {
			const picks = c.ask(c.owner, {
				prompt: `Viktor: the top ${top.length} cards hold ${gears.length} cheap Gear. Take up to 2 into your hand.`,
				options: gears.map((u) => ({ id: String(u), label: nameOf(c.s, u), uid: u, score: (def(c.s, u).power ?? 0) + 1 })),
				min: 0,
				max: Math.min(2, gears.length),
			})
			take = picks.map(Number)
		}
		const rest = top.filter((u) => !take.includes(u))
		pl.deck = pl.deck.slice(top.length)
		pl.hand.push(...take)
		const rng = new Rng(c.s.rng)
		pl.deck.push(...rng.shuffle(rest))
		c.s.rng = rng.seed
		c.log(`${pl.name} searches the top ${top.length}: takes ${take.length ? take.map((u) => nameOf(c.s, u)).join(' and ') : 'nothing'}, the rest go to the bottom.`)
	},
	// Legend (face-up, static): the first time you play a Blue Unit or Gear each turn…
	'jackie-welles-pour-one-out-for-me:static': (c) => {
		const r = changeGig(c, 'decrease', 2, true, (d, p, nv) => (nv === 1 ? 5 : 0) - (d.value - nv) * 0.1)
		if (r && r.die.value === 1) {
			c.log('Jackie: the Gig hit its minimum — draw 1.')
			drawCards(c.s, c.owner, 1)
		}
	},
	'dexter-deshawn-one-last-chance:play': (c) => void changeGig(c, 'adjust', 1),
	'dexter-deshawn-one-last-chance:attack': (c) => void changeGig(c, 'adjust', 1),
	'dexter-deshawn-one-last-chance:defeated': (c) => {
		const a = credOf(c.s, c.owner)
		const b = credOf(c.s, c.rival)
		if (a !== null && b !== null && Math.abs(a - b) >= 10) {
			c.log('Dexter: Street Cred differs by 10+ — draw 2.')
			drawCards(c.s, c.owner, 2)
		}
	},
	'offduty-malfini:play': (c) => {
		spendCard(c.s, c.source)
		const ready = c.s.players[c.rival].field.filter((u) => !u.spent).map((u) => u.uid)
		const t = chooseUnit(c, 'Malfini: choose a rival Unit to spend (it can then be attacked).', ready, false, (uid) => power(c.s, uid))
		if (t !== null) {
			spendCard(c.s, t)
			c.log(`${nameOf(c.s, t)} is spent.`)
		}
	},
	't-bug-amateur-philosopher:defeated': (c) => {
		const pl = c.s.players[c.owner]
		const down = pl.legends.filter((l) => !l.faceUp)
		if (!down.length) return
		pl.knownLegends = [...new Set([...(pl.knownLegends ?? []), ...down.map((l) => l.uid)])]
		c.log(`${pl.name} looks at all their face-down Legends.`)
		if (pl.calledThisTurn) return
		const yes = one(
			c,
			c.owner,
			`T-Bug: your face-down Legends are ${down.map((l) => nameOf(c.s, l.uid)).join(', ')}. Call one at random for free?`,
			[
				{ id: 'yes', label: 'Call a Legend (free)', score: 1 },
				{ id: 'no', label: 'No', score: 0 },
			],
			false,
			down.map((l) => l.uid),
		)
		if (yes === 'yes') freeCallLegend(c.s, c.owner)
	},
	'heywood-ripperdoc:play': (c) => {
		const gears: { g: number; host: number }[] = []
		for (const p of [0, 1] as PlayerId[])
			for (const h of [...c.s.players[p].field, ...c.s.players[p].legends]) for (const g of h.gear) gears.push({ g, host: h.uid })
		if (!gears.length) return
		const values = new Set(c.s.players[c.owner].gigs.map((d) => d.value))
		const pick = one(
			c,
			c.owner,
			'Heywood: you may defeat a Gear. If its cost matches one of your Gig values, draw 1.',
			gears.map(({ g, host }) => ({
				id: String(g),
				label: `${nameOf(c.s, g)} (cost ${def(c.s, g).cost}) on ${nameOf(c.s, host)}`,
				uid: g,
				score: (ownerOf(c.s, g) === c.owner ? -3 : 2) + (values.has(def(c.s, g).cost ?? -1) ? 1 : 0),
			})),
			true,
		)
		if (pick === null) return
		const g = Number(pick)
		const cost = def(c.s, g).cost ?? -1
		for (const p of [0, 1] as PlayerId[])
			for (const h of [...c.s.players[p].field, ...c.s.players[p].legends]) h.gear = h.gear.filter((x) => x !== g)
		c.s.players[ownerOf(c.s, g)].trash.push(g)
		c.log(`${nameOf(c.s, g)} is defeated.`)
		if (values.has(cost)) {
			c.log('Its cost matches a friendly Gig — draw 1.')
			drawCards(c.s, c.owner, 1)
		}
	},
	'kiroshi-optics:hostAttack': (c) => void lookAtLegend(c, false),
	'zetatech-faceplate:hostSpent': (c) => {
		changeGig(c, 'adjust', 1, false, (d, p, nv) => {
			// favour making your Gig values all different
			if (p !== c.owner) return (d.value - nv) * 0.5
			const vals = c.s.players[c.owner].gigs.map((x) => (x.id === d.id ? nv : x.value))
			return new Set(vals).size + (nv - d.value) * 0.1
		})
		if (distinctValues(c.s.players[c.owner].gigs) >= 3) {
			c.log('Faceplate: 3+ Gigs with different values — draw 1.')
			drawCards(c.s, c.owner, 1)
		}
	},
	'afterparty-at-lizzie-s:program': (c) => {
		changeGig(c, 'adjust', 1, false, (d, p, nv) => {
			if (p !== c.owner) return (d.value - nv) * 0.5
			const vals = c.s.players[c.owner].gigs.map((x) => (x.id === d.id ? nv : x.value))
			return new Set(vals).size + (nv - d.value) * 0.1
		})
		if (distinctValues(c.s.players[c.owner].gigs) >= 2) {
			c.log('Afterparty: 2+ Gigs with different values — draw 1.')
			drawCards(c.s, c.owner, 1)
		}
	},
	'evelyn-parker-scheming-siren:attack': (c) => {
		drawCards(c.s, c.owner, 1)
		if (credLess(credOf(c.s, c.rival), credOf(c.s, c.owner))) {
			c.log('Evelyn: you have more Street Cred than your rival — discard 1.')
			discardFromHand(c, 1)
		}
	},
	'tetratronic-rippler:hostSpent': (c) => {
		const pl = c.s.players[c.owner]
		const top = pl.deck[0]
		if (top === undefined) return
		const d = def(c.s, top)
		const pick = one(c, c.owner, `Rippler: the top card of your deck is ${nameOf(c.s, top)}. Trash it?`, [
			{ id: 'trash', label: `Trash ${d.name}`, uid: top, score: (d.cost ?? 0) >= 5 ? 1 : 0 },
			{ id: 'keep', label: 'Keep it on top', score: 0.5 },
		])
		if (pick === 'trash') {
			pl.deck.shift()
			pl.trash.push(top)
			c.log(`${pl.name} trashes the top card of their deck.`)
		} else c.log(`${pl.name} looks at the top card of their deck and keeps it there.`)
	},
	'dying-night-v-s-pistol:hostAttack': (c) => {
		changeGig(c, 'decrease', 2, false, (d, p, nv) => (p === c.owner ? -1 : d.value - nv))
		const host = c.data.host as number | undefined
		const u = host !== undefined ? findUnit(c.s, host) : undefined
		if (u && def(c.s, u.uid).name === 'V') {
			u.eotEddies = (u.eotEddies ?? 0) + 2
			c.log('Dying Night: V will ready 2 Eddies at the end of the turn.')
		}
	},
	'floor-it:program': (c) => {
		const t = chooseUnit(c, 'Floor It: give a rival Unit −1 power this turn.', rivalUnits(c), false, (uid) => (c.s.attacking === uid ? 10 : 0) + power(c.s, uid))
		if (t !== null) {
			findUnit(c.s, t)!.powerThisTurn -= 1
			c.log(`${nameOf(c.s, t)} gets −1 power this turn.`)
		}
		drawCards(c.s, c.owner, 1)
	},
	'reboot-optics:program': (c) => {
		const pl = c.s.players[c.owner]
		pl.fightShield = (pl.fightShield ?? 0) + 1
		c.log(`${pl.name}: the next time a rival Unit fights this turn, it won't defeat their Unit.`)
	},

	// ═════ Embracing Power (Red / Green) ═════

	// Legend (face-up, static): the first time a friendly ARASAKA Unit attacks each turn…
	'yorinobu-arasaka-embracing-destruction:static': (c) => {
		drawCards(c.s, c.owner, 1)
		const cred = credOf(c.s, c.owner)
		if (cred === null || cred < 20) {
			c.log('Yorinobu: under 20 Street Cred — discard 1.')
			discardFromHand(c, 1)
		}
	},
	'swordwise-huscle:attack': (c) => {
		if (power(c.s, c.source) >= 5) {
			c.log('Swordwise Huscle has 5+ power — draw 1.')
			drawCards(c.s, c.owner, 1)
		}
	},
	'chrome-fang:play': (c) => {
		c.s.players[c.owner].stealShield = true
		c.log(`Until ${c.s.players[c.owner].name}'s next turn, rival Units can't steal their Gigs worth more than the attacker's power.`)
	},
	'minotaur:play': (c) => {
		if (!credLess(credOf(c.s, c.rival), credOf(c.s, c.owner))) {
			c.log('Minotaur: you don’t have more Street Cred than your rival — no effect.')
			return
		}
		const ok = rivalUnits(c).filter((uid) => power(c.s, uid) <= 5)
		const t = chooseUnit(c, 'Minotaur: defeat a rival Unit with power 5 or less.', ok, false, (uid) => power(c.s, uid))
		if (t !== null) defeatUnit(c.s, t)
	},
	'arasaka-emergency-radioport:hostSpent': (c) => {
		const pl = c.s.players[c.owner]
		if (!pl.legends.some((l) => !l.faceUp)) return
		const uid = lookAtLegend(c, true)
		if (uid === null) return
		const d = def(c.s, uid)
		if ((tag(c.s, uid, 'arasaka') || d.keywords.includes('goSolo')) && !pl.calledThisTurn) {
			const yes = one(
				c,
				c.owner,
				`Radioport: it's ${d.name} — Call it for free?`,
				[
					{ id: 'yes', label: `Call ${d.name}`, score: 1 },
					{ id: 'no', label: 'Leave it face-down', score: 0 },
				],
				false,
				[uid],
			)
			if (yes === 'yes') freeCallLegend(c.s, c.owner, uid)
		}
	},
	'satori-sword-of-saburo:hostWin': (c) => {
		c.log('Satori: won the fight — draw 1.')
		drawCards(c.s, c.owner, 1)
	},
	'industrial-assembly:program': (c) => {
		changeGig(c, 'increase', 4, false, (d, p, nv) => (p === c.owner ? (nv >= 8 ? 10 : 0) + nv - d.value : -5))
		if (c.s.players[c.owner].gigs.some((d) => d.value >= 8)) {
			c.log('Industrial Assembly: you have a Gig worth 8+ — draw 1.')
			drawCards(c.s, c.owner, 1)
		}
	},
	'over-the-edge:program': (c) => {
		const d20 = c.s.players[c.owner].gigs.find((d) => d.sides === 20)
		if (!d20) {
			c.log('Over the Edge: you have no d20 Gig — no effect.')
			return
		}
		const all = [...c.s.players[c.rival].field, ...c.s.players[c.owner].field].map((u) => u.uid).filter((uid) => power(c.s, uid) <= d20.value)
		const t = chooseUnit(c, `Over the Edge: defeat a Unit with power ${d20.value} or less (your d20).`, all, false, (uid) => (ownerOf(c.s, uid) === c.owner ? -10 : power(c.s, uid)))
		if (t !== null) defeatUnit(c.s, t)
	},
	'shattered-memories:program': (c) => {
		let discarded = 0
		for (const p of [c.owner, c.rival]) {
			const pl = c.s.players[p]
			discarded += pl.hand.length
			pl.trash.push(...pl.hand)
			pl.hand = []
		}
		c.log(`Both players discard their hands (${discarded} cards) and draw 5.`)
		drawCards(c.s, c.owner, 5)
		drawCards(c.s, c.rival, 5)
		if (c.s.players[c.owner].gigs.some((d) => d.value === discarded)) {
			c.log(`${discarded} cards matches a friendly Gig — draw 2.`)
			drawCards(c.s, c.owner, 2)
		}
	},
	'field-operator:play': (c) => {
		const cred = credOf(c.s, c.owner)
		if (cred !== null && cred % 2 === 0) {
			c.log('Field Operator: your Street Cred is even — draw 1.')
			drawCards(c.s, c.owner, 1)
		}
	},
	'goro-takemura-losing-his-way:attack': (c) => {
		const legends = c.s.players[c.owner].legends
		if (legends.every((l) => l.faceUp)) {
			findUnit(c.s, c.source)!.powerThisTurn += 5
			c.log('Goro: all your Legends are face-up — +5 power this turn.')
		}
	},
	'maxtac-av:play': (c) => {
		const mine = c.s.players[c.owner].gigs
		const theirs = c.s.players[c.rival].gigs
		if (!mine.length || !theirs.length) return
		const a = one(
			c,
			c.owner,
			'MaxTac AV: you may swap one of your Gigs with one of theirs. Pick yours (or skip).',
			mine.map((d) => ({ id: d.id, label: dieName(c.s, c.owner, d, c.owner), dieId: d.id, score: -d.value })),
			true,
		)
		if (a === null) return
		const b = one(
			c,
			c.owner,
			'Now pick their Gig to take.',
			theirs.map((d) => ({ id: d.id, label: dieName(c.s, c.owner, d, c.rival), dieId: d.id, score: d.value })),
		)
		if (b === null) return
		const ia = mine.findIndex((d) => d.id === a)
		const ib = theirs.findIndex((d) => d.id === b)
		const [da] = mine.splice(ia, 1)
		const [db] = theirs.splice(ib, 1)
		mine.push(db)
		theirs.push(da)
		c.log(`${c.s.players[c.owner].name} swaps their d${da.sides} (${da.value}) for ${c.s.players[c.rival].name}'s d${db.sides} (${db.value}).`)
		overtimeCheckPublic(c.s)
	},
	'corporate-surveillance:program': (c) => {
		const ok = c.s.players[c.rival].field.filter((u) => !u.spent && (def(c.s, u.uid).cost ?? 0) <= 4).map((u) => u.uid)
		const t = chooseUnit(c, 'Corporate Surveillance: spend a rival Unit costing 4 or less (it can then be attacked).', ok, false, (uid) => power(c.s, uid))
		if (t !== null) {
			spendCard(c.s, t)
			c.log(`${nameOf(c.s, t)} is spent.`)
		}
	},
}

// ───────── static rules referenced by the engine ─────────

export const NO_GIG_ATTACKS = new Set(['ruthless-lowlife'])
export const CANT_ATTACK = new Set(['corpo-security'])
export const BLOCKER_GEAR = new Set(['mandibular-upgrade'])
export const READY_AT_END_GEAR = new Set(['sandevistan'])

/** Cards whose effect the computer player knows how to use (also: which Programs are scripted). */
export const isScripted = (cardId: string) => Object.keys(HANDLERS).some((k) => k.startsWith(cardId + ':'))

/** Extra power from face-up Legends (Saburo: friendly ARASAKA Units +1 while attacking). */
export function staticPowerBonus(s: GameState, uid: number): number {
	let bonus = 0
	const owner = ownerOf(s, uid)
	if (s.attacking === uid && tag(s, uid, 'arasaka') && s.players[owner].legends.some((l) => l.faceUp && s.instances[l.uid].cardId === 'saburo-arasaka-stubborn-patriarch')) bonus += 1
	return bonus
}

/** MT0D12 Flathead can't be blocked while its owner has less Street Cred than the rival. */
export function unblockable(s: GameState, attacker: number): boolean {
	if (s.instances[attacker].cardId !== 'mt0d12-flathead') return false
	const o = ownerOf(s, attacker)
	return credLess(streetCred(s.players[o]), streetCred(s.players[other(o)]))
}

// ───────── task runner ─────────

export function makeTask(s: GameState, key: string, source: number, owner: PlayerId, data?: Record<string, unknown>): Task | null {
	return HANDLERS[key] ? { key, source, owner, data, answers: [] } : null
}

/** Run one task against a copy of the state. Returns the new state, or the question it needs answered. */
export function runTask(s: GameState, task: Task): { state: GameState } | { need: NeedChoice } {
	const trial: GameState = structuredClone({ ...s, cards: {} as GameState['cards'] })
	trial.cards = s.cards
	let i = 0
	const ctx: Ctx = {
		s: trial,
		owner: task.owner,
		rival: other(task.owner),
		source: task.source,
		data: task.data ?? {},
		ask(player, q) {
			const valid = q.options.length
			if (valid === 0) return []
			if (i < task.answers.length) return task.answers[i++]
			// only one way to answer a forced single choice: no need to ask
			if (q.min === q.max && valid === q.min) {
				const all = q.options.map((o) => o.id)
				task.answers.push(all)
				i++
				return all
			}
			throw new NeedChoice(player, q)
		},
		log(line) {
			trial.log.push(line)
		},
	}
	try {
		HANDLERS[task.key](ctx)
		return { state: trial }
	} catch (e) {
		if (e instanceof NeedChoice) return { need: e }
		throw e
	}
}
