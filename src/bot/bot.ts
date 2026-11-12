// "Street" computer opponent: a simple greedy player. It knows the core rules and the four
// enforced keywords. Scripted cards (effects.ts) carry a score on every choice they offer, so it
// answers their questions and plays scripted Programs; unscripted Programs are sold instead.

import { abilitiesOf, isScripted } from '../engine/effects'
import { apply, available, def, findUnit, hasBlocker, streetCred, unitPower } from '../engine/engine'
import { legalIntents } from '../engine/moves'
import { other, type GameState, type Intent, type PlayerId } from '../engine/types'

const power = (s: GameState, uid: number) => {
	const u = findUnit(s, uid)
	return u ? Math.max(0, unitPower(s, u)) : 0
}

/** Computer difficulty. Names are what the player sees. */
export type BotLevel = 'easy' | 'hard' | 'expert'
export const BOT_LEVELS: { id: BotLevel; name: string; blurb: string }[] = [
	{ id: 'easy', name: 'Gonk', blurb: 'Easy — blunders a lot' },
	{ id: 'hard', name: 'Street Samurai', blurb: 'Hard — sharp and steady' },
	{ id: 'expert', name: 'Blackwall', blurb: 'Expert — thinks a turn ahead' },
]

/** Pick a move at a difficulty. Deterministic: "random" mistakes come from the game's own seed. */
export function botIntent(s: GameState, level: BotLevel = 'hard'): Intent | null {
	if (level === 'easy') return easyIntent(s)
	if (level === 'expert') return expertIntent(s)
	return chooseIntent(s)
}

export function chooseIntent(s: GameState): Intent | null {
	const moves = legalIntents(s)
	if (moves.length === 0) return null
	const pend = s.pending
	if (pend.kind === 'over') return null
	const p = pend.player as PlayerId
	const me = s.players[p]
	const pick = <T extends Intent['t']>(t: T) => moves.filter((m) => m.t === t) as Extract<Intent, { t: T }>[]

	switch (pend.kind) {
		case 'choose': {
			const q = pend.question
			const ranked = [...q.options].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
			const n = Math.max(q.min, Math.min(q.max, ranked.filter((o) => (o.score ?? 0) > 0).length))
			return { t: 'choose', player: p, picks: ranked.slice(0, n).map((o) => o.id) }
		}
		case 'chooseFirst':
			return { t: 'chooseFirst', player: p, first: p }
		case 'mulligan': {
			const cheap = me.hand.filter((u) => (def(s, u).cost ?? 9) <= 3).length
			return { t: 'mulligan', player: p, redraw: !me.mulliganed && cheap < 2 }
		}
		case 'chooseGig':
			// Take small dice early; keep the big ones for later turns.
			return pick('chooseGig').sort((a, b) => parseInt(a.dieId.split('d')[1]) - parseInt(b.dieId.split('d')[1]))[0]
		case 'steal': {
			const rival = s.players[other(p)]
			const best = rival.gigs.filter((d) => pend.maxValue === undefined || d.value <= pend.maxValue).sort((a, b) => b.value - a.value)[0]
			return { t: 'steal', player: p, dieId: best.id }
		}
		case 'react': {
			const atk = pend.attack
			const ap = power(s, atk.attacker)
			const blocks = pick('block').sort((a, b) => power(s, b.blocker) - power(s, a.blocker))
			if (atk.target.kind === 'gigs' && blocks.length > 0 && me.gigs.length > 0) return blocks[0]
			if (atk.target.kind === 'unit') {
				const surviving = blocks.find((b) => power(s, b.blocker) > ap)
				if (surviving) return surviving
			}
			// Quick Programs: Floor It to drop a steal or win a tie, Reboot Optics to save a Unit.
			const quick = (id: string) => pick('play').find((m) => def(s, m.uid).id === id)
			const fi = quick('floor-it')
			const myTarget = atk.target.kind === 'unit' ? atk.target.uid : null
			if (fi && ((atk.target.kind === 'gigs' && ap >= 10 && ap % 10 === 0 && me.gigs.length > 1) || (myTarget !== null && power(s, myTarget) === ap))) return fi
			const ro = quick('reboot-optics')
			if (ro && myTarget !== null && power(s, myTarget) <= ap && (def(s, myTarget).cost ?? 0) >= 4) return ro
			return { t: 'pass', player: p }
		}
		case 'main':
			break
	}

	// Main phase.
	const sells = pick('sell')
	if (sells.length > 0 && me.hand.length >= 2) {
		const progs = sells.filter((m) => def(s, m.uid).type === 'program' && !isScripted(def(s, m.uid).id))
		const avail = available(s, p)
		const pricey = sells.filter((m) => (def(s, m.uid).cost ?? 0) > avail + 1)
		const choice = (progs.length ? progs : pricey.length ? pricey : sells).sort((a, b) => (def(s, b.uid).cost ?? 0) - (def(s, a.uid).cost ?? 0))[0]
		return choice
	}

	const rival = s.players[other(p)]
	for (const a of pick('attack').filter((m) => m.target.kind === 'unit')) {
		const t = (a.target as { uid: number }).uid
		if (power(s, a.attacker) > power(s, t)) return a
	}
	const plays = pick('play').filter((m) => def(s, m.uid).type !== 'program')
	const programs = pick('play').filter((m) => def(s, m.uid).type === 'program' && isScripted(def(s, m.uid).id) && programWorth(s, p, m.uid))
	if (programs.length) return programs[0]
	const units = plays.filter((m) => def(s, m.uid).type === 'unit').sort((a, b) => (def(s, b.uid).cost ?? 0) - (def(s, a.uid).cost ?? 0))
	if (units.length) return units[0]
	const solo = pick('goSolo')
	if (solo.length) return solo[0]
	const gear = plays
		.filter((m) => m.target !== undefined && me.field.some((u) => u.uid === m.target))
		.sort((a, b) => power(s, b.target!) - power(s, a.target!))
	if (gear.length) return gear[0]

	const rivalBlockers = rival.field.filter((u) => !u.spent && hasBlocker(s, u))
	for (const a of pick('attack').filter((m) => m.target.kind === 'gigs')) {
		if (rival.gigs.length === 0) break
		const ap = power(s, a.attacker)
		if (ap === 0) continue
		if (rivalBlockers.some((b) => power(s, b.uid) >= ap)) continue
		return a
	}
	if (pick('callLegend').length && available(s, p) >= 1) return { t: 'callLegend', player: p }
	const acts = pick('activate').filter((m) => abilitiesOf(s, m.uid)[m.ability]?.bot?.(s, p, m.uid))
	if (acts.length) return acts[0]
	if (pick('endTurn').length) return { t: 'endTurn', player: p }
	// a Unit is forced to attack: do it (Gigs if possible)
	const forced = pick('attack')
	return forced.find((m) => m.target.kind === 'gigs') ?? forced[0] ?? moves[0]
}

