// The Afterlife rules engine: newGame(...) and apply(state, intent) -> state.
// Rules follow the Cyberpunk TCG Gameplay Guide and Comprehensive Rules (Aug 2026 edition).
// Card abilities: scripted ones live in effects.ts (triggers queue Tasks, resolved by settle());
// everything else is applied by players with the manual table tools.

import { BLOCKER_GEAR, CANT_ATTACK, NO_GIG_ATTACKS, READY_AT_END_GEAR, makeTask, runTask, staticPowerBonus, unblockable } from './effects'
import { Rng } from './rng'
import {
	DIE_SIDES,
	other,
	type AttackTarget,
	type CardDef,
	type DeckList,
	type FieldUnit,
	type GameState,
	type Intent,
	type LegendSlot,
	type ManualOp,
	type PlayerId,
	type PlayerState,
} from './types'

export const WIN_GIGS = 7
export const OPENING_HAND = 6
export const DECK_MIN = 40
export const DECK_MAX = 50
export const MAX_COPIES = 3

export class IllegalIntent extends Error {}
function fail(msg: string): never {
	throw new IllegalIntent(msg)
}

// ───────────────────────── setup ─────────────────────────

export interface NewGameOptions {
	seed: number
	cards: Record<string, CardDef>
	decks: [DeckList, DeckList]
	names?: [string, string]
}

export function newGame(opts: NewGameOptions): GameState {
	const rng = new Rng(opts.seed >>> 0 || 1)
	const instances: GameState['instances'] = {}
	let nextUid = 1
	const mk = (cardId: string, owner: PlayerId) => {
		if (!opts.cards[cardId]) fail(`Unknown card ${cardId}`)
		const uid = nextUid++
		instances[uid] = { uid, cardId, owner }
		return uid
	}
	const players = ([0, 1] as PlayerId[]).map((p): PlayerState => {
		const deck = opts.decks[p]
		const legends = rng.shuffle(deck.legends.map((id) => mk(id, p)))
		const main = rng.shuffle(deck.main.map((id) => mk(id, p)))
		const hand = main.splice(0, OPENING_HAND)
		return {
			name: opts.names?.[p] ?? `Player ${p + 1}`,
			deck: main,
			hand,
			trash: [],
			removed: [],
			eddies: [],
			legends: legends.map((uid) => ({ uid, faceUp: false, spent: false, skipNextReady: false, gear: [] })),
			field: [],
			fixer: DIE_SIDES.map((sides) => ({ id: `${p}-d${sides}`, sides, value: sides })),
			gigs: [],
			soldThisTurn: false,
			calledThisTurn: false,
			mulliganed: false,
			turnsTaken: 0,
		}
	}) as [PlayerState, PlayerState]

	// Both roll a d20, re-rolling ties; the higher roll chooses who goes first.
	let r0 = 0
	let r1 = 0
	while (r0 === r1) {
		r0 = rng.roll(20)
		r1 = rng.roll(20)
	}
	const chooser: PlayerId = r0 > r1 ? 0 : 1
	const state: GameState = {
		version: 1,
		rng: rng.seed,
		cards: opts.cards,
		instances,
		players,
		active: chooser,
		firstPlayer: null,
		turn: 0,
		overtime: false,
		emptyFixerTurns: 0,
		pending: { kind: 'chooseFirst', player: chooser, rolls: [r0, r1] },
		log: [],
	}
	log(state, `Roll for first: ${players[0].name} ${r0}, ${players[1].name} ${r1}. ${players[chooser].name} chooses who goes first.`)
	return state
}

// ───────────────────────── helpers ─────────────────────────

const log = (s: GameState, line: string) => {
	s.log.push(line)
}
export const def = (s: GameState, uid: number): CardDef => s.cards[s.instances[uid].cardId]
export const nameOf = (s: GameState, uid: number) => {
	const d = def(s, uid)
	return d.subtitle ? `${d.name} — ${d.subtitle}` : d.name
}
export const ownerOf = (s: GameState, uid: number) => s.instances[uid].owner

export function findUnit(s: GameState, uid: number): FieldUnit | undefined {
	return s.players[ownerOf(s, uid)].field.find((u) => u.uid === uid)
}
function findLegend(s: GameState, uid: number): LegendSlot | undefined {
	return s.players[ownerOf(s, uid)].legends.find((l) => l.uid === uid)
}

