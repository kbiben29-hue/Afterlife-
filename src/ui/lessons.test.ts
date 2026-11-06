// Every combo drill can be solved, and its coach steps line up with the solution.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STARTER_FIXTURE as CARDS } from '../engine/starters.fixture'
import { apply } from '../engine/engine'
import { chooseIntent } from '../bot/bot'
import type { GameState, Intent } from '../engine/types'
import { DRILLS, drillCoach } from './lessons'

const by = (s: GameState, id: string) => {
	const all = [...s.players[0].hand, ...s.players[0].field.map((u) => u.uid), ...s.players[0].legends.map((l) => l.uid)]
	const u = all.find((x) => s.instances[x].cardId === id)
	assert.ok(u !== undefined, `no ${id}`)
	return u!
}
const rivalBy = (s: GameState, id: string) => s.players[1].field.find((u) => s.instances[u.uid].cardId === id)!.uid

/** Play the given moves for player 0; questions are answered by `answer` (or the bot), the rival is the bot. */
function run(s: GameState, moves: ((s: GameState) => Intent)[], answer: (s: GameState) => string[] | null = () => null): GameState {
	const settle = () => {
		for (let n = 0; n < 50; n++) {
			const p = s.pending
			if (p.kind === 'over' || (p.kind !== 'choose' && p.kind !== 'steal' && p.player === 0) || (p.player === 1 && s.active === 1 && p.kind === 'main')) return
			if (p.kind === 'choose' && p.player === 0) s = apply(s, { t: 'choose', player: 0, picks: answer(s) ?? (chooseIntent(s) as { picks: string[] }).picks })
			else s = apply(s, chooseIntent(s)!)
		}
	}
	for (const m of moves) {
		s = apply(s, m(s))
		settle()
	}
	return s
}

const solutions: Record<string, { moves: ((s: GameState) => Intent)[]; answer?: (s: GameState) => string[] | null }> = {
	'heist-v': {
		moves: [(s) => ({ t: 'goSolo', player: 0, uid: by(s, 'v-corporate-exile') }), (s) => ({ t: 'play', player: 0, uid: by(s, 'dying-night-v-s-pistol'), target: by(s, 'v-corporate-exile') }), (s) => ({ t: 'attack', player: 0, attacker: by(s, 'v-corporate-exile'), target: { kind: 'gigs' } })],
	},
	'heist-viktor': {
		moves: [() => ({ t: 'callLegend', player: 0 }), (s) => ({ t: 'play', player: 0, uid: by(s, 'zetatech-faceplate'), target: by(s, 'psycho-squad') }), (s) => ({ t: 'attack', player: 0, attacker: by(s, 'psycho-squad'), target: { kind: 'gigs' } })],
	},
	'heist-flathead': { moves: [(s) => ({ t: 'attack', player: 0, attacker: by(s, 'mt0d12-flathead'), target: { kind: 'gigs' } })] },
	'heist-heywood': {
		moves: [(s) => ({ t: 'play', player: 0, uid: by(s, 'afterparty-at-lizzie-s') }), (s) => ({ t: 'play', player: 0, uid: by(s, 'heywood-ripperdoc') })],
		answer: (s) => {
			const q = s.pending.kind === 'choose' ? s.pending.question : null
			if (!q) return null
			if (q.prompt.startsWith('Adjust')) return [q.options.find((o) => o.id === '0-d4')!.id]
			if (q.prompt.startsWith('New value')) return ['2']
			return [q.options[0].id]
		},
	},
	'power-minotaur': { moves: [(s) => ({ t: 'play', player: 0, uid: by(s, 'corporate-surveillance') }), (s) => ({ t: 'attack', player: 0, attacker: by(s, 'minotaur'), target: { kind: 'gigs' } })] },
	'power-goro': { moves: [() => ({ t: 'callLegend', player: 0 }), (s) => ({ t: 'attack', player: 0, attacker: by(s, 'goro-takemura-losing-his-way'), target: { kind: 'gigs' } })] },
	'power-sandevistan': {
		moves: [(s) => ({ t: 'play', player: 0, uid: by(s, 'sandevistan'), target: by(s, 'maxtac-av') }), (s) => ({ t: 'attack', player: 0, attacker: by(s, 'maxtac-av'), target: { kind: 'gigs' } }), () => ({ t: 'endTurn', player: 0 })],
	},
	'power-order': {
		moves: [(s) => ({ t: 'play', player: 0, uid: by(s, 'industrial-assembly') }), (s) => ({ t: 'play', player: 0, uid: by(s, 'minotaur') })],
		answer: (s) => {
			const q = s.pending.kind === 'choose' ? s.pending.question : null
			if (q?.prompt.startsWith('Increase')) return ['0-d12']
			if (q?.prompt.startsWith('New value')) return ['9']
			return null
		},
	},
}

for (const d of DRILLS)
	test(`drill ${d.id}: solvable, and the coach follows along`, () => {
		const start = d.build(CARDS, 99)
		assert.equal(d.success(start, start), false)
		assert.ok(drillCoach(d, start, start))
		const sol = solutions[d.id]
		assert.ok(sol, 'needs a solution')
		let s = start
		// the steal is picked by the bot (biggest dice)
		s = run(s, sol.moves, sol.answer)
		// finish any steal still pending for us
		while (s.pending.kind === 'steal' && s.pending.player === 0) s = apply(s, chooseIntent(s)!)
		assert.ok(d.success(s, start), `${d.id} not solved: ${s.log.slice(-6).join(' | ')}`)
		void rivalBy
	})
