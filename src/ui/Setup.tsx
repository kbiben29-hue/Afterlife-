// Home screen: mode tabs (a friend / vs computer / hotseat / learn), deck cards with the three
// Legends' art, one big Start button. A real responsive page (not the scaled table).

import { useState, type ReactNode } from 'react'
import { parseDeckList, randomDeck, ramLimits, validateDeck } from '../engine/decks'
import { COLORS, type Color, type DeckList } from '../engine/types'
import type { CardPool } from '../data/cards'
import { starterDeck, STARTERS } from '../data/starters'
import { drillsFor, type DeckId } from './lessons'
import { CardFace } from './Card'
import { STARTER_FIXTURE } from '../engine/starters.fixture'

export interface SetupResult {
	names: [string, string]
	bot: boolean
	tutorial?: boolean
	/** deck lessons: a coached game with a starter deck, or one combo drill */
	lesson?: { deck: DeckId; drill?: string }
	online?: 'host' | 'guest'
	decks: [DeckList, DeckList]
	seed: number
}

type DeckMode = { mode: 'random'; colors: [Color, Color] | 'any' } | { mode: 'paste'; text: string } | { mode: 'starter'; id: DeckId }
type Tab = 'friend' | 'bot' | 'hotseat' | 'learn'

// ───────── small pieces ─────────