/** Is a scripted Program worth casting right now? (avoid wasting removal with no targets) */
function programWorth(s: GameState, p: PlayerId, uid: number): boolean {
	const id = def(s, uid).id
	const me = s.players[p]
	const rival = s.players[other(p)]
	switch (id) {
		case 'corporate-surveillance':
			return rival.field.some((u) => !u.spent && (def(s, u.uid).cost ?? 0) <= 4) && me.field.some((u) => !u.spent && !u.lag)
		case 'over-the-edge': {
			const d20 = me.gigs.find((d) => d.sides === 20)
			return !!d20 && rival.field.some((u) => power(s, u.uid) <= d20.value)
		}
		case 'shattered-memories':
			return me.hand.length <= 2 && rival.hand.length >= 3
		case 'reboot-optics':
		case 'floor-it':
			return s.pending.kind === 'react' || id === 'floor-it'
		case 'industrial-assembly':
		case 'afterparty-at-lizzie-s':
			return me.gigs.length > 0 || rival.gigs.length > 0
	}
	void streetCred
	return true
}

// ───────── Easy ("Gonk"): the normal bot, but it blunders a lot ─────────

/** A number in [0, 1) from the position, so the same game replays the same way. */
function noise(s: GameState, salt: number): number {
	let h = (s.rng ^ Math.imul(s.log.length + 1, 0x9e3779b1) ^ Math.imul(salt + 7, 0x85ebca6b)) >>> 0
	h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0
	h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
function easyIntent(s: GameState): Intent | null {
	const best = chooseIntent(s)
	const pend = s.pending
	if (!best || pend.kind === 'over' || pend.kind === 'chooseFirst' || pend.kind === 'mulligan') return best
	const moves = legalIntents(s).filter((m) => m.t !== 'concede' && m.t !== 'manual')
	if (moves.length < 2) return best
	// forgets to block, skips good plays, wanders into bad attacks
	if (pend.kind === 'react' && best.t === 'block' && noise(s, 1) < 0.6) return { t: 'pass', player: pend.player }
	if (pend.kind === 'main' && noise(s, 2) < 0.35) {
		const sloppy = moves.filter((m) => m.t !== 'endTurn')
		if (sloppy.length) return sloppy[Math.floor(noise(s, 3) * sloppy.length)]
	}
	if (pend.kind === 'main' && best.t !== 'endTurn' && noise(s, 4) < 0.2) return moves.find((m) => m.t === 'endTurn') ?? best
	if (pend.kind === 'choose' && noise(s, 5) < 0.4) return moves[Math.floor(noise(s, 6) * moves.length)]
	return best
}

// ───────── Expert ("Blackwall"): tries each option, plays the turn out, keeps the best ─────────

/** How good a position is for player p (bigger is better). */
export function evaluate(s: GameState, p: PlayerId): number {
	if (s.pending.kind === 'over') return s.pending.winner === p ? 100000 : -100000
	const me = s.players[p]
	const rv = s.players[other(p)]
	const cred = (x: number | null) => x ?? 0
	const board = (pl: typeof me) => pl.field.reduce((a, u) => a + Math.max(0, unitPower(s, u)) + (hasBlocker(s, u) && !u.spent ? 2 : 0) + u.gear.length, 0)
	// what their Units could steal next turn, minus what my ready Blockers can stop
	const threat = (att: typeof me, defn: typeof me) => {
		const steals = att.field
			.map((u) => {
				const pw = Math.max(0, unitPower(s, u))
				return pw === 0 ? 0 : Math.floor(pw / 10) + 1
			})
			.sort((a, b) => b - a)
		const blockers = defn.field.filter((u) => !u.spent && hasBlocker(s, u)).length
		return Math.min(defn.gigs.length, steals.slice(blockers).reduce((a, n) => a + n, 0))
	}
	// spent Units the rival can attack and beat
	const exposed = (pl: typeof me, foe: typeof me) =>
		pl.field.filter((u) => u.spent && foe.field.some((f) => Math.max(0, unitPower(s, f)) >= Math.max(1, unitPower(s, u)))).reduce((a, u) => a + Math.max(1, unitPower(s, u)) * 0.6, 0)
	let v = 0
	v += 30 * (me.gigs.length - rv.gigs.length)
	if (me.gigs.length >= 6) v += 25
	if (rv.gigs.length >= 6) v -= 25
	v += 0.4 * (cred(streetCred(me)) - cred(streetCred(rv)))
	v += 1.2 * (board(me) - board(rv))
	v += 2.2 * (me.hand.length - rv.hand.length)
	v += 1.5 * (me.eddies.length - rv.eddies.length)
	v += 2 * (me.legends.filter((l) => l.faceUp).length - rv.legends.filter((l) => l.faceUp).length)
	v -= 12 * threat(rv, me)
	v += 6 * threat(me, rv)
	v -= exposed(me, rv)
	v += 0.5 * exposed(rv, me)
	if (me.deck.length < 4) v -= 20
	return v
}

/** Play on with the normal bot until the given condition (or the game) ends. */
function rollout(s: GameState, until: (x: GameState) => boolean, cap = 160): GameState {
	let x = s
	for (let n = 0; n < cap && x.pending.kind !== 'over' && !until(x); n++) {
		const i = chooseIntent(x)
		if (!i) break
		try {
			x = apply(x, i)
		} catch {
			break
		}
	}
	return x
}

function expertIntent(s: GameState): Intent | null {
	const greedy = chooseIntent(s)
	const pend = s.pending
	if (!greedy || pend.kind === 'over') return greedy
	const p = pend.player as PlayerId
	// simple decisions: the normal answer is fine
	if (pend.kind !== 'main' && pend.kind !== 'react' && pend.kind !== 'steal' && pend.kind !== 'choose') return greedy
	const active = s.active
	const moves = legalIntents(s).filter((m) => m.t !== 'concede' && m.t !== 'manual')
	if (moves.length < 2) return greedy
	// how far to look: to the end of this turn (or of this attack, when reacting on the rival's turn)
	// on my turn: through the rival's whole reply, so threats are seen for real
	let left = false
	const done = (x: GameState) => {
		if (x.pending.kind === 'over') return true
		if (pend.kind === 'react' && active !== p) return x.pending.kind === 'main' && x.active === active
		if (x.active !== active) left = true
		return left && x.active === active
	}
	// keep it quick: the greedy move plus a varied sample of the rest
	const pool = [greedy, ...moves.filter((m) => JSON.stringify(m) !== JSON.stringify(greedy))]
	const byType = new Map<string, Intent[]>()
	for (const m of pool) byType.set(m.t, [...(byType.get(m.t) ?? []), m])
	const cands: Intent[] = [greedy]
	for (let round = 0; cands.length < 18 && round < 6; round++) for (const list of byType.values()) if (list[round] && !cands.includes(list[round])) cands.push(list[round])
	let best = greedy
	let bestV = -Infinity
	for (const m of cands) {
		let x: GameState
		try {
			x = apply(s, m)
		} catch {
			continue
		}
		left = false
		x = rollout(x, done, 400)
		// a small bonus for the move the greedy bot already likes, to break ties sensibly
		const v = evaluate(x, p) + (m === greedy ? 0.5 : 0)
		if (v > bestV) {
			bestV = v
			best = m
		}
	}
	return best
}
