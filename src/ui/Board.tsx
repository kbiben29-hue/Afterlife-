import { useEffect, useMemo, useRef, useState } from 'react'
import { actor, attackers, available, canPlay, def, gigsToSteal, legalGigDice, nameOf, streetCred, unitPower } from '../engine/engine'
import { other, type Die, type FieldUnit, type GameState, type Intent, type LegendSlot, type PlayerId } from '../engine/types'
import { CardBack, CardFace } from './Card'

type Sel =
	| { kind: 'hand'; uid: number }
	| { kind: 'field'; uid: number }
	| { kind: 'legend'; uid: number }
	| { kind: 'die'; id: string }
	| null
type Mode = { kind: 'gear'; uid: number } | { kind: 'attack'; attacker: number } | null

export interface BoardProps {
	state: GameState
	send: (i: Intent) => string | undefined
	viewer: PlayerId
	hideHand: boolean
	bot: boolean
	onUndo?: () => void
	onMenu: () => void
	onExport: () => void
}

function DieView({ d, onClick, hot, selected }: { d: Die; onClick?: () => void; hot?: boolean; selected?: boolean }) {
	return (
		<button className={`die d${d.sides} ${hot ? 'hot' : ''} ${selected ? 'sel' : ''}`} onClick={onClick} title={`d${d.sides}`}>
			<span className="die-v">{d.value}</span>
			<span className="die-s">d{d.sides}</span>
		</button>
	)
}