/** Current power of a Unit in the field (raw, may be negative; compare with effective()). */
export function unitPower(s: GameState, u: FieldUnit): number {
	const base = def(s, u.uid).power ?? 0
	const gear = u.gear.reduce((sum, g) => sum + (def(s, g).power ?? 0), 0)
	return base + gear + u.powerThisTurn + u.powerPermanent + staticPowerBonus(s, u.uid)
}
export const hasBlocker = (s: GameState, u: FieldUnit) => def(s, u.uid).keywords.includes('blocker') || u.gear.some((g) => BLOCKER_GEAR.has(s.instances[g].cardId))
/** CR 2.10.1: negative values read as 0 for references and comparisons. */
const effective = (n: number) => Math.max(0, n)

/** Street Cred: sum of top faces in the Gig area; null when the Gig area is empty (CR 2.10.2). */
export function streetCred(p: PlayerState): number | null {
	return p.gigs.length === 0 ? null : p.gigs.reduce((a, d) => a + d.value, 0)
}

export function gigsToSteal(power: number): number {
	const p = effective(power)
	return p === 0 ? 0 : Math.floor(p / 10) + 1
}

/** Who must act next, or null when the game is over. */
export function actor(s: GameState): PlayerId | null {
	return s.pending.kind === 'over' ? null : s.pending.player
}

// ───────────────────────── payment ─────────────────────────

type PaySource = { kind: 'eddie' | 'legend'; uid: number }

/** Sources that can pay 1 €$ right now: ready Eddies first, then face-down Legends, then face-up Legends with a Sell tag. */
export function paySources(s: GameState, p: PlayerId, exclude?: number): PaySource[] {
	const pl = s.players[p]
	const out: PaySource[] = []
	for (const e of pl.eddies) if (!e.spent) out.push({ kind: 'eddie', uid: e.uid })
	for (const l of [...pl.legends].reverse())
		if (!l.spent && !l.faceUp && l.uid !== exclude) out.push({ kind: 'legend', uid: l.uid })
	for (const l of [...pl.legends].reverse())
		if (!l.spent && l.faceUp && def(s, l.uid).sell && l.uid !== exclude) out.push({ kind: 'legend', uid: l.uid })
	return out
}
export const available = (s: GameState, p: PlayerId, exclude?: number) => paySources(s, p, exclude).length

function pay(s: GameState, p: PlayerId, amount: number, exclude?: number) {
	const src = paySources(s, p, exclude)
	if (src.length < amount) fail(`Not enough Eddies (need ${amount}, have ${src.length})`)
	for (const x of src.slice(0, amount)) {
		if (x.kind === 'eddie') s.players[p].eddies.find((e) => e.uid === x.uid)!.spent = true
		else spendCard(s, x.uid)
	}
}

// ───────────────────────── zones ─────────────────────────

/** Move a field card (and its Gear) out of play. Go Solo Legends are removed from the game. */
function leaveField(s: GameState, uid: number, to: 'trash' | 'hand') {
	const owner = ownerOf(s, uid)
	const pl = s.players[owner]
	const i = pl.field.findIndex((u) => u.uid === uid)
	if (i < 0) return
	const [u] = pl.field.splice(i, 1)
	for (const g of u.gear) s.players[ownerOf(s, g)].trash.push(g)
	if (u.goSolo) pl.removed.push(uid)
	else if (to === 'hand') pl.hand.push(uid)
	else pl.trash.push(uid)
}

function defeat(s: GameState, uid: number) {
	log(s, `${nameOf(s, uid)} is defeated.`)
	leaveField(s, uid, 'trash')
}

// ───────────────────────── effects ─────────────────────────

/** Queue a card ability, if it is scripted. */
export function fire(s: GameState, key: string, source: number, owner: PlayerId, data?: Record<string, unknown>) {
	const t = makeTask(s, key, source, owner, data)
	if (t) (s.queue ??= []).push(t)
}
const cid = (s: GameState, uid: number) => s.instances[uid].cardId