const Icon = ({ name }: { name: Tab | 'cap' | 'play' | 'resume' }) => {
	const p = { width: 26, height: 26, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
	switch (name) {
		case 'friend':
			return (
				<svg {...p}>
					<circle cx="9" cy="8" r="3.5" />
					<path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M18 7v6M15 10h6" />
				</svg>
			)
		case 'bot':
			return (
				<svg {...p}>
					<rect x="5" y="5" width="14" height="14" rx="1.5" />
					<rect x="9" y="9" width="6" height="6" />
					<path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
				</svg>
			)
		case 'hotseat':
			return (
				<svg {...p}>
					<rect x="3" y="4" width="18" height="12" rx="1" />
					<path d="M8 20h8M12 16v4M8 10h2M14 10h2" />
				</svg>
			)
		case 'learn':
		case 'cap':
			return (
				<svg {...p}>
					<path d="M2 9l10-5 10 5-10 5z" />
					<path d="M6 11v5c2 2 10 2 12 0v-5" />
				</svg>
			)
		case 'play':
			return (
				<svg {...p}>
					<path d="M7 4l13 8-13 8z" />
				</svg>
			)
		case 'resume':
			return (
				<svg {...p}>
					<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" />
				</svg>
			)
	}
}

const COLOR_HEX: Record<Color, string> = { red: '#d8323c', green: '#2f9e5a', blue: '#2f6fd8', yellow: '#c9b53a' }

/** RAM badges (x4 / x2) for a deck's Legends. */
function RamBadges({ pool, legends }: { pool: CardPool; legends: string[] }) {
	const ram = ramLimits({ ...STARTER_FIXTURE, ...pool.cards }, legends)
	return (
		<span className="ram-badges">
			{COLORS.filter((c) => ram[c] > 0)
				.sort((a, b) => ram[b] - ram[a])
				.map((c) => (
					<span key={c} className="ram-badge" style={{ ['--c' as string]: COLOR_HEX[c] }}>
						x{ram[c]}
					</span>
				))}
		</span>
	)
}

/** The three Legends' art side by side with slanted cuts, like a deck box. */
function LegendStrip({ pool, legends }: { pool: CardPool; legends: string[] }) {
	return (
		<div className="legend-strip">
			{legends.map((id) => {
				const d = pool.cards[id]
				return <div key={id} className={`ls-panel c-${d?.color ?? STARTER_FIXTURE[id]?.color ?? 'none'}`}>{d?.image ? <CardFace d={d} /> : <span className="ls-name">{(d ?? STARTER_FIXTURE[id])?.name ?? ''}</span>}</div>
			})}
		</div>
	)
}

function DeckCard({ title, sub, art, badges, on, color, onClick, children }: { title: string; sub?: string; art?: ReactNode; badges?: ReactNode; on: boolean; color?: string; onClick: () => void; children?: ReactNode }) {
	return (
		<div className={`deck-card ${on ? 'on' : ''}`} style={color ? { ['--deck' as string]: color } : undefined}>
			<button className="dc-main" onClick={onClick}>
				{art}
				<div className="dc-bar">
					<span className="dc-title">
						{title}
						{sub && <small>{sub}</small>}
					</span>
					{badges}
					<span className="dc-check">{on ? '✓' : ''}</span>
				</div>
			</button>
			{on && children}
		</div>
	)
}

function DeckPicker({ pool, value, onChange }: { pool: CardPool; value: DeckMode; onChange: (v: DeckMode) => void }) {
	const usable = COLORS.filter((c) => Object.values(pool.cards).some((d) => d.type === 'legend' && d.color === c))
	const pairs: [Color, Color][] = []
	for (let i = 0; i < usable.length; i++) for (let j = i; j < usable.length; j++) pairs.push([usable[i], usable[j]])
	let problems: string[] = []
	if (value.mode === 'paste') {
		const { deck, unknown } = parseDeckList(pool.cards, value.text)
		problems = [...unknown.map((u) => `Not found: ${u}`), ...validateDeck(pool.cards, deck)]
	}
	return (
		<div className="deck-list">
			{STARTERS.map((d) => {
				const ram = ramLimits({ ...STARTER_FIXTURE, ...pool.cards }, d.legends)
				const main = COLORS.reduce((a, c) => (ram[c] > ram[a] ? c : a), 'red' as Color)
				return (
					<DeckCard
						key={d.id}
						title={d.name}
						on={value.mode === 'starter' && value.id === d.id}
						color={COLOR_HEX[main]}
						onClick={() => onChange({ mode: 'starter', id: d.id })}
						art={<LegendStrip pool={pool} legends={d.legends} />}
						badges={<RamBadges pool={pool} legends={d.legends} />}
					/>
				)
			})}
			<DeckCard title="Random deck" sub="Built from the whole card pool" on={value.mode === 'random'} onClick={() => onChange({ mode: 'random', colors: 'any' })}>
				{value.mode === 'random' && (
					<select className="dc-extra" value={value.colors === 'any' ? 'any' : value.colors.join('/')} onChange={(e) => onChange({ mode: 'random', colors: e.target.value === 'any' ? 'any' : (e.target.value.split('/') as [Color, Color]) })}>
						<option value="any">Any colours</option>
						{pairs.map((p) => (
							<option key={p.join('/')} value={p.join('/')}>
								{p[0] === p[1] ? p[0] : `${p[0]} / ${p[1]}`}
							</option>
						))}
					</select>
				)}
			</DeckCard>
			<DeckCard title="Paste a deck list" sub="One card per line, with counts" on={value.mode === 'paste'} onClick={() => onChange({ mode: 'paste', text: '' })}>
				{value.mode === 'paste' && (
					<div className="dc-extra">
						<textarea placeholder={'One card per line, e.g.\n1 V — Streetkid\n3 Ruthless Lowlife'} value={value.text} onChange={(e) => onChange({ mode: 'paste', text: e.target.value })} />
						<div className={problems.length ? 'problems' : 'ok'}>{problems.length ? problems.slice(0, 4).join(' · ') : 'Deck is legal ✓'}</div>
					</div>
				)}
			</DeckCard>
		</div>
	)
}

// ───────── the screen ─────────

export function Setup({
	pool,
	onStart,
	onResume,
	canResume,
	joinCode,
	resumeLabel,
	initialLessons,
}: {
	initialLessons?: boolean
	pool: CardPool
	onStart: (r: SetupResult) => void
	onResume: () => void
	canResume: boolean
	/** set when the page was opened from a friend's invite link */
	joinCode?: string | null
	resumeLabel?: string
}) {
	const [tab, setTab] = useState<Tab>(initialLessons ? 'learn' : joinCode ? 'friend' : 'bot')
	const [names, setNames] = useState<[string, string]>([joinCode ? 'Player 2' : 'Player 1', 'Street AI'])
	const [decks, setDecks] = useState<[DeckMode, DeckMode]>([
		{ mode: 'starter', id: 'power' },
		{ mode: 'starter', id: 'heist' },
	])
	const build = (m: DeckMode, seed: number): DeckList | null => {
		if (m.mode === 'random') return randomDeck(pool.cards, seed, m.colors === 'any' ? undefined : m.colors)
		if (m.mode === 'starter') return starterDeck(m.id)
		const { deck, unknown } = parseDeckList(pool.cards, m.text)
		return unknown.length || validateDeck(pool.cards, deck).length ? null : deck
	}
	const newSeed = () => (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0
	const startLesson = (deck: DeckId, drill?: string) => {
		const other: DeckId = deck === 'heist' ? 'power' : 'heist'
		onStart({ names: [names[0] || 'You', 'Street AI'], bot: true, tutorial: true, lesson: { deck, drill }, decks: [starterDeck(deck), starterDeck(other)], seed: newSeed() })
	}
	const start = (tutorial = false) => {
		const seed = newSeed()
		const d0 = build(decks[0], seed + 1)
		const d1 = build(decks[1], seed + 2)
		if (!d0 || !d1) return
		if (joinCode) onStart({ names: [names[0] || 'Player 2', ''], bot: false, online: 'guest', decks: [d0, d0], seed })
		else if (tutorial) onStart({ names: [names[0] || 'You', 'Street AI'], bot: true, tutorial: true, decks: [d0, d1], seed })
		else if (tab === 'friend') onStart({ names: [names[0] || 'Player 1', ''], bot: false, online: 'host', decks: [d0, d0], seed })
		else if (tab === 'hotseat') onStart({ names: [names[0] || 'Player 1', names[1] || 'Player 2'], bot: false, decks: [d0, d1], seed })
		else onStart({ names: [names[0] || 'Player 1', 'Street AI'], bot: true, decks: [d0, d1], seed })
	}
	const setTabAnd = (t: Tab) => {
		setTab(t)
		if (t === 'hotseat' && names[1] === 'Street AI') setNames([names[0], 'Player 2'])
		if (t === 'bot') setNames([names[0], 'Street AI'])
	}

	const cardCount = Object.keys(pool.cards).length
	const drillCount = STARTERS.reduce((a, d) => a + drillsFor(d.id).length, 0)
	const TABS: { id: Tab; label: string }[] = joinCode
		? [{ id: 'friend', label: 'A friend' }]
		: [
				{ id: 'friend', label: 'A friend' },
				{ id: 'bot', label: 'Computer' },
				{ id: 'hotseat', label: 'Hotseat' },
				{ id: 'learn', label: 'Learn' },
			]
	const DESC: Record<Tab, string> = {
		friend: joinCode ? 'You’ve been invited. Pick a name and deck, then join.' : 'Send a link — your friend plays from their own phone or computer.',
		bot: 'Play the Street AI. Every card’s abilities run by themselves.',
		hotseat: 'Two players, one screen. Pass the device between turns.',
		learn: 'Learn the two starter decks: a coached game and combo drills for each.',
	}
	const playerBlock = (i: 0 | 1, label: string) => (
		<div className="pl-block" key={i}>
			<div className="pl-head">
				<span className="eyebrow">{label}</span>
				<input value={names[i]} onChange={(e) => setNames(i === 0 ? [e.target.value, names[1]] : [names[0], e.target.value])} aria-label={`${label} name`} />
			</div>
			<DeckPicker pool={pool} value={decks[i]} onChange={(v) => setDecks(i === 0 ? [v, decks[1]] : [decks[0], v])} />
		</div>
	)

	return (
		<div className="home">
			<header className="home-top">
				<div className="wordmark">
					AFTER<span>LIFE</span>
				</div>
				<span className={`src-pill ${pool.source}`}>
					<i />
					{pool.source === 'placeholder' ? 'Placeholder cards' : `${cardCount} cards`}
				</span>
			</header>
			{joinCode && (
				<div className="home-strip">
					<Icon name="friend" />
					<span>
						Invited to game <b>{joinCode}</b>
					</span>
				</div>
			)}

			<main className="home-main">
				<h1 className="display">{tab === 'learn' ? 'LEARN' : 'PLAY'}</h1>
				<div className="statline">
					<span>
						<i className="dot" /> <b className="g">{cardCount}</b> cards
					</span>
					<span>
						<b className="y">{STARTERS.length}</b> starter decks
					</span>
					<span>
						<b className="c">{drillCount}</b> combo drills
					</span>
				</div>
				<div className="statline-bar">
					<span />
				</div>

				<nav className="mode-tabs" role="tablist">
					{TABS.map((t) => (
						<button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTabAnd(t.id)}>
							<Icon name={t.id} />
							<span>{t.label}</span>
						</button>
					))}
				</nav>
				<p className="mode-desc">{DESC[tab]}</p>

				{tab === 'learn' ? (
					<section className="panel">
						<div className="panel-head">
							<h2>Deck lessons</h2>
							<span className="chip">Every card automated</span>
						</div>
						<div className="callout">
							<Icon name="cap" />
							<div>
								<b>Never played? Start here.</b>
								<p>A guided practice game against the Street AI. The coach explains every step and makes the next good move glow.</p>
							</div>
							<button onClick={() => start(true)}>Play the tutorial</button>
						</div>
						<div className="lesson-decks">
							{STARTERS.map((d) => (
								<div key={d.id} className={`lesson-deck ${d.id}`}>
									<LegendStrip pool={pool} legends={d.legends} />
									<div className="dc-bar">
										<span className="dc-title">
											{d.name}
											<small>{d.colors}</small>
										</span>
										<RamBadges pool={pool} legends={d.legends} />
									</div>
									<button className="primary" onClick={() => startLesson(d.id)}>
										Coached game
										<small>The game plan, then a full game with combo alerts</small>
									</button>
									<div className="eyebrow">Combo drills</div>
									{drillsFor(d.id).map((dr, i) => (
										<button key={dr.id} className="drill-btn" onClick={() => startLesson(d.id, dr.id)}>
											<b>{i + 1}.</b> {dr.title}
											<small>{dr.goal}</small>
										</button>
									))}
								</div>
							))}
						</div>
					</section>
				) : (
					<section className="panel">
						<div className="panel-head">
							<h2>{tab === 'friend' ? (joinCode ? 'Join a friend' : 'Invite a friend') : tab === 'hotseat' ? 'Hotseat' : 'Play the computer'}</h2>
							<span className="chip">{tab === 'friend' ? 'Online' : 'Offline'}</span>
						</div>
						{tab === 'bot' && (
							<div className="callout">
								<Icon name="cap" />
								<div>
									<b>Never played? Start here.</b>
									<p>A guided game with a coach that explains each step: Gigs, Eddies, Gear, Programs, attacking, blocking, Calling a Legend and going Solo.</p>
								</div>
								<button onClick={() => start(true)}>Play the tutorial</button>
							</div>
						)}
						<div className="players-grid">
							{playerBlock(0, tab === 'friend' ? 'You' : 'Player 1')}
							{tab === 'hotseat' && playerBlock(1, 'Player 2')}
							{tab === 'bot' && playerBlock(1, 'Street AI')}
						</div>
						<p className="fine">{tab === 'friend' ? 'Your friend picks their own deck when they open the link.' : tab === 'hotseat' ? 'A second player on this device.' : 'The computer uses the deck you pick for it.'}</p>
						<button className="primary big-start" onClick={() => start()}>
							{joinCode ? 'Join game' : tab === 'friend' ? 'Create invite link' : tab === 'hotseat' ? 'Start hotseat' : 'Jack in'}
						</button>
					</section>
				)}

				{canResume && !joinCode && (
					<button className="resume-card" onClick={onResume}>
						<Icon name="resume" />
						<span>{resumeLabel ?? 'Resume saved game'}</span>
					</button>
				)}
				<p className="home-foot">An unofficial fan table for the Cyberpunk Trading Card Game. Not affiliated with WeirdCo or CD PROJEKT RED.</p>
			</main>

			{!joinCode && (
				<nav className="home-nav">
					<button className={tab !== 'learn' ? 'on' : ''} onClick={() => setTabAnd(tab === 'learn' ? 'bot' : tab)}>
						<Icon name="play" />
						<span>Play</span>
					</button>
					<button className={tab === 'learn' ? 'on' : ''} onClick={() => setTabAnd('learn')}>
						<Icon name="learn" />
						<span>Learn</span>
					</button>
					{canResume && (
						<button onClick={onResume}>
							<Icon name="resume" />
							<span>Resume</span>
						</button>
					)}
				</nav>
			)}
		</div>
	)
}