export function Board({ state: s, send, viewer, hideHand, bot, onUndo, onMenu, onExport }: BoardProps) {
	const [sel, setSel] = useState<Sel>(null)
	const [mode, setMode] = useState<Mode>(null)
	const [error, setError] = useState<string | null>(null)
	const logRef = useRef<HTMLDivElement>(null)
	const me = viewer
	const rv = other(me)
	const P = s.players
	const pend = s.pending
	const who = actor(s)
	const myTurnToAct = who === me
	const inspect = sel && sel.kind !== 'die' ? sel.uid : null

	useEffect(() => {
		logRef.current?.scrollTo(0, logRef.current.scrollHeight)
	}, [s.log.length])
	useEffect(() => {
		setSel(null)
		setMode(null)
	}, [pend.kind, viewer])

	const act = (i: Intent) => {
		const err = send(i)
		setError(err ?? null)
		if (!err) {
			setSel(null)
			setMode(null)
		}
	}
	const atk = pend.kind === 'react' ? pend.attack : null
	const canAtk = useMemo(() => new Set(pend.kind === 'main' && myTurnToAct ? attackers(s, me) : []), [s, me, pend.kind, myTurnToAct])

	// ───── clicks ─────
	const clickUnit = (u: FieldUnit, owner: PlayerId) => {
		if (mode?.kind === 'gear' && owner === me) return act({ t: 'play', player: me, uid: mode.uid, target: u.uid })
		if (mode?.kind === 'attack' && owner === rv) return act({ t: 'attack', player: me, attacker: mode.attacker, target: { kind: 'unit', uid: u.uid } })
		setMode(null)
		setSel({ kind: 'field', uid: u.uid })
	}
	const clickLegend = (l: LegendSlot, owner: PlayerId) => {
		if (mode?.kind === 'gear' && owner === me) return act({ t: 'play', player: me, uid: mode.uid, target: l.uid })
		if (!l.faceUp && owner !== me) return
		setMode(null)
		setSel({ kind: 'legend', uid: l.uid })
	}
	const clickDie = (d: Die, owner: PlayerId, zone: 'fixer' | 'gigs') => {
		if (pend.kind === 'chooseGig' && zone === 'fixer' && owner === me && myTurnToAct) return act({ t: 'chooseGig', player: me, dieId: d.id })
		if (pend.kind === 'steal' && zone === 'gigs' && owner === rv && myTurnToAct) return act({ t: 'steal', player: me, dieId: d.id })
		if (zone === 'gigs') setSel({ kind: 'die', id: d.id })
	}

	// ───── zones ─────
	const unitView = (u: FieldUnit, owner: PlayerId) => {
		const d = def(s, u.uid)
		const pw = unitPower(s, u)
		const base = (d.power ?? 0)
		const targetable = (mode?.kind === 'attack' && owner === rv && u.spent) || (mode?.kind === 'gear' && owner === me)
		const isAtk = atk && (atk.attacker === u.uid || (atk.target.kind === 'unit' && atk.target.uid === u.uid))
		return (
			<div key={u.uid} className={`slot unit ${u.spent ? 'spent' : ''} ${sel?.kind === 'field' && sel.uid === u.uid ? 'sel' : ''} ${targetable ? 'target' : ''} ${canAtk.has(u.uid) ? 'can-attack' : ''} ${isAtk ? 'in-fight' : ''}`} onClick={() => clickUnit(u, owner)}>
				<div className="card">
					<CardFace d={d} />
				</div>
				<div className={`pw ${pw > base ? 'up' : pw < base ? 'down' : ''}`}>{Math.max(0, pw)}</div>
				{u.lag && !u.attackDespiteLag && !d.keywords.includes('adrenaline') && <div className="badge lag">LAG</div>}
				{u.goSolo && <div className="badge solo">SOLO</div>}
				{u.gear.length > 0 && <div className="badge gear">⚙{u.gear.length}</div>}
			</div>
		)
	}
	const legendView = (l: LegendSlot, owner: PlayerId) => {
		const d = def(s, l.uid)
		const visible = l.faceUp
		return (
			<div key={l.uid} className={`slot legend ${l.spent ? 'spent' : ''} ${sel?.kind === 'legend' && sel.uid === l.uid ? 'sel' : ''} ${mode?.kind === 'gear' && owner === me ? 'target' : ''}`} onClick={() => clickLegend(l, owner)}>
				<div className="card">{visible ? <CardFace d={d} /> : <CardBack label="LEGEND" />}</div>
				{l.gear.length > 0 && <div className="badge gear">⚙{l.gear.length}</div>}
			</div>
		)
	}
	const side = (p: PlayerId, top: boolean) => {
		const pl = P[p]
		const readyEd = pl.eddies.filter((e) => !e.spent).length
		const cred = streetCred(pl)
		const fixerHot = pend.kind === 'chooseGig' && p === me && myTurnToAct ? new Set(legalGigDice(pl).map((d) => d.id)) : new Set<string>()
		const stealHot = pend.kind === 'steal' && p === rv && myTurnToAct
		return (
			<div className={`side ${top ? 'top' : 'bottom'} ${s.active === p ? 'active' : ''}`}>
				<div className="row meta">
					<div className="pname">
						{pl.name}
						{s.active === p && <span className="turn-dot">● turn {pl.turnsTaken + 1}</span>}
					</div>
					<div className="counts">
						<span title="Cards in hand">✋ {pl.hand.length}</span>
						<span title="Deck">▤ {pl.deck.length}</span>
						<span title="Trash">🗑 {pl.trash.length}</span>
						<span title="Eddies you can still spend">€$ {available(s, p)}</span>
					</div>
				</div>
				<div className="row zones">
					<div className="zone legends">
						<div className="zl">Legends</div>
						<div className="cards">{pl.legends.map((l) => legendView(l, p))}</div>
					</div>
					<div className="zone eddies">
						<div className="zl">Eddies</div>
						<div className="eddie-stack">
							{pl.eddies.map((e, i) => (
								<div key={e.uid} className={`eddie ${e.spent ? 'spent' : ''}`} style={{ left: i * 14 }} />
							))}
							<div className="eddie-n">
								{readyEd}/{pl.eddies.length}
							</div>
						</div>
					</div>
					<div className="zone dice">
						<div className="zl">Fixer</div>
						<div className="dice-row">
							{pl.fixer.map((d) => (
								<DieView key={d.id} d={{ ...d, value: d.sides }} hot={fixerHot.has(d.id)} onClick={() => clickDie(d, p, 'fixer')} />
							))}
						</div>
						<div className="zl">
							Gigs {pl.gigs.length}/7 · Street Cred {cred ?? '—'}
						</div>
						<div className="dice-row">
							{pl.gigs.map((d) => (
								<DieView key={d.id} d={d} hot={stealHot} selected={sel?.kind === 'die' && sel.id === d.id} onClick={() => clickDie(d, p, 'gigs')} />
							))}
						</div>
					</div>
				</div>
				<div className={`row field ${mode?.kind === 'attack' && p === rv ? 'aim' : ''}`}>
					{pl.field.length === 0 && <div className="empty">Field</div>}
					{pl.field.map((u) => unitView(u, p))}
					{mode?.kind === 'attack' && p === rv && (
						<button className="gig-target" onClick={() => act({ t: 'attack', player: me, attacker: mode.attacker, target: { kind: 'gigs' } })}>
							Attack Gigs
							<small>steals {gigsToSteal(unitPower(s, P[me].field.find((u) => u.uid === mode.attacker)!))}</small>
						</button>
					)}
				</div>
			</div>
		)
	}

	// ───── prompt ─────
	let prompt = ''
	const buttons: { label: string; onClick: () => void; primary?: boolean }[] = []
	if (pend.kind === 'over') {
		prompt = `${P[pend.winner].name} wins — ${pend.reason}.`
		buttons.push({ label: 'New game', onClick: onMenu, primary: true })
	} else if (!myTurnToAct) {
		prompt = `${P[who!].name} is deciding…`
	} else if (pend.kind === 'chooseFirst') {
		prompt = `You won the roll (${pend.rolls[0]} vs ${pend.rolls[1]}). Who goes first?`
		buttons.push({ label: 'I go first', onClick: () => act({ t: 'chooseFirst', player: me, first: me }), primary: true })
		buttons.push({ label: `${P[rv].name} goes first`, onClick: () => act({ t: 'chooseFirst', player: me, first: rv }) })
	} else if (pend.kind === 'mulligan') {
		prompt = 'Your opening hand. Keep it, or shuffle it back and draw 6 new cards (once)?'
		buttons.push({ label: 'Keep', onClick: () => act({ t: 'mulligan', player: me, redraw: false }), primary: true })
		buttons.push({ label: 'Mulligan', onClick: () => act({ t: 'mulligan', player: me, redraw: true }) })
	} else if (pend.kind === 'chooseGig') {
		prompt = 'Gain a Gig: pick a die from your Fixer area to roll (the d20 comes last).'
	} else if (pend.kind === 'steal') {
		prompt = `Steal ${pend.remaining} more Gig${pend.remaining > 1 ? 's' : ''}: pick a rival die.`
	} else if (pend.kind === 'react') {
		const a = pend.attack
		const au = P[rv].field.find((u) => u.uid === a.attacker)
		prompt = `${nameOf(s, a.attacker)} (${au ? Math.max(0, unitPower(s, au)) : '?'} power) attacks ${a.target.kind === 'gigs' ? 'your Gigs' : nameOf(s, a.target.uid)}. React: Call a Legend, play a Quick card, or block — then resolve.`
		buttons.push({ label: 'Resolve attack', onClick: () => act({ t: 'pass', player: me }), primary: true })
		if (!P[me].calledThisTurn && P[me].legends.some((l) => !l.faceUp)) buttons.push({ label: 'Call a Legend (1 €$)', onClick: () => act({ t: 'callLegend', player: me }) })
		for (const u of P[me].field)
			if (!u.spent && def(s, u.uid).keywords.includes('blocker')) buttons.push({ label: `Block with ${def(s, u.uid).name}`, onClick: () => act({ t: 'block', player: me, blocker: u.uid }) })
	} else if (pend.kind === 'main') {
		prompt =
			mode?.kind === 'attack'
				? 'Choose a target: a spent rival Unit, or their Gigs.'
				: mode?.kind === 'gear'
					? 'Choose a friendly Unit or Legend to equip.'
					: 'Your move: sell, play, call a Legend, attack — then end your turn.'
		if (mode) buttons.push({ label: 'Cancel', onClick: () => setMode(null) })
		else {
			buttons.push({ label: 'End turn', onClick: () => act({ t: 'endTurn', player: me }), primary: true })
			if (!P[me].calledThisTurn && P[me].legends.some((l) => !l.faceUp)) buttons.push({ label: 'Call a Legend (1 €$)', onClick: () => act({ t: 'callLegend', player: me }) })
		}
	}

	// ───── selection actions ─────
	const tableOpen = pend.kind === 'main' || pend.kind === 'react'
	const tools: { label: string; onClick: () => void; cls?: string }[] = []
	const manual = (m: Extract<Intent, { t: 'manual' }>['m']) => act({ t: 'manual', player: (who ?? me) as PlayerId, m })
	if (sel?.kind === 'hand' && myTurnToAct && tableOpen) {
		const d = def(s, sel.uid)
		if (canPlay(s, me, sel.uid))
			tools.push({
				label: d.type === 'gear' ? `Equip (${d.cost} €$)` : `Play (${d.cost} €$)`,
				onClick: () => (d.type === 'gear' ? setMode({ kind: 'gear', uid: sel.uid }) : act({ t: 'play', player: me, uid: sel.uid })),
				cls: 'primary',
			})
		if (pend.kind === 'main' && d.sell && !P[me].soldThisTurn) tools.push({ label: 'Sell for 1 €$', onClick: () => act({ t: 'sell', player: me, uid: sel.uid }) })
		if (tableOpen) tools.push({ label: 'Discard', onClick: () => manual({ op: 'discard', uid: sel.uid }), cls: 'tool' })
	}
	if (sel?.kind === 'field' && tableOpen) {
		const mine = s.instances[sel.uid].owner === me
		if (mine && canAtk.has(sel.uid)) tools.push({ label: 'Attack', onClick: () => setMode({ kind: 'attack', attacker: sel.uid }), cls: 'primary' })
		tools.push({ label: '+1 power', onClick: () => manual({ op: 'power', uid: sel.uid, delta: 1 }), cls: 'tool' })
		tools.push({ label: '−1 power', onClick: () => manual({ op: 'power', uid: sel.uid, delta: -1 }), cls: 'tool' })
		tools.push({ label: 'Spend / Ready', onClick: () => manual({ op: 'toggleSpent', uid: sel.uid }), cls: 'tool' })
		tools.push({ label: 'Give Adrenaline', onClick: () => manual({ op: 'adrenaline', uid: sel.uid }), cls: 'tool' })
		tools.push({ label: 'Defeat', onClick: () => manual({ op: 'defeat', uid: sel.uid }), cls: 'tool' })
		tools.push({ label: 'Return to hand', onClick: () => manual({ op: 'toHand', uid: sel.uid }), cls: 'tool' })
	}
	if (sel?.kind === 'legend' && tableOpen) {
		const l = [...P[0].legends, ...P[1].legends].find((x) => x.uid === sel.uid)!
		const d = def(s, sel.uid)
		const mine = s.instances[sel.uid].owner === me
		if (mine && pend.kind === 'main' && l.faceUp && d.keywords.includes('goSolo') && d.cost !== null)
			tools.push({ label: `Go Solo (${d.cost} €$)`, onClick: () => act({ t: 'goSolo', player: me, uid: sel.uid }), cls: 'primary' })
		if (mine) tools.push({ label: 'Spend / Ready (use ability)', onClick: () => manual({ op: 'toggleSpent', uid: sel.uid }), cls: 'tool' })
		if (mine) tools.push({ label: l.faceUp ? 'Turn face-down' : 'Flip face-up', onClick: () => manual({ op: 'flipLegend', uid: sel.uid }), cls: 'tool' })
	}
	if (sel?.kind === 'die' && tableOpen) {
		tools.push({ label: 'Move to other player', onClick: () => manual({ op: 'moveDie', dieId: sel.id }), cls: 'tool' })
		tools.push({ label: 'Re-roll', onClick: () => manual({ op: 'reroll', dieId: sel.id }), cls: 'tool' })
	}
	const sideTools = tableOpen && myTurnToAct
	const handVisible = !hideHand && pend.kind !== 'chooseFirst'

	return (
		<div className="board">
			<aside className="left">
				<div className="inspect">{inspect !== null ? <CardFace d={def(s, inspect)} big /> : <div className="inspect-hint">Tap a card to look at it</div>}</div>
				{inspect !== null && def(s, inspect).text && def(s, inspect).image && <div className="inspect-text">{def(s, inspect).text}</div>}
				<div className="tools">
					{tools.map((t) => (
						<button key={t.label} className={t.cls} onClick={t.onClick}>
							{t.label}
						</button>
					))}
				</div>
				{sideTools && (
					<div className="tools small">
						<div className="zl">Table tools</div>
						<button className="tool" onClick={() => manual({ op: 'draw' })}>
							Draw a card
						</button>
						<button className="tool" onClick={() => manual({ op: 'trashTop' })}>
							Trash top of deck
						</button>
					</div>
				)}
			</aside>

			<main className="table">
				{side(rv, true)}
				<div className="prompt">
					<div className="prompt-text">{prompt}</div>
					<div className="prompt-buttons">
						{buttons.map((b) => (
							<button key={b.label} className={b.primary ? 'primary' : ''} onClick={b.onClick}>
								{b.label}
							</button>
						))}
					</div>
					{error && (
						<div className="error" onClick={() => setError(null)}>
							{error}
						</div>
					)}
				</div>
				{side(me, false)}
				<div className="hand" style={{ ['--overlap' as string]: `${Math.min(0, (950 - P[me].hand.length * 120) / Math.max(1, P[me].hand.length - 1))}px` }}>
					{P[me].hand.map((uid) =>
						handVisible ? (
							<div key={uid} className={`slot hand-card ${sel?.kind === 'hand' && sel.uid === uid ? 'sel' : ''} ${myTurnToAct && canPlay(s, me, uid) && (pend.kind === 'main' || pend.kind === 'react') ? 'playable' : ''}`} onClick={() => setSel({ kind: 'hand', uid })}>
								<div className="card">
									<CardFace d={def(s, uid)} />
								</div>
							</div>
						) : (
							<div key={uid} className="slot hand-card">
								<div className="card">
									<CardBack />
								</div>
							</div>
						),
					)}
				</div>
			</main>

			<aside className="right">
				<div className="menu-row">
					<button onClick={onMenu}>Menu</button>
					{onUndo && <button onClick={onUndo}>Undo</button>}
					<button onClick={onExport}>Export</button>
				</div>
				<div className="status">
					{s.overtime && <div className="ot">OVERTIME — 7 Gigs wins instantly</div>}
					<div>
						{P[0].name} {P[0].gigs.length} Gigs · {P[1].name} {P[1].gigs.length} Gigs
					</div>
					{bot && <div className="dim">Computer: plays Units, Gear and attacks; ignores card text.</div>}
				</div>
				<div className="log" ref={logRef}>
					{s.log.map((l, i) => (
						<div key={i} className={l.startsWith('──') ? 'turn' : ''}>
							{l}
						</div>
					))}
				</div>
			</aside>
		</div>
	)
}
