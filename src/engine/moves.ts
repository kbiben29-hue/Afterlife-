// Every legal intent in a position (used by the computer opponent and the fuzz test).

import { abilitiesOf, abilityError, callCost, goSoloCost, unblockable } from './effects'
import { attackers, attackTargets, available, canPlay, def, hasBlocker, hasKw, hostOf, legalGigDice, mustAttack } from './engine'
import { other, type GameState, type Intent, type PlayerId } from './types'

/** Cards of a player that may have activated abilities: Units, face-up Legends, and Gear on them. */
export function abilityCards(s: GameState, p: PlayerId): number[] {
	const me = s.players[p]
	const out: number[] = []
	for (const h of [...me.field, ...me.legends.filter((l) => l.faceUp)]) {
		out.push(h.uid)
		out.push(...h.gear.filter((g) => s.instances[g].owner === p))
	}
	return out.filter((u) => abilitiesOf(s, u).length > 0)
}

export function legalIntents(s: GameState): Intent[] {
	const pend = s.pending
	if (pend.kind === 'over') return []
	const p = pend.player
	const me = s.players[p]
	const rival = s.players[other(p)]
	const out: Intent[] = []
	const callable = () => !me.calledThisTurn && me.legends.some((l) => !l.faceUp) && available(s, p) >= callCost(s, p)
	const plays = () => {
		for (const uid of me.hand) {
			if (!canPlay(s, p, uid)) continue
			if (def(s, uid).type === 'gear')
				for (const host of [...me.field.map((u) => u.uid), ...me.legends.filter((l) => l.faceUp).map((l) => l.uid)])
					out.push({ t: 'play', player: p, uid, target: host })
			else out.push({ t: 'play', player: p, uid })
		}
	}
	const abilities = (reacting: boolean) => {
		for (const uid of abilityCards(s, p))
			abilitiesOf(s, uid).forEach((_, i) => {
				if (!abilityError(s, p, uid, i, reacting)) out.push({ t: 'activate', player: p, uid, ability: i })
			})
	}
	switch (pend.kind) {
		case 'chooseFirst':
			return [0, 1].map((f) => ({ t: 'chooseFirst', player: p, first: f as PlayerId }))
		case 'mulligan':
			return me.mulliganed ? [{ t: 'mulligan', player: p, redraw: false }] : [true, false].map((redraw) => ({ t: 'mulligan', player: p, redraw }))
		case 'chooseGig':
			return legalGigDice(me).map((d) => ({ t: 'chooseGig', player: p, dieId: d.id }))
		case 'steal':
			return rival.gigs
				.filter((d) => (pend.maxValue === undefined || d.value <= pend.maxValue) && (pend.minValue === undefined || d.value >= pend.minValue))
				.map((d) => ({ t: 'steal', player: p, dieId: d.id }))
		case 'choose': {
			const q = pend.question
			const ids = q.options.map((o) => o.id)
			const best = [...q.options].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).map((o) => o.id)
			const sets: string[][] = []
			if (q.min === 0) sets.push([])
			if (q.min <= 1 && q.max >= 1) for (const id of ids) sets.push([id])
			if (q.max > 1) sets.push(best.slice(0, q.max))
			if (q.min > 1) sets.push(best.slice(0, q.min))
			return sets.map((picks) => ({ t: 'choose', player: p, picks }))
		}
		case 'react':
			out.push({ t: 'pass', player: p })
			for (const u of me.field)
				if (!u.spent && hasBlocker(s, u) && !unblockable(s, pend.attack.attacker) && !(pend.attack.target.kind === 'unit' && pend.attack.target.uid === u.uid))
					out.push({ t: 'block', player: p, blocker: u.uid })
			if (callable()) out.push({ t: 'callLegend', player: p })
			plays()
			abilities(true)
			return out
		case 'main': {
			if (mustAttack(s, p) === undefined) out.push({ t: 'endTurn', player: p })
			if (!me.soldThisTurn) for (const uid of me.hand) if (def(s, uid).sell) out.push({ t: 'sell', player: p, uid })
			if (callable()) out.push({ t: 'callLegend', player: p })
			plays()
			abilities(false)
			for (const l of me.legends) {
				const d = def(s, l.uid)
				if (l.faceUp && hasKw(s, l.uid, 'goSolo') && d.cost !== null && available(s, p, l.uid) >= goSoloCost(s, p, l.uid)) out.push({ t: 'goSolo', player: p, uid: l.uid })
			}
			for (const a of attackers(s, p)) for (const target of attackTargets(s, p, a)) out.push({ t: 'attack', player: p, attacker: a, target })
			return out
		}
	}
}

export { hostOf }
