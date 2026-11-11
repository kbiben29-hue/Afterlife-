import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { actor, newGame, tryApply } from './engine/engine'
import type { GameState, Intent, PlayerId } from './engine/types'
import { chooseIntent } from './bot/bot'
import { loadCards, type CardPool } from './data/cards'
import { Board, type LayoutChoice } from './ui/Board'
import { Setup, type SetupResult } from './ui/Setup'
import { coachFor, eventNote, INTRO, type CoachStep } from './ui/coach'
import { hostGame, joinGame, newGameCode, type Conn, type Host } from './net/transport'
import { clearJoinFromUrl, isGuestMsg, isHostMsg, joinCodeFromUrl, joinLink, stripCards, withCards, type GuestMsg, type HostMsg } from './net/online'
import { randomDeck, validateDeck } from './engine/decks'
import type { CardDef, DeckList } from './engine/types'
import { STARTER_FIXTURE } from './engine/starters.fixture'
import { comboNote, deckName, DRILLS, drillCoach, drillsFor, PLANS, type DeckId } from './ui/lessons'

const W = 1440
const H = 900
const SAVE = 'afterlife.save.v1'

interface Session {
	history: GameState[]
	bot: boolean
	tutorial?: {
		intro: number // index into INTRO; INTRO.length = intro finished
		seen: string[] // coach steps already explained in full
		note: CoachStep | null // one-off note waiting to be dismissed
		/** deck lessons: coached game with a starter deck, or a combo drill */
		deck?: DeckId
		drill?: string
	}
	/** online game: the host's browser referees; the guest sends intents */
	online?: { role: 'host' | 'guest'; code: string; seat: PlayerId }
}

interface Lobby {
	role: 'host' | 'guest'
	code: string
	name: string
	deck: DeckList
	status: string
	error?: string
}

const LAYOUT_KEY = 'afterlife.layout'
function readLayout(): LayoutChoice {
	try {
		const v = localStorage.getItem(LAYOUT_KEY)
		return v === 'pocket' || v === 'console' ? v : 'auto'
	} catch {
		return 'auto'
	}
}
/** Touch screens (iPad, iPhone) get the touch layout unless the player picks the table layout. */
const isTouch = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches

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

