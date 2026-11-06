import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { actor, attackers, available, canPlay, def, gigsToSteal, legalGigDice, nameOf, streetCred, unitPower } from '../engine/engine'
import { other as other_, type Die, type FieldUnit, type GameState, type Intent, type LegendSlot, type PlayerId } from '../engine/types'
import { CardBack, CardFace } from './Card'
import type { Hint } from './coach'

type Sel =
	| { kind: 'hand'; uid: number }
	| { kind: 'field'; uid: number }
	| { kind: 'legend'; uid: number }
	| { kind: 'die'; id: string }
	| { kind: 'trash'; owner: PlayerId }
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
	hint?: Hint
	coach?: ReactNode
}

function DieView({ d, onClick, hot, selected, hinted }: { d: Die; onClick?: () => void; hot?: boolean; selected?: boolean; hinted?: boolean }) {
	return (
		<button className={`die d${d.sides} ${hot ? 'hot' : ''} ${selected ? 'sel' : ''} ${hinted ? 'hint' : ''}`} onClick={onClick} title={`d${d.sides}`}>
			<span className="die-v">{d.value}</span>
			<span className="die-s">d{d.sides}</span>
		</button>
	)
}

export function Board({ state: s, send, viewer, hideHand, bot, onUndo, onMenu, onExport, hint, coach }: BoardProps) {
	const [sel, setSel] = useState<Sel>(null)
	const [mode, setMode] = useState<Mode>(null)
	const [error, setError] = useState<string | null>(null)
	const hinted = (label: string) => !mode && !!hint?.buttons?.some((b) => label.startsWith(b))
	const hl = (list: number[] | undefined, uid: number) => (list?.includes(uid) ? 'hint' : '')
	// hint.units = [attacker or host, target]: glow the first until you've chosen it, then the second
	const unitHint = (uid: number) => {
		const u = hint?.units ?? []
		if (mode?.kind === 'attack' || mode?.kind === 'gear') return u.length > 1 && u[1] === uid ? 'hint' : u.length === 1 && mode.kind === 'gear' && u[0] === uid ? 'hint' : ''
		return u[0] === uid && !(hint?.hand?.length) ? 'hint' : ''
	}
	const logRef = useRef<HTMLDivElement>(null)
	const deckRef = useRef<HTMLDivElement>(null)
	const rivalDeckRef = useRef<HTMLDivElement>(null)
	const handRef = useRef<HTMLDivElement>(null)
	const prevHand = useRef<{ viewer: PlayerId; uids: number[] } | null>(null)
	const me = viewer
	const rv = other_(me)
	const P = s.players
	const pend = s.pending
	const who = actor(s)
	const myTurnToAct = who === me
	const inspect = !sel || sel.kind === 'die' ? null : sel.kind === 'trash' ? (P[sel.owner].trash[P[sel.owner].trash.length - 1] ?? null) : sel.uid
	// a face-down Legend stays secret until it is flipped — even to its owner
	const inspectHidden = sel?.kind === 'legend' && !(P[0].legends.find((l) => l.uid === sel.uid) ?? P[1].legends.find((l) => l.uid === sel.uid))?.faceUp

	useEffect(() => {
		logRef.current?.scrollTo(0, logRef.current.scrollHeight)
	}, [s.log.length])
	useEffect(() => {
		setSel(null)
		setMode(null)
	}, [pend.kind, viewer])

	// Cards arriving in your hand fly in from your deck.
	const handUids = P[me].hand
	const handVisibleNow = !hideHand && pend.kind !== 'chooseFirst'
	useLayoutEffect(() => {
		const prev = prevHand.current
		prevHand.current = { viewer: me, uids: [...handUids] }
		if (!prev || prev.viewer !== me || !handVisibleNow) return
		const fresh = handUids.filter((u) => !prev.uids.includes(u))
		if (fresh.length === 0 || fresh.length > 8) return
		const deck = deckRef.current?.querySelector('.pile-card')?.getBoundingClientRect()
		if (!deck) return
		fresh.forEach((uid, i) => {
			const el = handRef.current?.querySelector<HTMLElement>(`[data-uid="${uid}"]`)
			if (!el || !el.animate) return
			const r = el.getBoundingClientRect()
			const scale = r.width / (el.offsetWidth || r.width) || 1 // the whole table is scaled to fit the screen
			const dx = (deck.left + deck.width / 2 - (r.left + r.width / 2)) / scale
			const dy = (deck.top + deck.height / 2 - (r.top + r.height / 2)) / scale
			el.animate(
				[
					{ transform: `translate(${dx}px, ${dy}px) scale(0.6) rotateY(180deg)`, opacity: 0.4 },
					{ transform: `translate(${dx * 0.4}px, ${dy * 0.4 - 60}px) scale(0.95) rotateY(90deg)`, opacity: 1, offset: 0.55 },
					{ transform: 'none', opacity: 1 },
				],
				{ duration: 520, delay: i * 110, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'backwards' },
			)
		})
	}, [handUids, me, handVisibleNow])

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
			<div key={u.uid} className={`slot unit ${u.spent ? 'spent' : ''} ${sel?.kind === 'field' && sel.uid === u.uid ? 'sel' : ''} ${targetable ? 'target' : ''} ${canAtk.has(u.uid) ? 'can-attack' : ''} ${isAtk ? 'in-fight' : ''} ${unitHint(u.uid)}`} onClick={() => clickUnit(u, owner)}>
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
			<div key={l.uid} className={`slot legend ${l.spent ? 'spent' : ''} ${sel?.kind === 'legend' && sel.uid === l.uid ? 'sel' : ''} ${mode?.kind === 'gear' && owner === me ? 'target' : ''} ${hl(hint?.legends, l.uid)}`} onClick={() => clickLegend(l, owner)}>
				<div className="card">{visible ? <CardFace d={d} /> : <CardBack label="LEGEND" />}</div>
				{l.gear.length > 0 && <div className="badge gear">⚙{l.gear.length}</div>}
			</div>
		)
	}
	// One player's mat, laid out like the official playmat: Fixer strip on the left (d20 → d4),
	// Rival Gigs / Friendly Gigs banners on top, the Field in the middle, Legends + Eddies along the
	// bottom, Deck and Trash stacked on the right. The rival's mat is the same, turned to face you.
	const DIE_ORDER = [20, 12, 10, 8, 6, 4]
	const side = (p: PlayerId, top: boolean) => {
		const pl = P[p]
		const readyEd = pl.eddies.filter((e) => !e.spent).length
		const cred = streetCred(pl)
		const fixerHot = pend.kind === 'chooseGig' && p === me && myTurnToAct ? new Set(legalGigDice(pl).map((d) => d.id)) : new Set<string>()
		const stealHot = pend.kind === 'steal' && p === rv && myTurnToAct
		const other = P[other_(p)]
		const aiming = mode?.kind === 'attack' && p === me
		const attacker = aiming ? P[me].field.find((u) => u.uid === mode!.attacker) : undefined
		const fixerSlots = DIE_ORDER.map((n) => pl.fixer.find((d) => d.sides === n) ?? null)
		const topTrash = pl.trash[pl.trash.length - 1]
		return (
			<div className={`mat ${top ? 'top' : 'bottom'} ${s.active === p ? 'active' : ''}`}>
				<div className="mat-fixer">
					<div className="vlabel">FIXER</div>
					{(top ? [...fixerSlots].reverse() : fixerSlots).map((d, i) =>
						d ? (
							<DieView key={d.id} d={{ ...d, value: d.sides }} hot={fixerHot.has(d.id)} hinted={!!hint?.dice?.includes(d.id)} onClick={() => clickDie(d, p, 'fixer')} />
						) : (
							<div key={i} className="die-slot">d{(top ? [...DIE_ORDER].reverse() : DIE_ORDER)[i]}</div>
						),
					)}
				</div>

				<div className="mat-gigs">
					<button
						className={`banner rival-gigs ${aiming ? 'aim' : ''} ${aiming && hint?.gigTarget ? 'hint' : ''}`}
						disabled={!aiming}
						onClick={() => aiming && act({ t: 'attack', player: me, attacker: mode!.attacker, target: { kind: 'gigs' } })}
					>
						<span className="banner-t">RIVAL GIGS</span>
						{aiming && attacker ? (
							<span className="banner-v">Attack! steals {Math.min(gigsToSteal(unitPower(s, attacker)), other.gigs.length)}</span>
						) : (
							<span className="banner-v">
								{other.gigs.length} · ☆ {streetCred(other) ?? '—'}
							</span>
						)}
					</button>
					<div className="banner friendly-gigs">
						<span className="banner-t">FRIENDLY GIGS</span>
						<span className="banner-v">
							{pl.gigs.length}/7 · ☆ {cred ?? '—'}
						</span>
						<div className="dice-row">
							{pl.gigs.map((d) => (
								<DieView key={d.id} d={d} hot={stealHot} hinted={!!hint?.dice?.includes(d.id)} selected={sel?.kind === 'die' && sel.id === d.id} onClick={() => clickDie(d, p, 'gigs')} />
							))}
						</div>
					</div>
				</div>

				<div className={`mat-field ${mode?.kind === 'attack' && p === rv ? 'aim' : ''}`}>
					<div className="mat-name">
						{pl.name}
						{s.active === p && <span className="turn-dot"> ● turn {pl.turnsTaken + 1}</span>}
						{p !== me && <span className="hand-n"> · ✋ {pl.hand.length}</span>}
					</div>
					{pl.field.length === 0 && <div className="empty">FIELD</div>}
					{pl.field.map((u) => unitView(u, p))}
				</div>

				<div className="mat-bottom">
					<div className="zone legends">
						<div className="zl">Legends</div>
						<div className="cards">{pl.legends.map((l) => legendView(l, p))}</div>
					</div>
					<div className="zone eddies">
						<div className="zl">
							Eddies <b>{available(s, p)} €$</b>
							{pl.eddies.length > 0 && (
								<span className="dim">
									{' '}
									({readyEd} of {pl.eddies.length} sold cards ready)
								</span>
							)}
						</div>
						<div className="eddie-row">
							{pl.eddies.map((e) => (
								<div key={e.uid} className={`eddie ${e.spent ? 'spent' : ''}`} />
							))}
						</div>
					</div>
					{pl.removed.length > 0 && <div className="removed">Removed: {pl.removed.length}</div>}
				</div>

				<div className="mat-piles">
					<div className="pile deck" ref={p === me ? deckRef : rivalDeckRef} title="Deck">
						<div className="zl">Deck</div>
						<div className="pile-card">
							{pl.deck.length > 0 ? <CardBack /> : <div className="pile-empty" />}
							{pl.deck.length > 1 && <div className="pile-shadow" />}
							<div className="pile-n">{pl.deck.length}</div>
						</div>
					</div>
					<div className={`pile trash ${sel?.kind === 'trash' && sel.owner === p ? 'sel' : ''}`} onClick={() => topTrash !== undefined && setSel({ kind: 'trash', owner: p })} title="Trash">
						<div className="zl">Trash</div>
						<div className="pile-card">
							{topTrash !== undefined ? <CardFace d={def(s, topTrash)} /> : <div className="pile-empty" />}
							<div className="pile-n">{pl.trash.length}</div>
						</div>
					</div>
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
				<div className="inspect">
					{inspect === null ? (
						<div className="inspect-hint">Tap a card to look at it</div>
					) : inspectHidden ? (
						<CardBack label="LEGEND" />
					) : (
						<CardFace d={def(s, inspect)} big />
					)}
				</div>
				{inspectHidden && <div className="inspect-text">A face-down Legend. Nobody — not even you — sees it until it’s flipped with Call a Legend (it’s picked at random). You can still spend it as 1 €$.</div>}
				{inspect !== null && !inspectHidden && def(s, inspect).text && def(s, inspect).image && <div className="inspect-text">{def(s, inspect).text}</div>}
				<div className="tools">
					{tools.map((t) => (
						<button key={t.label} className={`${t.cls ?? ''} ${hinted(t.label) ? 'hint' : ''}`} onClick={t.onClick}>
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
							<button key={b.label} className={`${b.primary ? 'primary' : ''} ${hinted(b.label) ? 'hint' : ''}`} onClick={b.onClick}>
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
				<div className="hand" ref={handRef} style={{ ['--overlap' as string]: `${Math.min(0, (950 - P[me].hand.length * 120) / Math.max(1, P[me].hand.length - 1))}px` }}>
					{P[me].hand.map((uid) =>
						handVisible ? (
							<div key={uid} data-uid={uid} className={`slot hand-card ${hl(hint?.hand, uid)} ${sel?.kind === 'hand' && sel.uid === uid ? 'sel' : ''} ${myTurnToAct && canPlay(s, me, uid) && (pend.kind === 'main' || pend.kind === 'react') ? 'playable' : ''}`} onClick={() => setSel({ kind: 'hand', uid })}>
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
				{coach}
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
