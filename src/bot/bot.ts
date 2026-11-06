// "Street" computer opponent: a simple greedy player. It knows the core rules and the four
// enforced keywords, but it does not read card text, and it never plays Programs (their effects
// are applied by hand), so it sells them instead.

import { available, def, findUnit, unitPower } from '../engine/engine'
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
			const best = [...rival.gigs].sort((a, b) => b.value - a.value)[0]
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
			return { t: 'pass', player: p }
		}
		case 'main':
			break
	}

	// Main phase.
	const sells = pick('sell')
	if (sells.length > 0 && me.hand.length >= 2) {
		const progs = sells.filter((m) => def(s, m.uid).type === 'program')
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
	const units = plays.filter((m) => def(s, m.uid).type === 'unit').sort((a, b) => (def(s, b.uid).cost ?? 0) - (def(s, a.uid).cost ?? 0))
	if (units.length) return units[0]
	const solo = pick('goSolo')
	if (solo.length) return solo[0]
	const gear = plays
		.filter((m) => m.target !== undefined && me.field.some((u) => u.uid === m.target))
		.sort((a, b) => power(s, b.target!) - power(s, a.target!))
	if (gear.length) return gear[0]

	const rivalBlockers = rival.field.filter((u) => !u.spent && def(s, u.uid).keywords.includes('blocker'))
	for (const a of pick('attack').filter((m) => m.target.kind === 'gigs')) {
		if (rival.gigs.length === 0) break
		const ap = power(s, a.attacker)
		if (ap === 0) continue
		if (rivalBlockers.some((b) => power(s, b.uid) >= ap)) continue
		return a
	}
	if (pick('callLegend').length && available(s, p) >= 1) return { t: 'callLegend', player: p }
	return { t: 'endTurn', player: p }
}