/** Spend a Unit or Legend; Gear on it with "when the host is spent" triggers. */
export function spendCard(s: GameState, uid: number) {
	const t = findUnit(s, uid) ?? findLegend(s, uid)
	if (!t || t.spent) return
	t.spent = true
	for (const g of t.gear) fire(s, `${cid(s, g)}:hostSpent`, g, ownerOf(s, g), { host: uid })
}
/** Defeat by a card effect: Defeated triggers fire. */
export function defeatUnit(s: GameState, uid: number) {
	if (!findUnit(s, uid)) return
	const owner = ownerOf(s, uid)
	defeat(s, uid)
	fire(s, `${cid(s, uid)}:defeated`, uid, owner)
}
export function drawCards(s: GameState, p: PlayerId, n: number) {
	for (let i = 0; i < n; i++) if (!draw(s, p)) return
	if (n > 0) log(s, `${s.players[p].name} draws ${n === 1 ? 'a card' : `${n} cards`}.`)
}
/** Call a Legend without paying (still the one Call this turn). Random unless a uid is given. */
export function freeCallLegend(s: GameState, p: PlayerId, uid?: number) {
	const pl = s.players[p]
	const down = pl.legends.filter((l) => !l.faceUp)
	if (!down.length || pl.calledThisTurn) return
	let pick = uid !== undefined ? down.find((l) => l.uid === uid) : undefined
	if (!pick) {
		const rng = new Rng(s.rng)
		pick = down[rng.int(down.length)]
		s.rng = rng.seed
	}
	flipCalled(s, p, pick)
}
function flipCalled(s: GameState, p: PlayerId, pick: LegendSlot) {
	const pl = s.players[p]
	pick.faceUp = true
	pl.calledThisTurn = true
	const d = def(s, pick.uid)
	log(s, `${pl.name} calls a Legend: ${nameOf(s, pick.uid)}${d.text ? ` — “${d.text}”` : ''}`)
	fire(s, `${cid(s, pick.uid)}:call`, pick.uid, p)
}
export const overtimeCheckPublic = (s: GameState) => overtimeCheck(s)

/** Resolve queued abilities. Stops at the first question; play continues at `after` once empty. */
function settle(s: GameState) {
	if (!s.queue?.length) return
	if (!s.after) s.after = s.pending
	while (s.queue?.length && s.pending.kind !== 'over') {
		const task = s.queue.shift()!
		s.pending = s.after!
		const r = runTask(s, task)
		if ('need' in r) {
			s.queue.unshift(task)
			s.pending = { kind: 'choose', player: r.need.player, question: r.need.question, task }
			return
		}
		const { cards, ...rest } = r.state
		void cards
		Object.assign(s, rest)
	}
	if (s.pending.kind !== 'over') s.pending = s.after!
	s.after = null
	s.queue = []
}

function draw(s: GameState, p: PlayerId): boolean {
	const pl = s.players[p]
	if (pl.deck.length === 0) {
		endGame(s, other(p), `${pl.name} has to draw from an empty deck`)
		return false
	}
	pl.hand.push(pl.deck.shift()!)
	return true
}

function endGame(s: GameState, winner: PlayerId, reason: string) {
	s.pending = { kind: 'over', winner, reason }
	log(s, `${s.players[winner].name} wins: ${reason}.`)
}

/** In Overtime, seven Gigs (a majority of the twelve dice) wins at any point (CR 1.11). */
function overtimeCheck(s: GameState) {
	if (!s.overtime || s.pending.kind === 'over') return
	for (const p of [s.active, other(s.active)] as PlayerId[])
		if (s.players[p].gigs.length >= WIN_GIGS) return endGame(s, p, `${WIN_GIGS} Gigs in Overtime`)
}

// ───────────────────────── turn flow ─────────────────────────

function startTurn(s: GameState, p: PlayerId) {
	s.active = p
	s.turn++
	const pl = s.players[p]
	const bothEmpty = s.players[0].fixer.length === 0 && s.players[1].fixer.length === 0
	log(s, `── Turn ${pl.turnsTaken + 1} for ${pl.name}${s.overtime ? ' (Overtime)' : ''} ──`)
	// Win check happens before the first step of the Start Phase (CR 1.10.1).
	if (pl.gigs.length >= WIN_GIGS) return endGame(s, p, `starts the turn with ${pl.gigs.length} Gigs`)
	s.emptyFixerTurns = bothEmpty ? s.emptyFixerTurns + 1 : 0
	s.players[0].calledThisTurn = false
	s.players[1].calledThisTurn = false
	pl.soldThisTurn = false
	pl.usedThisTurn = []
	pl.stealShield = false
	// Ready step
	for (const u of pl.field) u.spent = false
	for (const e of pl.eddies) e.spent = false
	for (const l of pl.legends) {
		if (l.skipNextReady) l.skipNextReady = false
		else l.spent = false
	}
	// Draw step
	if (!draw(s, p)) return
	// Gig step
	const choices = legalGigDice(pl)
	if (choices.length === 0) s.pending = { kind: 'main', player: p }
	else if (choices.length === 1) gainGig(s, p, choices[0].id)
	else s.pending = { kind: 'chooseGig', player: p }
}

/** The d20 may be taken only when it is the last die in the Fixer area. */
export function legalGigDice(pl: PlayerState) {
	return pl.fixer.filter((d) => d.sides !== 20 || pl.fixer.length === 1)
}