type Tutorial = NonNullable<Session['tutorial']>
/** Pages shown before play: the general intro, a deck's game plan, or a drill's goal. */
function pagesFor(t: Tutorial): { title: string; body: string }[] {
	if (t.drill) {
		const d = DRILLS.find((x) => x.id === t.drill)!
		return [{ title: d.title, body: `${deckName(d.deck)} combo drill. Goal: ${d.goal} The coach walks you through it step by step — whatever glows is the next move.` }]
	}
	if (t.deck) return PLANS[t.deck]
	return INTRO
}
/** Starter-deck cards are always available: the card database wins, the stand-ins fill gaps. */
const withStarters = (cards: Record<string, CardDef>) => ({ ...STARTER_FIXTURE, ...cards })

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
	const [layoutChoice, setLayoutChoice] = useState<LayoutChoice>(() => readLayout())
	const pocket = layoutChoice === 'pocket' || (layoutChoice === 'auto' && isTouch())
	const chooseLayout = (c: LayoutChoice) => {
		setLayoutChoice(c)
		try {
			localStorage.setItem(LAYOUT_KEY, c)
		} catch {
			/* ignore */
		}
	}
	const [lobby, setLobby] = useState<Lobby | null>(null)
	const [lessonsOpen, setLessonsOpen] = useState(false)
	const [net, setNet] = useState<{ ok: boolean; text: string } | null>(null)
	const [netError, setNetError] = useState<string | null>(null)
	const [joinCode, setJoinCode] = useState<string | null>(() => joinCodeFromUrl())
	const sessionRef = useRef<Session | null>(null)
	const lobbyRef = useRef<Lobby | null>(null)
	const hostRef = useRef<Host | null>(null)
	const connRef = useRef<Conn | null>(null)
	const cardsRef = useRef<Record<string, CardDef>>({})
	sessionRef.current = session
	lobbyRef.current = lobby

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
			if (session.online?.role === 'guest') {
				// the host referees: send the move and wait for its state
				if (!connRef.current) return 'Not connected to your friend’s game'
				connRef.current.send({ type: 'intent', intent: i } satisfies GuestMsg)
				return undefined
			}
			let tutorial = session.tutorial
			if (tutorial) {
				// whatever the coach was explaining has now been seen
				const seen = new Set(tutorial.seen)
				const cur = tutorial.drill ? null : coachFor(state, 0, seen)
				if (cur && actor(state) === 0) seen.add(cur.key)
				const note = tutorial.drill ? null : (tutorial.note ?? (tutorial.deck ? comboNote(tutorial.deck, r.state, 0, seen) : null) ?? eventNote(state, r.state, 0, seen))
				tutorial = { ...tutorial, seen: [...seen], note }
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
		if (session.online) {
			setViewer(session.online.seat)
			setHandoff(null)
			return
		}
		if (session.bot) {
			setViewer(0)
			return
		}
		if (who !== null && who !== viewer) {
			setViewer(who)
			setHandoff(who)
		}
	}, [state, session, viewer])

	// Online host: every new state goes to the guest.
	useEffect(() => {
		if (!state || session?.online?.role !== 'host' || !connRef.current) return
		connRef.current.send({ type: 'state', state: stripCards(state) } satisfies HostMsg)
	}, [state, session?.online?.role])

	// ───── online play ─────
	const closeNet = () => {
		connRef.current?.close()
		connRef.current = null
		hostRef.current?.destroy()
		hostRef.current = null
		setNet(null)
	}

	/** Host: a friend's browser connected (first time, or coming back after a refresh). */
	const attachGuest = (c: Conn) => {
		connRef.current?.close()
		connRef.current = c
		setNet({ ok: true, text: 'Friend connected' })
		c.onClose(() => {
			if (connRef.current === c) {
				connRef.current = null
				setNet({ ok: false, text: 'Friend disconnected — they can reopen your link to come back' })
			}
		})
		c.onMessage((m) => {
			if (!isGuestMsg(m)) return
			const cur = sessionRef.current
			if (m.type === 'hello') {
				if (cur?.online?.role === 'host') {
					// rejoin: send the game as it stands
					const st = cur.history[cur.history.length - 1]
					c.send({ type: 'start', cards: st.cards, state: stripCards(st), hostName: st.players[0].name } satisfies HostMsg)
					return
				}
				const lb = lobbyRef.current
				if (!lb || !pool) return
				const guestDeck = validateDeck(pool.cards, m.deck).length === 0 ? m.deck : randomDeck(pool.cards, Date.now() >>> 0)
				const seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0
				const g = newGame({ seed, cards: pool.cards, decks: [lb.deck, guestDeck], names: [lb.name, (m.name || 'Player 2').slice(0, 24)] })
				setSession({ history: [g], bot: false, online: { role: 'host', code: lb.code, seat: 0 } })
				setLobby(null)
				c.send({ type: 'start', cards: g.cards, state: stripCards(g), hostName: lb.name } satisfies HostMsg)
				return
			}
			if (m.type === 'intent') {
				if (!cur) return
				const st = cur.history[cur.history.length - 1]
				if (m.intent.player !== 1) return // the guest only ever plays seat 1
				const r = tryApply(st, m.intent)
				if (r.error) c.send({ type: 'error', message: r.error } satisfies HostMsg)
				else {
					const next = { ...cur, history: [...cur.history, r.state] }
					sessionRef.current = next // so a second quick move builds on this one
					setSession(next)
				}
			}
		})
	}

	const openHost = async (code: string) => {
		closeNet()
		setNet({ ok: false, text: 'Opening the game for your friend…' })
		try {
			const h = await hostGame(code)
			hostRef.current = h
			h.onConnection(attachGuest)
			h.onError((e) => setNet({ ok: false, text: e }))
			setNet({ ok: false, text: 'Waiting for your friend to open the link…' })
			setLobby((lb) => (lb ? { ...lb, status: 'Waiting for your friend to open the link…' } : lb))
		} catch (e) {
			const msg = (e as Error).message
			setNet({ ok: false, text: msg })
			setLobby((lb) => (lb ? { ...lb, error: msg } : lb))
		}
	}

	const openGuest = async (code: string, name: string, deck: DeckList) => {
		closeNet()
		setNet({ ok: false, text: 'Connecting to your friend’s game…' })
		try {
			const c = await joinGame(code)
			connRef.current = c
			setNet({ ok: true, text: 'Connected' })
			c.onClose(() => {
				if (connRef.current === c) {
					connRef.current = null
					setNet({ ok: false, text: 'Disconnected from your friend’s game — reopen the invite link to reconnect' })
				}
			})
			c.onMessage((m) => {
				if (!isHostMsg(m)) return
				if (m.type === 'start') {
					cardsRef.current = m.cards
					setLobby(null)
					setSession({ history: [withCards(m.state, m.cards)], bot: false, online: { role: 'guest', code, seat: 1 } })
				} else if (m.type === 'state') {
					const st = withCards(m.state, cardsRef.current)
					setSession((prev) => (prev ? { ...prev, history: [...prev.history.slice(-59), st] } : prev))
				} else if (m.type === 'error') setNetError(m.message)
			})
			c.send({ type: 'hello', name, deck } satisfies GuestMsg)
		} catch (e) {
			const msg = (e as Error).message
			setNet({ ok: false, text: msg })
			setLobby((lb) => (lb ? { ...lb, error: msg } : lb))
		}
	}

	useEffect(() => () => closeNet(), [])

	// Computer opponent plays seat 1.
	useEffect(() => {
		if (!state || !session?.bot) return
		if (actor(state) !== 1) return
		if (session.tutorial && session.tutorial.intro < pagesFor(session.tutorial).length) return
		// drills are one turn: the rival only reacts (block / pass), it never takes a turn
		if (session.tutorial?.drill && state.active !== 0) return
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
		if (r.online === 'host') {
			const code = newGameCode()
			setLobby({ role: 'host', code, name: r.names[0], deck: r.decks[0], status: 'Opening…' })
			void openHost(code)
			return
		}
		if (r.online === 'guest' && joinCode) {
			setLobby({ role: 'guest', code: joinCode, name: r.names[0], deck: r.decks[0], status: 'Connecting…' })
			clearJoinFromUrl()
			void openGuest(joinCode, r.names[0], r.decks[0])
			return
		}
		const cards = withStarters(pool.cards)
		if (r.lesson?.drill) {
			const d = DRILLS.find((x) => x.id === r.lesson!.drill)!
			setSession({ history: [d.build(cards, r.seed)], bot: true, tutorial: { intro: 0, seen: [], note: null, deck: r.lesson.deck, drill: d.id } })
			setViewer(0)
			setHandoff(null)
			return
		}
		let g = newGame({ seed: r.seed, cards, decks: r.decks, names: r.names })
		// tutorial: make sure the player wins the roll, so they get to choose and learn that step
		for (let k = 1; r.tutorial && g.pending.kind === 'chooseFirst' && g.pending.player !== 0 && k < 50; k++)
			g = newGame({ seed: r.seed + k, cards, decks: r.decks, names: r.names })
		setSession({ history: [g], bot: r.bot, tutorial: r.tutorial ? { intro: 0, seen: [], note: null, ...(r.lesson ? { deck: r.lesson.deck } : {}) } : undefined })
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

	const drill = session?.tutorial?.drill ? DRILLS.find((d) => d.id === session.tutorial!.drill) : undefined
	const coachStep = session?.tutorial && state ? (drill ? drillCoach(drill, state, session.history[0]) : coachFor(state, 0, new Set(session.tutorial.seen))) : null
	const restartDrill = (id: string) => {
		const d = DRILLS.find((x) => x.id === id)!
		if (!pool) return
		setSession({ history: [d.build(withStarters(pool.cards), (Date.now() >>> 0) ^ 0x5bd1)], bot: true, tutorial: { intro: 1, seen: [], note: null, deck: d.deck, drill: d.id } })
	}

	let body
	if (!pool) body = <div className="loading">Loading cards…</div>
	else if (lobby && (!session || !state))
		body = (
			<LobbyScreen
				lobby={lobby}
				net={net}
				onCancel={() => {
					closeNet()
					setLobby(null)
				}}
				onRetry={() => (lobby.role === 'host' ? openHost(lobby.code) : openGuest(lobby.code, lobby.name, lobby.deck))}
			/>
		)
	else if (!session || !state)
		body = (
			<Setup
				pool={pool}
				initialLessons={lessonsOpen}
				onStart={start}
				joinCode={joinCode}
				canResume={!!loadSave()}
				resumeLabel={loadSave()?.online ? 'Resume online game' : undefined}
				onResume={() => {
					const s = loadSave()
					if (!s) return
					if (s.online?.role === 'guest') {
						// rejoin the host's game; it sends the current state
						const me = s.history[s.history.length - 1].players[1]
						setLobby({ role: 'guest', code: s.online.code, name: me.name, deck: { legends: [], main: [] }, status: 'Reconnecting…' })
						void openGuest(s.online.code, me.name, { legends: [], main: [] })
						return
					}
					setSession(s)
					if (s.online?.role === 'host') void openHost(s.online.code)
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
					onUndo={session.history.length > 1 && !session.online ? undo : undefined}
					onMenu={() => (session.online && closeNet(), setSession(null), setJoinCode(null))}
					onExport={exportGame}
					layout={pocket ? 'pocket' : 'console'}
					layoutChoice={layoutChoice}
					onLayout={chooseLayout}
					hint={coachStep && session.tutorial && !session.tutorial.note && session.tutorial.intro >= pagesFor(session.tutorial).length ? coachStep.hint : undefined}
					coach={
						session.tutorial ? (
							<CoachPanel session={session} step={coachStep} setSession={setSession} onDrill={restartDrill} onLessons={() => (setLessonsOpen(true), setSession(null))} />
						) : undefined
					}
					netBadge={session.online ? <NetBadge net={net} code={session.online.code} host={session.online.role === 'host'} error={netError} onDismiss={() => setNetError(null)} /> : undefined}
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

	if (pocket && session && state && !lobby) return <div className="pocket-root">{body}</div>
	// home screen, lobby and loading are ordinary scrolling pages on every device
	if (!session || !state || lobby) return <div className="page-root">{body}</div>

	return (
		<div className="viewport">
			<div className="stage" style={{ width: W, height: H, transform: `scale(${scale})`, left: (window.innerWidth - W * scale) / 2, top: (window.innerHeight - H * scale) / 2 }}>
				{body}
			</div>
		</div>
	)
}

function CoachPanel({ session, step, setSession, onDrill, onLessons }: { session: Session; step: CoachStep | null; setSession: (s: Session) => void; onDrill: (id: string) => void; onLessons: () => void }) {
	const t = session.tutorial!
	const pages = pagesFor(t)
	const update = (patch: Partial<NonNullable<Session['tutorial']>>) => setSession({ ...session, tutorial: { ...t, ...patch } })
	let title: string
	let body: string
	let button: { label: string; onClick: () => void } | null = null
	const extra: { label: string; onClick: () => void }[] = []
	const drill = t.drill ? DRILLS.find((d) => d.id === t.drill) : undefined
	const st = session.history[session.history.length - 1]
	const tag = drill ? `COMBO DRILL · ${deckName(drill.deck)}` : t.deck ? `DECK LESSON · ${deckName(t.deck)}` : 'TUTORIAL'
	if (t.intro < pages.length) {
		title = pages[t.intro].title
		body = pages[t.intro].body
		button = { label: t.intro === pages.length - 1 ? (drill ? 'Start the drill' : 'Start playing') : 'Next', onClick: () => update({ intro: t.intro + 1 }) }
	} else if (drill && drill.success(st, session.history[0])) {
		const list = drillsFor(drill.deck)
		const next = list[list.indexOf(drill) + 1]
		title = 'Drill complete ✓'
		body = drill.lesson
		button = next ? { label: `Next: ${next.title}`, onClick: () => onDrill(next.id) } : { label: 'Back to the lessons', onClick: onLessons }
		extra.push({ label: 'Do it again', onClick: () => onDrill(drill.id) })
	} else if (drill && (st.active !== 0 || st.pending.kind === 'over' || !step)) {
		title = 'Not quite'
		body = `The goal was: ${drill.goal} Try again — follow the glowing hints, or experiment your own way.`
		button = { label: 'Try again', onClick: () => onDrill(drill.id) }
		extra.push({ label: 'Back to the lessons', onClick: onLessons })
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
				{tag}
				{t.intro < pages.length && pages.length > 1 ? ` · ${t.intro + 1}/${pages.length}` : ''}
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
			{extra.map((b) => (
				<button key={b.label} onClick={b.onClick}>
					{b.label}
				</button>
			))}
		</div>
	)
}

function LobbyScreen({ lobby, net, onCancel, onRetry }: { lobby: Lobby; net: { ok: boolean; text: string } | null; onCancel: () => void; onRetry: () => void }) {
	const [copied, setCopied] = useState(false)
	const link = joinLink(lobby.code)
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(link)
			setCopied(true)
			window.setTimeout(() => setCopied(false), 2000)
		} catch {
			/* select the text instead */
		}
	}
	return (
		<div className="lobby">
			<h2>{lobby.role === 'host' ? 'Invite a friend' : 'Joining your friend’s game'}</h2>
			{lobby.role === 'host' && (
				<>
					<p>Send this link to your friend. When they open it and press Join, the game starts for both of you.</p>
					<div className="invite">
						<input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
						<button className="primary" onClick={copy}>
							{copied ? 'Copied!' : 'Copy link'}
						</button>
					</div>
					<p className="dim">Keep this page open until your friend joins. Game code: {lobby.code}</p>
				</>
			)}
			<div className={`lobby-status ${lobby.error ? 'bad' : ''}`}>{lobby.error ?? net?.text ?? lobby.status}</div>
			<div className="setup-buttons">
				{lobby.error && (
					<button className="primary" onClick={onRetry}>
						Try again
					</button>
				)}
				<button onClick={onCancel}>Cancel</button>
			</div>
		</div>
	)
}

/** Online status: a small dot + word in the top-right corner; tap it for the game code and invite link. */
function NetBadge({ net, code, host, error, onDismiss }: { net: { ok: boolean; text: string } | null; code: string; host: boolean; error: string | null; onDismiss: () => void }) {
	const [open, setOpen] = useState(false)
	const [copied, setCopied] = useState(false)
	return (
		<div className={`netbadge ${net?.ok ? 'ok' : 'bad'}`}>
			<button className="nb-pill" onClick={() => setOpen(!open)} title={net?.text ?? 'Not connected'}>
				<span className="dot" />
				{net?.ok ? 'Online' : 'Offline'}
			</button>
			{(open || error) && (
				<div className="nb-pop" onClick={() => (onDismiss(), setOpen(false))}>
					<div>{net?.text ?? 'Not connected'}</div>
					<div className="dim">
						{host ? 'You’re hosting' : 'Your friend is hosting'} · game {code}
					</div>
					{host && (
						<button
							onClick={async (e) => {
								e.stopPropagation()
								try {
									await navigator.clipboard.writeText(joinLink(code))
									setCopied(true)
								} catch {
									/* ignore */
								}
							}}
						>
							{copied ? 'Link copied' : 'Copy invite link'}
						</button>
					)}
					{error && <div className="error-inline">{error}</div>}
				</div>
			)}
		</div>
	)
}
