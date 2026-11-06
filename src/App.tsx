import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { actor, newGame, tryApply } from './engine/engine'
import type { GameState, Intent, PlayerId } from './engine/types'
import { chooseIntent } from './bot/bot'
import { loadCards, type CardPool } from './data/cards'
import { Board } from './ui/Board'
import { Setup, type SetupResult } from './ui/Setup'

const W = 1600
const H = 1000
const SAVE = 'afterlife.save.v1'

interface Session {
	history: GameState[]
	bot: boolean
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
			setSession({ ...session, history: [...session.history, r.state] })
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
		botTimer.current = window.setTimeout(() => {
			const i = chooseIntent(state)
			if (i) send(i)
		}, 550)
		return () => window.clearTimeout(botTimer.current)
	}, [state, session, send])

	const start = (r: SetupResult) => {
		if (!pool) return
		const g = newGame({ seed: r.seed, cards: pool.cards, decks: r.decks, names: r.names })
		setSession({ history: [g], bot: r.bot })
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
				<Board state={state} send={send} viewer={viewer} hideHand={handoff !== null} bot={session.bot} onUndo={session.history.length > 1 ? undo : undefined} onMenu={() => setSession(null)} onExport={exportGame} />
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