function gainGig(s: GameState, p: PlayerId, dieId: string) {
	const pl = s.players[p]
	const i = pl.fixer.findIndex((d) => d.id === dieId)
	if (i < 0) fail('That die is not in your Fixer area')
	if (pl.fixer[i].sides === 20 && pl.fixer.length > 1) fail('The d20 can only be taken last')
	const rng = new Rng(s.rng)
	const [die] = pl.fixer.splice(i, 1)
	die.value = rng.roll(die.sides)
	s.rng = rng.seed
	pl.gigs.push(die)
	log(s, `${pl.name} takes the d${die.sides} Gig and rolls ${die.value}.`)
	s.pending = { kind: 'main', player: p }
	overtimeCheck(s)
}

function endTurn(s: GameState, p: PlayerId) {
	const pl = s.players[p]
	// End of turn abilities (none of the starter cards ask a question here).
	const readyEddies = (n: number, why: string) => {
		const spent = pl.eddies.filter((e) => e.spent).slice(0, n)
		for (const e of spent) e.spent = false
		if (spent.length) log(s, `${why}: ${pl.name} readies ${spent.length} Edd${spent.length > 1 ? 'ies' : 'ie'}.`)
	}
	for (const u of pl.field) {
		if (u.stoleThisTurn && cid(s, u.uid) === 'delamain-cab') readyEddies(1, 'Delamain Cab')
		if (u.eotEddies) readyEddies(u.eotEddies, 'Dying Night')
	}
	for (const h of [...pl.field, ...pl.legends])
		if (h.spent && h.gear.some((g) => READY_AT_END_GEAR.has(cid(s, g)))) {
			h.spent = false
			log(s, `Sandevistan readies ${'faceUp' in h && !h.faceUp ? 'a face-down Legend' : nameOf(s, h.uid)}.`)
		}
	pl.turnsTaken++
	for (const side of s.players) {
		side.fightShield = 0
		for (const u of side.field) {
			u.lag = false
			u.attackDespiteLag = false
			u.powerThisTurn = 0
			u.stoleThisTurn = false
			u.eotEddies = 0
		}
	}
	// Overtime begins after two consecutive turns that both started with every Fixer area empty.
	if (!s.overtime && s.emptyFixerTurns >= 2) {
		s.overtime = true
		log(s, 'Overtime! From now on, 7 Gigs wins immediately.')
		overtimeCheck(s)
		if (s.pending.kind === 'over') return
	}
	startTurn(s, other(p))
}

// ───────────────────────── actions ─────────────────────────

function canAttack(s: GameState, u: FieldUnit) {
	if (u.spent) return false
	if (CANT_ATTACK.has(cid(s, u.uid))) return false
	if (u.lag && !u.attackDespiteLag && !def(s, u.uid).keywords.includes('adrenaline')) return false
	return true
}

function play(s: GameState, p: PlayerId, uid: number, target: number | undefined, reacting: boolean) {
	const pl = s.players[p]
	if (!pl.hand.includes(uid)) fail('That card is not in your hand')
	const d = def(s, uid)
	if (reacting && !(d.type === 'program' && d.keywords.includes('quick'))) fail('Only Quick cards can be played as a reaction')
	if (d.type === 'legend') fail('Legends are not played from hand')
	const cost = d.cost ?? 0
	if (d.type === 'gear') {
		if (target === undefined) fail('Choose a friendly Unit or Legend to equip')
		const host = pl.field.find((u) => u.uid === target) ?? pl.legends.find((l) => l.uid === target)
		if (!host) fail('Gear must be equipped to a friendly Unit or Legend')
		pay(s, p, cost)
		pl.hand.splice(pl.hand.indexOf(uid), 1)
		host!.gear.push(uid)
		const hostLegend = pl.legends.find((l) => l.uid === target)
		// a face-down Legend stays secret: don't name it in the log
		log(s, `${pl.name} equips ${nameOf(s, uid)} to ${hostLegend && !hostLegend.faceUp ? 'a face-down Legend' : nameOf(s, target!)}.`)
		jackie(s, p, uid)
		return
	}
	pay(s, p, cost)
	pl.hand.splice(pl.hand.indexOf(uid), 1)
	if (d.type === 'unit') {
		pl.field.push({
			uid,
			spent: false,
			lag: true,
			attackDespiteLag: false,
			goSolo: false,
			gear: [],
			powerThisTurn: 0,
			powerPermanent: 0,
		})
		log(s, `${pl.name} plays ${nameOf(s, uid)} (${cost} €$).`)
		fire(s, `${d.id}:play`, uid, p)
		jackie(s, p, uid)
	} else {
		pl.trash.push(uid)
		const scripted = makeTask(s, `${d.id}:program`, uid, p)
		log(s, `${pl.name} runs ${nameOf(s, uid)} (${cost} €$)${!scripted && d.text ? `: “${d.text}”` : '.'}`)
		fire(s, `${d.id}:program`, uid, p)
	}
}

