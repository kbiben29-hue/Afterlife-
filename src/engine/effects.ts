// Card abilities. Each ability is a small script keyed by `${cardId}:${trigger}`. Scripts run
// inside a Task; when one needs a decision it calls `c.ask(...)`. If that question has no answer
// yet, the task stops (nothing it did is kept), the player is asked, and the task re-runs from
// the start with the recorded answers. Engine state is deterministic, so re-runs replay exactly.
//
// The starter-deck cards are scripted here; every other card in the database is in set1.ts.
// Static rules, listeners ("when a friendly Unit steals…"), activated abilities and cost changes are
// collected at the bottom of this file as hooks the engine calls.

import {
	available,
	def,
	defeatGear,
	defeatUnit,
	drawCards,
	findUnit,
	fire,
	freeCallLegend,
	hasKw,
	hasMark,
	hostOf,
	markN,
	nameOf,
	overtimeCheckPublic,
	ownerOf,
	readyEddies,
	spendCard,
	streetCred,
	unitPower,
	useMark,
	finishTurn,
	returnToHand,
} from './engine'
import { Rng } from './rng'
import { ABILITIES, KEYWORDS, LISTENERS, SET1_HANDLERS, VANILLA } from './set1'
import { other, type AttackTarget, type ChoiceOption, type Die, type FieldUnit, type GameState, type Keyword, type PlayerId, type Question, type Task } from './types'

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

export type Handler = (c: Ctx) => void

// ───────── helpers used by card scripts ─────────

export const tag = (s: GameState, uid: number, t: string) => def(s, uid).tags.some((x) => x.toLowerCase() === t.toLowerCase())
export const credOf = (s: GameState, p: PlayerId) => streetCred(s.players[p])
/** Null Street Cred (no Gigs) counts as smaller than any number (CR 5.11.4.2). */
export const credLess = (a: number | null, b: number | null) => (a === null ? b !== null : b !== null && a < b)
export const allGigs = (s: GameState) => [...s.players[0].gigs.map((d) => ({ d, p: 0 as PlayerId })), ...s.players[1].gigs.map((d) => ({ d, p: 1 as PlayerId }))]
export const dieName = (s: GameState, viewer: PlayerId, d: Die, p: PlayerId) => `${p === viewer ? 'Your' : `${s.players[p].name}'s`} d${d.sides} (${d.value})`
const distinctValues = (dice: Die[]) => new Set(dice.map((d) => d.value)).size
export const findDie = (s: GameState, id: string) => allGigs(s).find((x) => x.d.id === id)

export function one(c: Ctx, player: PlayerId, prompt: string, options: ChoiceOption[], optional = false, reveal?: number[]): string | null {
	if (options.length === 0) return null
	const picks = c.ask(player, { prompt, options, min: optional ? 0 : 1, max: 1, ...(reveal ? { reveal } : {}) })
	return picks[0] ?? null
}

/** "Adjust / increase / decrease a Gig by up to N": pick a die, then the new value. */
export function changeGig(c: Ctx, mode: 'adjust' | 'increase' | 'decrease', upTo: number, onlyFriendly = false, scoreFor?: (d: Die, p: PlayerId, nv: number) => number, onlyDie?: string): { die: Die; p: PlayerId; from: number } | null {
	const { s, owner } = c
	const dice = allGigs(s).filter((x) => (!onlyFriendly || x.p === owner) && (!onlyDie || x.d.id === onlyDie) && reachable(x.d, mode, upTo).length > 0)
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
	emit(s, { type: 'gigChange', by: owner, dieOwner: x.p })
	return { die: x.d, p: x.p, from }
}
export function reachable(d: Die, mode: 'adjust' | 'increase' | 'decrease', upTo: number): number[] {
	const out: number[] = []
	for (let k = 1; k <= upTo; k++) {
		if (mode !== 'decrease' && d.value + k <= d.sides) out.push(d.value + k)
		if (mode !== 'increase' && d.value - k >= 1) out.push(d.value - k)
	}
	return out.sort((a, b) => a - b)
}
/** By default: raise your own Street Cred, lower the rival's. */
export const defaultGigScore = (me: PlayerId, p: PlayerId, from: number, to: number) => (p === me ? to - from : from - to)

