import { useState } from 'react'
import { parseDeckList, randomDeck, validateDeck } from '../engine/decks'
import { COLORS, type Color, type DeckList } from '../engine/types'
import type { CardPool } from '../data/cards'

export interface SetupResult {
	names: [string, string]
	bot: boolean
	tutorial?: boolean
	online?: 'host' | 'guest'
	decks: [DeckList, DeckList]
	seed: number
}

type DeckMode = { mode: 'random'; colors: [Color, Color] | 'any' } | { mode: 'paste'; text: string }

function DeckPicker({ pool, value, onChange, label }: { pool: CardPool; value: DeckMode; onChange: (v: DeckMode) => void; label: string }) {
	const usable = COLORS.filter((c) => Object.values(pool.cards).some((d) => d.type === 'legend' && d.color === c))
	const pairs: [Color, Color][] = []
	for (let i = 0; i < usable.length; i++) for (let j = i; j < usable.length; j++) pairs.push([usable[i], usable[j]])
	let problems: string[] = []
	if (value.mode === 'paste') {
		const { deck, unknown } = parseDeckList(pool.cards, value.text)
		problems = [...unknown.map((u) => `Not found: ${u}`), ...validateDeck(pool.cards, deck)]
	}
	return (
		<div className="deck-picker">
			<div className="dp-label">{label} deck</div>
			<div className="seg">
				<button className={value.mode === 'random' ? 'on' : ''} onClick={() => onChange({ mode: 'random', colors: 'any' })}>
					Random
				</button>
				<button className={value.mode === 'paste' ? 'on' : ''} onClick={() => onChange({ mode: 'paste', text: '' })}>
					Paste a list
				</button>
			</div>
			{value.mode === 'random' ? (
				<select value={value.colors === 'any' ? 'any' : value.colors.join('/')} onChange={(e) => onChange({ mode: 'random', colors: e.target.value === 'any' ? 'any' : (e.target.value.split('/') as [Color, Color]) })}>
					<option value="any">Any colours</option>
					{pairs.map((p) => (
						<option key={p.join('/')} value={p.join('/')}>
							{p[0] === p[1] ? p[0] : `${p[0]} / ${p[1]}`}
						</option>
					))}
				</select>
			) : (
				<>
					<textarea placeholder={'One card per line, e.g.\n1 V — Streetkid\n3 Ruthless Lowlife'} value={value.text} onChange={(e) => onChange({ mode: 'paste', text: e.target.value })} />
					<div className={problems.length ? 'problems' : 'ok'}>{problems.length ? problems.slice(0, 4).join(' · ') : 'Deck is legal ✓'}</div>
				</>
			)}
		</div>
	)
}

export function Setup({
	pool,
	onStart,
	onResume,
	canResume,
	joinCode,
	resumeLabel,
}: {
	pool: CardPool
	onStart: (r: SetupResult) => void
	onResume: () => void
	canResume: boolean
	/** set when the page was opened from a friend's invite link */
	joinCode?: string | null
	resumeLabel?: string
}) {
	const [bot, setBot] = useState(true)
	const [online, setOnline] = useState(false)
	const [names, setNames] = useState<[string, string]>([joinCode ? 'Player 2' : 'Player 1', 'Street AI'])
	const [decks, setDecks] = useState<[DeckMode, DeckMode]>([
		{ mode: 'random', colors: 'any' },
		{ mode: 'random', colors: 'any' },
	])
	const build = (m: DeckMode, seed: number): DeckList | null => {
		if (m.mode === 'random') return randomDeck(pool.cards, seed, m.colors === 'any' ? undefined : m.colors)
		const { deck, unknown } = parseDeckList(pool.cards, m.text)
		return unknown.length || validateDeck(pool.cards, deck).length ? null : deck
	}
	const start = (tutorial = false) => {
		const seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0
		const d0 = build(decks[0], seed + 1)
		const d1 = build(decks[1], seed + 2)
		if (!d0 || !d1) return
		if (joinCode) onStart({ names: [names[0] || 'Player 2', ''], bot: false, online: 'guest', decks: [d0, d0], seed })
		else if (online && !tutorial) onStart({ names: [names[0] || 'Player 1', ''], bot: false, online: 'host', decks: [d0, d0], seed })
		else if (tutorial) onStart({ names: [names[0] || 'You', 'Street AI'], bot: true, tutorial: true, decks: [d0, d1], seed })
		else onStart({ names: [names[0] || 'Player 1', names[1] || 'Player 2'], bot, decks: [d0, d1], seed })
	}
	return (
		<div className="setup">
			<h1>
				AFTER<span>LIFE</span>
			</h1>
			<p className="tag">An unofficial table for the Cyberpunk Trading Card Game</p>
			<div className={`source ${pool.source}`}>
				{pool.source === 'database'
					? `Card database loaded: ${Object.keys(pool.cards).length} cards`
					: pool.source === 'online'
						? `Cards loaded from the official database: ${Object.keys(pool.cards).length}${pool.note ? ` (${pool.note})` : ''}`
						: `Placeholder cards${pool.note ? ` — ${pool.note}` : ''}`}
			</div>
			{joinCode ? (
				<div className="join-banner">
					You’ve been invited to an online game <b>({joinCode})</b>. Pick your name and deck, then join.
				</div>
			) : (
				<div className="seg big">
					<button className={bot && !online ? 'on' : ''} onClick={() => (setBot(true), setOnline(false), setNames([names[0], 'Street AI']))}>
						vs Computer
					</button>
					<button className={!bot && !online ? 'on' : ''} onClick={() => (setBot(false), setOnline(false), setNames([names[0], 'Player 2']))}>
						Two players, one screen
					</button>
					<button className={online ? 'on' : ''} onClick={() => (setBot(false), setOnline(true))}>
						Play a friend online
					</button>
				</div>
			)}
			<div className="players">
				{(joinCode || online ? [0] : [0, 1]).map((i) => (
					<div key={i} className="player-setup">
						<input value={names[i]} onChange={(e) => setNames(i === 0 ? [e.target.value, names[1]] : [names[0], e.target.value])} />
						<DeckPicker pool={pool} label={names[i]} value={decks[i]} onChange={(v) => setDecks(i === 0 ? [v, decks[1]] : [decks[0], v])} />
					</div>
				))}
			</div>
			<div className="setup-buttons">
				<button className="primary" onClick={() => start()}>
					{joinCode ? 'Join game' : online ? 'Create invite link' : 'Jack in'}
				</button>
				{!joinCode && (
					<button className="tutorial-btn" onClick={() => start(true)}>
						Tutorial: practice game
					</button>
				)}
				{canResume && !joinCode && <button onClick={onResume}>{resumeLabel ?? 'Resume saved game'}</button>}
			</div>
		</div>
	)
}