/** Jackie Welles (face-up Legend): the first Blue Unit or Gear you play each turn. */
function jackie(s: GameState, p: PlayerId, uid: number) {
	const pl = s.players[p]
	if (def(s, uid).color !== 'blue' || pl.usedThisTurn?.includes('jackie')) return
	const j = pl.legends.find((l) => l.faceUp && cid(s, l.uid) === 'jackie-welles-pour-one-out-for-me')
	if (!j) return
	;(pl.usedThisTurn ??= []).push('jackie')
	fire(s, 'jackie-welles-pour-one-out-for-me:static', j.uid, p)
}

function attack(s: GameState, p: PlayerId, attacker: number, target: AttackTarget) {
	const pl = s.players[p]
	const u = pl.field.find((x) => x.uid === attacker)
	if (!u) fail('That Unit is not on your field')
	if (!canAttack(s, u!)) fail(u!.spent ? 'That Unit is spent' : 'That Unit has Lag and cannot attack this turn')
	if (target.kind === 'unit') {
		const rival = s.players[other(p)].field.find((x) => x.uid === target.uid)
		if (!rival) fail('Target must be a rival Unit')
		if (!rival!.spent) fail('Ready Units cannot be attacked')
	} else if (NO_GIG_ATTACKS.has(cid(s, attacker))) fail('This Unit can only attack rival Units')
	s.attacking = attacker
	log(
		s,
		`${pl.name}'s ${nameOf(s, attacker)} (${effective(unitPower(s, u!))} power) attacks ${
			target.kind === 'gigs' ? `${s.players[other(p)].name}'s Gigs` : nameOf(s, target.uid)
		}.`,
	)
	spendCard(s, attacker)
	fire(s, `${cid(s, attacker)}:attack`, attacker, p)
	for (const g of u!.gear) fire(s, `${cid(s, g)}:hostAttack`, g, p, { host: attacker })
	if (def(s, attacker).tags.some((t) => t.toLowerCase() === 'arasaka') && !pl.usedThisTurn?.includes('yorinobu')) {
		const y = pl.legends.find((l) => l.faceUp && cid(s, l.uid) === 'yorinobu-arasaka-embracing-destruction')
		if (y) {
			;(pl.usedThisTurn ??= []).push('yorinobu')
			fire(s, 'yorinobu-arasaka-embracing-destruction:static', y.uid, p)
		}
	}
	s.pending = { kind: 'react', player: other(p), attack: { attacker, target, redirected: false } }
}

function block(s: GameState, p: PlayerId, blocker: number) {
	if (s.pending.kind !== 'react') fail('No attack to block')
	const pend = s.pending as Extract<GameState['pending'], { kind: 'react' }>
	const u = s.players[p].field.find((x) => x.uid === blocker)
	if (!u) fail('Blocker must be your Unit')
	if (!hasBlocker(s, u!)) fail('That Unit does not have Blocker')
	if (u!.spent) fail('A Blocker must be ready to spend')
	if (pend.attack.target.kind === 'unit' && pend.attack.target.uid === blocker) fail('That Unit is already the target')
	if (unblockable(s, pend.attack.attacker)) fail('That attacker can’t be blocked right now')
	spendCard(s, blocker)
	pend.attack.redirected = pend.attack.redirected || pend.attack.target.kind === 'gigs'
	pend.attack.target = { kind: 'unit', uid: blocker }
	log(s, `${s.players[p].name} spends ${nameOf(s, blocker)} to block.`)
}

function resolveAttack(s: GameState) {
	const pend = s.pending as Extract<GameState['pending'], { kind: 'react' }>
	const { attacker, target, redirected } = pend.attack
	const ap = s.active
	const au = findUnit(s, attacker)
	s.pending = { kind: 'main', player: ap }
	s.attacking = null
	if (!au) {
		log(s, 'The attacker left the field; the attack ends.')
		return
	}
	if (target.kind === 'unit') {
		const du = findUnit(s, target.uid)
		if (!du) {
			log(s, 'The target left the field; the attack ends.')
			return
		}
		s.attacking = attacker // "while attacking" bonuses still count in the fight
		const pa = effective(unitPower(s, au))
		const pd = effective(unitPower(s, du))
		s.attacking = null
		log(s, `Fight: ${nameOf(s, attacker)} ${pa} vs ${nameOf(s, target.uid)} ${pd}.`)
		// A Unit loses with equal or lower power; a 0-power Unit cannot defeat anything (CR 11.4).
		let attackerLoses = pa <= pd && pd > 0
		let defenderLoses = pd <= pa && pa > 0
		// Reboot Optics: the next rival Unit to fight this turn doesn't defeat the shielded player's Unit.
		const shield = (owner: PlayerId) => {
			const pl = s.players[owner]
			if (!pl.fightShield) return false
			pl.fightShield--
			log(s, `Reboot Optics: ${pl.name}'s Unit is not defeated.`)
			return true
		}
		if (defenderLoses && shield(ownerOf(s, target.uid))) defenderLoses = false
		if (attackerLoses && shield(ap)) attackerLoses = false
		if (!attackerLoses && !defenderLoses) log(s, 'Neither Unit is defeated.')
		// Satori: when the host wins a fight against a rival Unit
		const win = (uid: number, u: FieldUnit) => {
			for (const g of u.gear) fire(s, `${cid(s, g)}:hostWin`, g, ownerOf(s, g), { host: uid })
		}
		if (defenderLoses && !attackerLoses) win(attacker, au)
		if (attackerLoses && !defenderLoses) win(target.uid, du)
		if (defenderLoses) defeatUnit(s, target.uid)
		if (attackerLoses) defeatUnit(s, attacker)
		if (redirected) log(s, 'The attack was redirected, so no Gigs are stolen.')
		return
	}
	const rival = s.players[other(ap)]
	s.attacking = attacker
	const pw = effective(unitPower(s, au))
	s.attacking = null
	// Chrome Fang: only Gigs worth no more than the attacker's power can be stolen.
	const maxValue = rival.stealShield ? pw : undefined
	const eligible = rival.gigs.filter((d) => maxValue === undefined || d.value <= maxValue)
	if (maxValue !== undefined && eligible.length < rival.gigs.length) log(s, `Chrome Fang: only Gigs worth ${maxValue} or less can be stolen.`)
	const n = Math.min(gigsToSteal(pw), eligible.length)
	if (n === 0) {
		log(s, 'No Gigs are stolen.')
		return
	}
	au.stoleThisTurn = true
	if (n === eligible.length) {
		for (const d of eligible) moveDie(s, d.id, ap)
		overtimeCheck(s)
		return
	}
	s.pending = maxValue === undefined ? { kind: 'steal', player: ap, remaining: n } : { kind: 'steal', player: ap, remaining: n, maxValue }
}

