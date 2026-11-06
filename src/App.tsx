import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { actor, newGame, tryApply } from './engine/engine'
import type { GameState, Intent, PlayerId } from './engine/types'
import { chooseIntent } from './bot/bot'
import { loadCards, type CardPool } from './data/cards'
import { Board } from './ui/Board'
import { Setup, type SetupResult } from './ui/Setup'
import { coachFor, eventNote, INTRO, type CoachStep } from './ui/coach'

const W = 1600
const H = 1000
const SAVE = 'afterlife.save.v1'

interface Session {
	history: GameState[]
	bot: boolean
	tutorial?: {
		intro: number // index into INTRO; INTRO.length = intro finished
		seen: string[] // coach steps already explained in full
		note: CoachStep | null // one-off note waiting to be dismissed
	}
}

/** One PC-style layout for every screen: the 1600×1000 table is scaled to fit. */
function useFit() {
	const [scale, setScale] = useState(1)
	useLayoutEffect(() => {
		const fit = () => setScale(Math.min(window.innerWidth / W, window.innerHeight / H))
		fit()
		window.addEventListener('resize', fit)
		return () => window.removeEventListener('resize', fit)
	}, [])
	return scale
}

function loadSave(): Session | null {
	try {
		const raw = localStorage.getItem(SAVE)
		return raw ? (JSON.parse(raw) as Session) : null
	} catch {
		return null
	}
}

export default function App() {
	const scale = useFit()
	const [pool, setPool] = useState<CardPool | null>(null)
	const [session, setSession] = useState<Session | null>(null)
	const [viewer, setViewer] = useState<PlayerId>(0)
	const [handoff, setHandoff] = useState<PlayerId | null>(null)
	const botTimer = useRef<number | undefined>(undefined)

	useEffect(() => {
		loadCards().then(setPool)
	}, [])

	const state = session?.history[session.history.length - 1]

	useEffect(() => {
		if (!session) return
		try {
			localStorage.setItem(SAVE, JSON.stringify({ ...session, history: session.history.slice(-60) }))
		} catch {
			/* storage full or unavailable */
		}
	}, [session])

	const send = useCallback(
		(i: Intent) => {
			if (!session || !state) return 'No game'
			const r = tryApply(state, i)
			if (r.error) return r.error
			let tutorial = session.tutorial
			if (tutorial) {
				// whatever the coach was explaining has now been seen
				const seen = new Set(tutorial.seen)
				const cur = coachFor(state, 0, seen)
				if (cur && actor(state) === 0) seen.add(cur.key)
				tutorial = { ...tutorial, seen: [...seen], note: tutorial.note ?? eventNote(state, r.state, 0, seen) }
			}
			setSession({ ...session, history: [...session.history, r.state], tutorial })
			return undefined
		},
		[session, state],
	)

	// Hot-seat: whoever must decide sits at the bottom; hide their hand until they take the device.
	useEffect(() => {
		if (!state || !session) return
		const who = actor(state)
		if (session.bot) {
			setViewer(0)
			return
		}
		if (who !== null && who !== viewer) {
			setViewer(who)
			setHandoff(who)
		}
	}, [state, session, viewer])

	// Computer opponent plays seat 1.
	useEffect(() => {
		if (!state || !session?.bot) return
		if (actor(state) !== 1) return
		if (session.tutorial && session.tutorial.intro < INTRO.length) return
		botTimer.current = window.setTimeout(
			() => {
				const i = chooseIntent(state)
				if (i) send(i)
			},
			session.tutorial ? 1100 : 550,
		)
		return () => window.clearTimeout(botTimer.current)
	}, [state, session, send])

	const start = (r: SetupResult) => {
		if (!pool) return
		let g = newGame({ seed: r.seed, cards: pool.cards, decks: r.decks, names: r.names })
		// tutorial: make sure the player wins the roll, so they get to choose and learn that step
		for (let k = 1; r.tutorial && g.pending.kind === 'chooseFirst' && g.pending.player !== 0 && k < 50; k++)
			g = newGame({ seed: r.seed + k, cards: pool.cards, decks: r.decks, names: r.names })
		setSession({ history: [g], bot: r.bot, tutorial: r.tutorial ? { intro: 0, seen: [], note: null } : undefined })
		setViewer(0)
		setHandoff(null)
	}
	const undo = () => {
		if (!session || session.history.length < 2) return
		let h = session.history.slice(0, -1)
		// in a computer game, step back to the human's last decision
		if (session.bot) while (h.length > 1 && actor(h[h.length - 1]) === 1) h = h.slice(0, -1)
		setSession({ ...session, history: h })
	}
	const exportGame = () => {
		if (!state) return
		const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' })
		const a = document.createElement('a')
		a.href = URL.createObjectURL(blob)
		a.download = `afterlife-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`
		a.click()
	}

	const coachStep = session?.tutorial && state ? coachFor(state, 0, new Set(session.tutorial.seen)) : null

	let body
	if (!pool) body = <div className="loading">Loading cards…</div>
	else if (!session || !state)
		body = (
			<Setup
				pool={pool}
				onStart={start}
				canResume={!!loadSave()}
				onResume={() => {
					const s = loadSave()
					if (s) setSession(s)
				}}
			/>
		)
	else
		body = (
			<>
				<Board
					state={state}
					send={send}
					viewer={viewer}
					hideHand={handoff !== null}
					bot={session.bot}
					onUndo={session.history.length > 1 ? undo : undefined}
					onMenu={() => setSession(null)}
					onExport={exportGame}
					hint={coachStep && !session.tutorial?.note && (session.tutorial?.intro ?? 0) >= INTRO.length ? coachStep.hint : undefined}
					coach={session.tutorial && <CoachPanel session={session} step={coachStep} setSession={setSession} />}
				/>
				{handoff !== null && !session.bot && state.pending.kind !== 'over' && (
					<div className="handoff" onClick={() => setHandoff(null)}>
						<div>
							Pass the device to <b>{state.players[handoff].name}</b>
							<small>Tap when ready</small>
						</div>
					</div>
				)}
			</>
		)

	return (
		<div className="viewport">
			<div className="stage" style={{ width: W, height: H, transform: `scale(${scale})`, left: (window.innerWidth - W * scale) / 2, top: (window.innerHeight - H * scale) / 2 }}>
				{body}
			</div>
		</div>
	)
}

