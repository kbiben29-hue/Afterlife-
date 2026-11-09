// "Street" computer opponent: a simple greedy player. It knows the core rules and the four
// enforced keywords. Scripted cards (effects.ts) carry a score on every choice they offer, so it
// answers their questions and plays scripted Programs; unscripted Programs are sold instead.

import { abilitiesOf, isScripted } from '../engine/effects'
import { available, def, findUnit, hasBlocker, streetCred, unitPower } from '../engine/engine'
import { legalIntents } from '../engine/moves'
import { other, type GameState, type Intent, type PlayerId } from '../engine/types'

const power = (s: GameState, uid: number) => {
	const u = findUnit(s, uid)
	return u ? Math.max(0, unitPower(s, u)) : 0
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