function moveDie(s: GameState, dieId: string, to: PlayerId) {
	const from = other(to)
	const i = s.players[from].gigs.findIndex((d) => d.id === dieId)
	if (i < 0) fail('That die is not in the rival Gig area')
	const [d] = s.players[from].gigs.splice(i, 1)
	s.players[to].gigs.push(d)
	log(s, `${s.players[to].name} steals the d${d.sides} (${d.value}).`)
}

function callLegend(s: GameState, p: PlayerId) {
	const pl = s.players[p]
	if (pl.calledThisTurn) fail('You already called a Legend this turn')
	if (!pl.legends.some((l) => !l.faceUp)) fail('No face-down Legends left')
	pay(s, p, 1)
	const rng = new Rng(s.rng)
	const down = pl.legends.filter((l) => !l.faceUp)
	const pick = down[rng.int(down.length)]
	s.rng = rng.seed
	flipCalled(s, p, pick)
}

function goSolo(s: GameState, p: PlayerId, uid: number) {
	const pl = s.players[p]
	const i = pl.legends.findIndex((l) => l.uid === uid)
	if (i < 0) fail('That Legend is not in your Legends area')
	const slot = pl.legends[i]
	const d = def(s, uid)
	if (!slot.faceUp) fail('Only a face-up Legend can Go Solo')
	if (!d.keywords.includes('goSolo')) fail('That Legend does not have Go Solo')
	if (d.cost === null) fail('A Legend with a Null cost cannot be played')
	pay(s, p, d.cost, uid)
	pl.legends.splice(i, 1)
	pl.field.push({
		uid,
		spent: false,
		lag: true,
		attackDespiteLag: true,
		goSolo: true,
		gear: slot.gear,
		powerThisTurn: 0,
		powerPermanent: 0,
	})
	log(s, `${pl.name}'s ${nameOf(s, uid)} goes solo (${d.cost} €$).`)
}