function CoachPanel({ session, step, setSession }: { session: Session; step: CoachStep | null; setSession: (s: Session) => void }) {
	const t = session.tutorial!
	const update = (patch: Partial<NonNullable<Session['tutorial']>>) => setSession({ ...session, tutorial: { ...t, ...patch } })
	let title: string
	let body: string
	let button: { label: string; onClick: () => void } | null = null
	if (t.intro < INTRO.length) {
		title = INTRO[t.intro].title
		body = INTRO[t.intro].body
		button = { label: t.intro === INTRO.length - 1 ? 'Start playing' : 'Next', onClick: () => update({ intro: t.intro + 1 }) }
	} else if (t.note) {
		title = t.note.title
		body = t.note.body
		button = { label: 'Got it', onClick: () => update({ note: null, seen: [...t.seen, t.note!.key] }) }
	} else if (step) {
		title = step.title
		body = step.body
	} else return null
	return (
		<div className="coach">
			<div className="coach-tag">
				TUTORIAL{t.intro < INTRO.length ? ` · ${t.intro + 1}/${INTRO.length}` : ''}
				<button className="coach-off" onClick={() => setSession({ ...session, tutorial: undefined })}>
					Turn off
				</button>
			</div>
			<div className="coach-title">{title}</div>
			<div className="coach-body">{body}</div>
			{button && (
				<button className="primary" onClick={button.onClick}>
					{button.label}
				</button>
			)}
		</div>
	)
}