export function chooseUnit(c: Ctx, prompt: string, uids: number[], optional: boolean, score: (uid: number) => number): number | null {
	const pick = one(
		c,
		c.owner,
		prompt,
		uids.map((uid) => ({ id: String(uid), label: `${nameOf(c.s, uid)} (${Math.max(0, unitPower(c.s, findUnit(c.s, uid)!))})`, uid, score: score(uid) })),
		optional,
	)
	return pick === null ? null : Number(pick)
}
export const power = (s: GameState, uid: number) => Math.max(0, unitPower(s, findUnit(s, uid)!))
export const rivalUnits = (c: Ctx) => c.s.players[c.rival].field.map((u) => u.uid)

export function lookAtLegend(c: Ctx, optional: boolean): number | null {
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
export function discardFromHand(c: Ctx, n: number, who: PlayerId = c.owner): number[] {
	const pl = c.s.players[who]
	const k = Math.min(n, pl.hand.length)
	if (k === 0) return []
	const picks = c.ask(who, {
		prompt: `${who === c.owner ? '' : `${def(c.s, c.source).name}: `}Discard ${k} card${k > 1 ? 's' : ''} from your hand.`,
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
	return picks.map(Number)
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
		emit(c.s, { type: 'gigChange', by: c.owner, dieOwner: c.rival })
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

Object.assign(HANDLERS, SET1_HANDLERS, {
	'core:finishTurn': (c: Ctx) => finishTurn(c.s, c.owner),
})

// ───────── static rules referenced by the engine ─────────

export const NO_GIG_ATTACKS = new Set(['ruthless-lowlife'])
export const CANT_ATTACK = new Set(['corpo-security', 'misty-olszewski-mender-of-broken-spirits'])
export const BLOCKER_GEAR = new Set(['mandibular-upgrade', 'riot-shield'])
export const READY_AT_END_GEAR = new Set(['sandevistan'])

/** Cards whose effect the computer player knows how to use (also: which Programs are scripted). */
export const isScripted = (cardId: string) =>
	VANILLA.has(cardId) || !!ABILITIES[cardId] || !!LISTENERS[cardId] || !!KEYWORDS[cardId] || Object.keys(HANDLERS).some((k) => k.startsWith(cardId + ':'))

/** Extra power from face-up Legends (Saburo: friendly ARASAKA Units +1 while attacking). */
export function staticPowerBonus(s: GameState, uid: number): number {
	let bonus = 0
	const owner = ownerOf(s, uid)
	if (s.attacking === uid && tag(s, uid, 'arasaka') && s.players[owner].legends.some((l) => l.faceUp && s.instances[l.uid].cardId === 'saburo-arasaka-stubborn-patriarch')) bonus += 1
	const id = s.instances[uid].cardId
	const u = findUnit(s, uid)
	// Saul Bright: other friendly Units +2 while attacking
	if (s.attacking === uid && id !== 'saul-bright-stormrider' && s.players[owner].field.some((x) => x.uid !== uid && s.instances[x.uid].cardId === 'saul-bright-stormrider')) bonus += 2
	// Royce (Go Solo): +2 per equipped Gear during your turn
	if (id === 'royce-psycho-on-the-edge' && s.active === owner && u) bonus += 2 * u.gear.length
	const opp = s.fighting ? (s.fighting[0] === uid ? s.fighting[1] : s.fighting[1] === uid ? s.fighting[0] : undefined) : undefined
	if (opp !== undefined) {
		// Meredith Stout: +2 while fighting a Legend (a Legend that went solo)
		if (id === 'meredith-stout-stone-cold-corpo' && findUnit(s, opp)?.goSolo) bonus += 2
		// Synapse Burnout: +1 per friendly face-up Legend while fighting rival Units
		if (u && ownerOf(s, opp) !== owner) bonus += markN(u, 'synapse')
	}
	return bonus
}

// ───────── hooks for the engine (all cards) ─────────

const cid = (s: GameState, uid: number) => s.instances[uid].cardId
const fieldHas = (s: GameState, p: PlayerId, id: string) => s.players[p].field.some((u) => cid(s, u.uid) === id)
const legendUp = (s: GameState, p: PlayerId, id: string) => s.players[p].legends.find((l) => l.faceUp && cid(s, l.uid) === id)
export const gigs8 = (s: GameState, p: PlayerId) => s.players[p].gigs.filter((d) => d.value >= 8).length
export const minGigs = (s: GameState, p: PlayerId) => s.players[p].gigs.filter((d) => d.value === 1).length
/** Number of value-pairs among a player's Gigs (two dice showing the same value). */
export const valuePairs = (s: GameState, p: PlayerId) => {
	const n = new Map<number, number>()
	for (const d of s.players[p].gigs) n.set(d.value, (n.get(d.value) ?? 0) + 1)
	return [...n.values()].reduce((a, k) => a + Math.floor(k / 2), 0)
}

/** Keywords a card has printed (authoritative list for automated cards). */
export function keywordsOf(s: GameState, uid: number): Keyword[] {
	const id = cid(s, uid)
	return KEYWORDS[id] ?? (isScripted(id) ? [] : def(s, uid).keywords)
}
/** Keywords granted by Gear or conditions. */
export function grantedKeyword(s: GameState, u: FieldUnit, k: Keyword): boolean {
	if (k === 'blocker' && u.gear.some((g) => BLOCKER_GEAR.has(cid(s, g)))) return true
	if (k === 'adrenaline' && u.gear.some((g) => cid(s, g) === 'adrenaline-converter')) {
		const o = ownerOf(s, u.uid)
		if (s.players[other(o)].gigs.length >= s.players[o].gigs.length + 2) return true
	}
	return false
}
/** A reason this Unit can't attack at all right now (null = it may). */
export function attackRestriction(s: GameState, u: FieldUnit): string | null {
	const id = cid(s, u.uid)
	const o = ownerOf(s, u.uid)
	if (CANT_ATTACK.has(id)) return 'This Unit can’t attack'
	if (hasMark(u, 'noAttack')) return 'This Unit can’t attack until its controller’s rival’s next turn'
	if (id === 'jacked-in-voodoo-boy' && !s.players[o].usedThisTurn?.includes('program')) return 'Jacked-in Voodoo Boy can only attack after you play a Program this turn'
	if (u.lag && fieldHas(s, other(o), 'maxtac-suppression-team')) return 'The rival’s MaxTac Suppression Team: Units can’t attack the turn they’re played'
	return null
}
export const canAttackGigs = (s: GameState, u: FieldUnit) => !NO_GIG_ATTACKS.has(cid(s, u.uid))
/** May this Unit attack this ready rival Unit? */
export function canAttackReady(s: GameState, u: FieldUnit, t: FieldUnit): boolean {
	if (hasMark(u, 'attackReady')) return true
	const o = ownerOf(s, u.uid)
	if (cid(s, u.uid) === 'valentino-guerrera' && hasKw(s, t.uid, 'blocker') && credLess(credOf(s, other(o)), credOf(s, o))) return true
	return false
}
/** May this Unit attack the turn it was played (beyond Adrenaline)? */
export function lagOk(s: GameState, u: FieldUnit, target: AttackTarget, t?: FieldUnit): boolean {
	const id = cid(s, u.uid)
	const o = ownerOf(s, u.uid)
	if (target.kind === 'gigs') return id === 'nadia-fighting-through-grief' && s.players[other(o)].gigs.length > s.players[o].gigs.length
	return id === 'sandayu-oda-hanako-s-guardian' || hasMark(u, 'lagUnits') || (hasMark(u, 'lagSpentUnits') && !!t?.spent)
}

function costCuts(s: GameState, p: PlayerId, uid: number): { cost: number; dyi: boolean; alt: boolean } {
	const d = def(s, uid)
	const id = d.id
	const base = d.cost ?? 0
	const pl = s.players[p]
	let c = base
	switch (id) {
		case 'zetatech-berserk':
			c -= pl.legends.filter((l) => l.faceUp).length
			break
		case 'maxtac-heavy':
			c -= s.players[other(p)].field.length
			break
		case 'octant':
		case 'carnage-at-the-colosseum':
			c -= gigs8(s, p)
			break
		case 'trauma-team-operatives':
			c -= pl.trash.filter((u) => def(s, u).type === 'unit').length
			break
		case 'nocturne-op55-n1':
			if (pl.fixer.length === 0) c = Math.min(c, 1)
			break
		case 'we-gotta-live-together':
			if (s.players[other(p)].gigs.length >= pl.gigs.length + 2) c = Math.min(c, 3)
			break
	}
	let dyi = false
	if (d.type === 'gear' && tag(s, uid, 'cyberware') && fieldHas(s, p, 'viktor-vektor-drop-your-illusions') && !pl.usedThisTurn?.includes('dyi')) {
		c -= 3
		dyi = true
	}
	let alt = false
	if (d.type === 'program' && hasMark(pl, 'altProgram')) {
		c -= minGigs(s, p)
		alt = true
	}
	if (c < base) c = Math.max(1, c)
	return { cost: c, dyi, alt }
}
export const playCost = (s: GameState, p: PlayerId, uid: number) => costCuts(s, p, uid).cost
/** A card was paid for: use up "your first/next … costs less" effects. */
export function paidFor(s: GameState, p: PlayerId, uid: number) {
	const { dyi, alt } = costCuts(s, p, uid)
	const pl = s.players[p]
	if (dyi) (pl.usedThisTurn ??= []).push('dyi')
	if (alt) useMark(pl, 'altProgram')
}
/** After any card is played (paid or free). */
export function afterPlay(s: GameState, p: PlayerId, uid: number) {
	if (def(s, uid).type === 'program') {
		;(s.players[p].usedThisTurn ??= []).push('program')
		emit(s, { type: 'program', uid, owner: p })
	}
}
export function goSoloCost(s: GameState, p: PlayerId, uid: number): number {
	const base = def(s, uid).cost ?? 0
	let c = base
	// Riot Shield on a rival card: +2 to Go Solo
	for (const h of [...s.players[other(p)].field, ...s.players[other(p)].legends]) for (const g of h.gear) if (cid(s, g) === 'riot-shield') c += 2
	if (hasMark(s.players[p], 'nocturneSolo')) c = Math.max(1, c - 2)
	return c
}
/** Panam Palmer (Strength Through Family): Call a Legend for free during your turn. */
export const callCost = (s: GameState, p: PlayerId) => (s.active === p && fieldHas(s, p, 'panam-palmer-strength-through-family') ? 0 : 1)

/** Replacement effects for "would be defeated". True = handled (the Unit isn't defeated now). */
export function beforeDefeat(s: GameState, uid: number): boolean {
	const u = findUnit(s, uid)!
	const o = ownerOf(s, uid)
	const dm = u.gear.find((g) => cid(s, g) === 'deadman-transmitter')
	if (dm !== undefined) {
		s.log.push(`Deadman Transmitter takes the hit for ${nameOf(s, uid)}.`)
		defeatGear(s, dm)
		return true
	}
	const j = legendUp(s, o, 'jackie-welles-mama-s-favorite')
	if (j && available(s, o, j.uid) >= 1) {
		fire(s, 'jackie-welles-mama-s-favorite:save', j.uid, o, { uid })
		return true
	}
	return false
}
/** Fight rules from cards: who loses. */
export function fightRules(s: GameState, a: number, d: number, aL: boolean, dL: boolean, _pa: number, _pd: number): [boolean, boolean] {
	const corpo = (x: number) => tag(s, x, 'corpo')
	if (cid(s, a) === 'johnny-silverhand-never-stop-fighting' && corpo(d)) [aL, dL] = [false, true]
	if (cid(s, d) === 'johnny-silverhand-never-stop-fighting' && corpo(a)) [aL, dL] = [true, false]
	if (aL && hasMark(findUnit(s, a), 'noFightDefeat')) aL = false
	if (dL && hasMark(findUnit(s, d), 'noFightDefeat')) dL = false
	return [aL, dL]
}
/** After a fight is decided, before defeats: "when this loses / wins" effects. */
export function afterFight(s: GameState, a: number, d: number, aL: boolean, dL: boolean, pa: number, pd: number): [boolean, boolean] {
	for (const x of [a, d]) {
		const u = findUnit(s, x)!
		if (hasMark(u, 'psycho') && !hasMark(u, 'defeatEot')) u.marks!.push({ k: 'defeatEot', until: 'eot' })
	}
	const sides: [number, number, boolean, number, number][] = [
		[a, d, aL, pa, pd],
		[d, a, dL, pd, pa],
	]
	let [aLoses, dLoses] = [aL, dL]
	const loseOpp = (x: number) => (x === a ? (aLoses = true) : (dLoses = true))
	for (const [me, opp, lost, pm, po] of sides) {
		const o = ownerOf(s, me)
		const pl = s.players[o]
		const won = !lost && (me === a ? dL : aL)
		if (lost) {
			if (cid(s, me) === 'maelstrom-zealots') {
				s.log.push('Maelstrom Zealots: the opposing Unit is defeated too.')
				loseOpp(opp)
			}
			if (hasMark(pl, 'safetyOverride')) {
				useMark(pl, 'safetyOverride')
				s.log.push('Safety Override: the opposing Unit is defeated too.')
				loseOpp(opp)
			}
		}
		if (won) {
			const u = findUnit(s, me)!
			if (cid(s, me) === 'johnny-silverhand-never-stop-fighting' && !pl.usedThisTurn?.includes(`johnny${me}`)) {
				;(pl.usedThisTurn ??= []).push(`johnny${me}`)
				u.spent = false
				s.log.push(`${nameOf(s, me)} won its fight and readies.`)
			}
			if (hasMark(pl, 'appetite') && pm - po >= 3 && s.active === o && s.players[other(o)].gigs.length) {
				useMark(pl, 'appetite')
				s.log.push('Appetite for Destruction: the winner also steals a Gig.')
				s.pending = { kind: 'steal', player: o, remaining: 1, attacker: me }
			}
		}
	}
	return [aLoses, dLoses]
}
/** "When a rival Unit would steal a Gig…": true = an effect stepped in (it decides). */
export function interceptSteal(s: GameState, attacker: number, dieId: string): boolean {
	const def_ = other(ownerOf(s, attacker))
	const alt = s.players[def_].field.find((u) => cid(s, u.uid) === 'alt-cunningham-mother-of-daemons')
	const d = s.players[def_].gigs.find((x) => x.id === dieId)
	if (alt && d && s.players[def_].hand.some((u) => def(s, u).cost === d.value)) {
		fire(s, 'alt-cunningham-mother-of-daemons:prevent', alt.uid, def_, { attacker, dieId })
		return true
	}
	return false
}
/** End of turn: simple effects happen now; ones with choices are queued. */
export function endOfTurn(s: GameState, p: PlayerId) {
	const pl = s.players[p]
	for (const u of [...pl.field]) {
		const id = cid(s, u.uid)
		if (u.stoleThisTurn && id === 'delamain-cab') readyEddies(s, p, 1, 'Delamain Cab')
		if (u.eotEddies) readyEddies(s, p, u.eotEddies, 'Dying Night')
		if (id === 'modded-muramasa' && u.spent && credLess(credOf(s, p), credOf(s, other(p)))) {
			u.spent = false
			s.log.push('Modded Muramasa readies.')
		}
		if (id === 'maxtac-squadron' && u.spent && pl.legends.some((l) => l.faceUp && l.spent)) fire(s, 'maxtac-squadron:eot', u.uid, p)
		if (id === 'misty-olszewski-mender-of-broken-spirits') fire(s, 'misty-olszewski-mender-of-broken-spirits:eot', u.uid, p)
		if (id === 'v-roamer-of-the-badlands' && gigs8(s, p) >= 2) {
			s.log.push('V (Roamer of the Badlands): 2+ Gigs worth 8+ — draw 1.')
			drawCards(s, p, 1)
		}
	}
	for (const h of [...pl.field, ...pl.legends])
		if (h.spent && h.gear.some((g) => READY_AT_END_GEAR.has(cid(s, g)))) {
			h.spent = false
			s.log.push(`Sandevistan readies ${'faceUp' in h && !h.faceUp ? 'a face-down Legend' : nameOf(s, h.uid)}.`)
		}
	if (fieldHas(s, p, 'saul-bright-stormrider')) {
		const spent = pl.field.filter((u) => u.spent).sort((a, b) => power(s, b.uid) - power(s, a.uid)).slice(0, 3)
		for (const u of spent) u.spent = false
		if (spent.length) s.log.push(`Saul Bright readies ${spent.map((u) => nameOf(s, u.uid)).join(', ')}.`)
	}
	if (legendUp(s, p, 'panam-palmer-nomad-cavalry')) {
		const eq = [...pl.field, ...pl.legends].filter((h) => h.gear.length > 0)
		if (eq.length >= 5) {
			for (const h of eq) h.spent = false
			s.log.push('Panam Palmer: 5+ equipped cards — they all ready.')
		}
	}
	// Cyberpsychosis: a Unit that stole or fought is defeated now
	for (const u of [...pl.field, ...s.players[other(p)].field]) if (hasMark(u, 'defeatEot')) defeatUnit(s, u.uid)
	// Modded Kusanagi goes back to hand
	for (const u of [...pl.field]) if (cid(s, u.uid) === 'modded-kusanagi') returnToHand(s, u.uid)
}

// ───────── events: "when …" abilities of cards in play ─────────

export type GameEvent =
	| { type: 'spent'; uid: number; owner: PlayerId; equipped: boolean; legend: boolean }
	| { type: 'defeated'; uid: number; owner: PlayerId; equipped: boolean }
	| { type: 'block'; uid: number; owner: PlayerId }
	| { type: 'steal'; uid: number; owner: PlayerId; dieId: string; value: number; sides: number; first: boolean }
	| { type: 'roll'; p: PlayerId; dieId: string; fromFixer: boolean }
	| { type: 'gigChange'; by: PlayerId; dieOwner: PlayerId }
	| { type: 'program'; uid: number; owner: PlayerId }
	| { type: 'startTurn'; p: PlayerId }
export interface Source {
	uid: number
	owner: PlayerId
	zone: 'field' | 'legend' | 'gear'
	host?: number
}
export type Listener = (s: GameState, ev: GameEvent, me: Source) => void

/** Tell every card in play (Units, face-up Legends, Gear) that something happened. */
export function emit(s: GameState, ev: GameEvent) {
	const sources: Source[] = []
	for (const p of [0, 1] as PlayerId[]) {
		for (const u of s.players[p].field) {
			sources.push({ uid: u.uid, owner: p, zone: 'field' })
			for (const g of u.gear) sources.push({ uid: g, owner: ownerOf(s, g), zone: 'gear', host: u.uid })
		}
		for (const l of s.players[p].legends) {
			if (l.faceUp) sources.push({ uid: l.uid, owner: p, zone: 'legend' })
			for (const g of l.gear) sources.push({ uid: g, owner: ownerOf(s, g), zone: 'gear', host: l.uid })
		}
	}
	for (const src of sources) LISTENERS[cid(s, src.uid)]?.(s, ev, src)
}

// ───────── activated abilities ({Spend}, €$) ─────────

export interface Ability {
	label: string
	cost?: number | ((s: GameState, p: PlayerId, uid: number) => number)
	/** what gets spent: the card itself, the Unit/Legend the Gear is on, or nothing */
	spend: 'self' | 'host' | false
	quick?: boolean
	key: string
	/** extra requirement; returns why not */
	legal?: (s: GameState, p: PlayerId, uid: number) => string | null
	/** should the computer use it now? */
	bot?: (s: GameState, p: PlayerId, uid: number) => boolean
}
export const abilitiesOf = (s: GameState, uid: number): Ability[] => ABILITIES[cid(s, uid)] ?? []
export function abilityCost(s: GameState, p: PlayerId, uid: number, i: number): number {
	const c = abilitiesOf(s, uid)[i]?.cost ?? 0
	return typeof c === 'function' ? c(s, p, uid) : c
}
/** Why this ability can't be used right now (null = it can). */
export function abilityError(s: GameState, p: PlayerId, uid: number, i: number, reacting: boolean): string | null {
	const ab = abilitiesOf(s, uid)[i]
	if (!ab) return 'No such ability'
	if (reacting && !ab.quick) return 'Only Quick abilities can be used as a reaction'
	const pl = s.players[p]
	const leg = pl.legends.find((l) => l.uid === uid)
	const unit = pl.field.find((u) => u.uid === uid)
	const host = hostOf(s, uid)
	if (leg && !leg.faceUp) return 'Only a face-up Legend’s ability can be used'
	if (!leg && !unit && !(host && ownerOf(s, host.uid) === p)) return 'That card isn’t in play'
	const spendT = ab.spend === 'self' ? (leg ?? unit) : ab.spend === 'host' ? host : undefined
	if (ab.spend && (!spendT || spendT.spent)) return 'It must be ready to spend'
	if (available(s, p, ab.spend ? spendT!.uid : undefined) < abilityCost(s, p, uid, i)) return 'Not enough Eddies'
	return ab.legal?.(s, p, uid) ?? null
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

/** Power a Unit will attack with: "while attacking" bonuses and sure-fire Attack triggers included. */
export function attackPower(s: GameState, uid: number): number {
	const u = findUnit(s, uid)
	if (!u) return 0
	const was = s.attacking
	s.attacking = uid
	let p = unitPower(s, u)
	s.attacking = was
	const o = ownerOf(s, uid)
	if (s.instances[uid].cardId === 'goro-takemura-losing-his-way' && s.players[o].legends.every((l) => l.faceUp)) p += 5
	return Math.max(0, p)
}