function manual(s: GameState, p: PlayerId, m: ManualOp) {
	const me = s.players[p].name
	switch (m.op) {
		case 'defeat':
			if (!findUnit(s, m.uid)) fail('Not a Unit in play')
			defeat(s, m.uid)
			break
		case 'toHand': {
			if (!findUnit(s, m.uid)) fail('Not a Unit in play')
			log(s, `${me}: ${nameOf(s, m.uid)} returns to its owner's hand.`)
			leaveField(s, m.uid, 'hand')
			break
		}
		case 'discard': {
			const pl = s.players[p]
			const i = pl.hand.indexOf(m.uid)
			if (i < 0) fail('Not in your hand')
			pl.hand.splice(i, 1)
			pl.trash.push(m.uid)
			log(s, `${me} discards ${nameOf(s, m.uid)}.`)
			break
		}
		case 'power': {
			const u = findUnit(s, m.uid)
			if (!u) fail('Not a Unit in play')
			if (m.permanent) u!.powerPermanent += m.delta
			else u!.powerThisTurn += m.delta
			log(s, `${me}: ${nameOf(s, m.uid)} ${m.delta >= 0 ? '+' : ''}${m.delta} power${m.permanent ? '' : ' this turn'}.`)
			break
		}
		case 'toggleSpent': {
			const u = findUnit(s, m.uid) ?? findLegend(s, m.uid)
			const e = s.players[ownerOf(s, m.uid)].eddies.find((x) => x.uid === m.uid)
			const t = u ?? e
			if (!t) fail('Nothing to spend or ready')
			t!.spent = !t!.spent
			log(s, `${me}: ${e ? 'an Eddie' : nameOf(s, m.uid)} is now ${t!.spent ? 'spent' : 'ready'}.`)
			break
		}
		case 'adrenaline': {
			const u = findUnit(s, m.uid)
			if (!u) fail('Not a Unit in play')
			u!.attackDespiteLag = true
			log(s, `${me}: ${nameOf(s, m.uid)} gains Adrenaline this turn.`)
			break
		}
		case 'draw':
			if (draw(s, p)) log(s, `${me} draws a card.`)
			break
		case 'trashTop': {
			const pl = s.players[p]
			if (pl.deck.length === 0) fail('Deck is empty')
			const c = pl.deck.shift()!
			pl.trash.push(c)
			log(s, `${me} trashes ${nameOf(s, c)} from the top of the deck.`)
			break
		}
		case 'moveDie': {
			const from = s.players[0].gigs.some((d) => d.id === m.dieId) ? 0 : 1
			if (!s.players[from].gigs.some((d) => d.id === m.dieId)) fail('Die not in a Gig area')
			moveDie(s, m.dieId, other(from))
			overtimeCheck(s)
			break
		}
		case 'reroll':
		case 'setDie': {
			const d = [...s.players[0].gigs, ...s.players[1].gigs].find((x) => x.id === m.dieId)
			if (!d) fail('Die not in a Gig area')
			if (m.op === 'reroll') {
				const rng = new Rng(s.rng)
				d!.value = rng.roll(d!.sides)
				s.rng = rng.seed
			} else {
				if (m.value < 1 || m.value > d!.sides) fail('Value out of range')
				d!.value = m.value
			}
			log(s, `${me}: the d${d!.sides} is now ${d!.value}.`)
			break
		}
		case 'flipLegend': {
			const l = findLegend(s, m.uid)
			if (!l) fail('Not a Legend')
			l!.faceUp = !l!.faceUp
			log(s, `${me}: ${l!.faceUp ? nameOf(s, m.uid) + ' is flipped face-up' : 'a Legend is turned face-down'}.`)
			break
		}
	}
}

// ───────────────────────── apply ─────────────────────────

export function apply(prev: GameState, intent: Intent): GameState {
	const s = applyRaw(prev, intent)
	settle(s)
	return s
}

function applyRaw(prev: GameState, intent: Intent): GameState {
	const s: GameState = structuredClone(prev)
	const pend = s.pending
	if (pend.kind === 'over') fail('The game is over')
	const p = intent.player
	if (intent.t === 'concede') {
		endGame(s, other(p), `${s.players[p].name} concedes`)
		return s
	}
	if (intent.t === 'manual') {
		if (pend.kind !== 'main' && pend.kind !== 'react' && pend.kind !== 'choose') fail('Table tools are available during play only')
		manual(s, p, intent.m)
		return s
	}
	if (pend.player !== p) fail(`It is ${s.players[pend.player].name}'s decision`)

	if (pend.kind === 'choose') {
		if (intent.t !== 'choose') fail('Answer the card’s question first')
		const q = pend.question
		const picks = intent.picks
		if (picks.length < q.min || picks.length > q.max) fail(q.min === q.max ? `Choose ${q.min}` : `Choose ${q.min}–${q.max}`)
		if (new Set(picks).size !== picks.length || picks.some((id) => !q.options.some((o) => o.id === id))) fail('Not one of the choices')
		const task = s.queue![0]
		task.answers.push(picks)
		s.pending = s.after!
		return s
	}
	if (intent.t === 'choose') fail('Nothing to choose')

	switch (intent.t) {
		case 'chooseFirst': {
			if (pend.kind !== 'chooseFirst') fail('Not choosing a first player')
			const f = intent.first
			s.firstPlayer = f
			// The first player spends their two leftmost Legends; they don't ready on that first turn.
			for (const l of s.players[f].legends.slice(0, 2)) {
				l.spent = true
				l.skipNextReady = true
			}
			log(s, `${s.players[f].name} goes first and spends two Legends.`)
			s.pending = { kind: 'mulligan', player: f }
			return s
		}
		case 'mulligan': {
			if (pend.kind !== 'mulligan') fail('Not deciding a mulligan')
			const pl = s.players[p]
			if (intent.redraw) {
				const rng = new Rng(s.rng)
				pl.deck = rng.shuffle([...pl.deck, ...pl.hand])
				s.rng = rng.seed
				pl.hand = pl.deck.splice(0, OPENING_HAND)
				pl.mulliganed = true
				log(s, `${pl.name} mulligans.`)
			} else log(s, `${pl.name} keeps.`)
			if (p === s.firstPlayer) s.pending = { kind: 'mulligan', player: other(p) }
			else startTurn(s, s.firstPlayer!)
			return s
		}
		case 'chooseGig':
			if (pend.kind !== 'chooseGig') fail('Not choosing a Gig')
			gainGig(s, p, intent.dieId)
			return s
		case 'steal': {
			if (pend.kind !== 'steal') fail('Not stealing')
			if (pend.maxValue !== undefined && (s.players[other(p)].gigs.find((d) => d.id === intent.dieId)?.value ?? 0) > pend.maxValue)
				fail(`Only Gigs worth ${pend.maxValue} or less can be stolen`)
			moveDie(s, intent.dieId, p)
			const left = pend.remaining - 1
			const more = s.players[other(p)].gigs.some((d) => pend.maxValue === undefined || d.value <= pend.maxValue)
			s.pending = left > 0 && more ? { ...pend, remaining: left } : { kind: 'main', player: p }
			overtimeCheck(s)
			return s
		}
		case 'callLegend':
			if (pend.kind !== 'main' && pend.kind !== 'react') fail('You cannot call a Legend now')
			callLegend(s, p)
			return s
		case 'play':
			if (pend.kind !== 'main' && pend.kind !== 'react') fail('You cannot play cards now')
			play(s, p, intent.uid, intent.target, pend.kind === 'react')
			return s
		case 'block':
			block(s, p, intent.blocker)
			return s
		case 'pass':
			if (pend.kind !== 'react') fail('Nothing to pass')
			resolveAttack(s)
			return s
	}

	if (pend.kind !== 'main') fail('Finish the current decision first')
	switch (intent.t) {
		case 'sell': {
			const pl = s.players[p]
			if (pl.soldThisTurn) fail('You already sold a card this turn')
			const i = pl.hand.indexOf(intent.uid)
			if (i < 0) fail('That card is not in your hand')
			if (!def(s, intent.uid).sell) fail('That card has no Sell tag')
			pl.hand.splice(i, 1)
			pl.eddies.push({ uid: intent.uid, spent: false })
			pl.soldThisTurn = true
			log(s, `${pl.name} sells ${nameOf(s, intent.uid)} for an Eddie.`)
			break
		}
		case 'goSolo':
			goSolo(s, p, intent.uid)
			break
		case 'attack':
			attack(s, p, intent.attacker, intent.target)
			break
		case 'endTurn':
			endTurn(s, p)
			break
		default:
			fail('Unknown action')
	}
	return s
}

/** Convenience for the UI: try an intent and report the error instead of throwing. */
export function tryApply(s: GameState, i: Intent): { state: GameState; error?: string } {
	try {
		return { state: apply(s, i) }
	} catch (e) {
		if (e instanceof IllegalIntent) return { state: s, error: e.message }
		throw e
	}
}

// ───────────────────────── queries for the UI ─────────────────────────

export function attackers(s: GameState, p: PlayerId): number[] {
	return s.players[p].field.filter((u) => canAttack(s, u)).map((u) => u.uid)
}
export function canPlay(s: GameState, p: PlayerId, uid: number): boolean {
	const d = def(s, uid)
	if (d.type === 'legend') return false
	const reacting = s.pending.kind === 'react'
	if (reacting && !(d.type === 'program' && d.keywords.includes('quick'))) return false
	if (d.type === 'gear' && s.players[p].field.length + s.players[p].legends.length === 0) return false
	return available(s, p) >= (d.cost ?? 0)
}
