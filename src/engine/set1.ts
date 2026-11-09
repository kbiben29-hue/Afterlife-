// Every Welcome to Night City card that isn't in the starter decks. Card text is never copied:
// comments describe what a script does in our own words.
//
// SET1_HANDLERS: triggered scripts (`${cardId}:${trigger}`; triggers as in effects.ts plus `act0`,
// `act1`… for activated abilities, `eot`, `save`, `prevent`, `hostDefeated`).
// ABILITIES: activated abilities ({Spend} / €$ costs, {Quick}). LISTENERS: "when …" abilities that
// watch events (steals, blocks, defeats, spends, rolls, Gig changes, Programs, turn starts).
// KEYWORDS: the printed keywords of every automated card. VANILLA: cards with no abilities.

import {
	addMark,
	attackTargets,
	available,
	bottomDeckUnit,
	def,
	defeatGear,
	defeatUnit,
	defeatUnitNow,
	drawCards,
	equipFree,
	findUnit,
	fire,
	freeCallLegend,
	hasKw,
	nameOf,
	ownerOf,
	pay,
	putUnitInPlay,
	readyEddies,
	runProgramFree,
	spendCard,
	stealDieNow,
	streetCred,
	trashTop,
	unitPower,
	costOf,
} from './engine'
import {
	allGigs,
	changeGig,
	chooseUnit,
	credLess,
	credOf,
	dieName,
	discardFromHand,
	emit,
	findDie,
	gigs8,
	minGigs,
	one,
	power,
	tag,
	valuePairs,
	type Ability,
	type Ctx,
	type Handler,
	type Listener,
} from './effects'
import { Rng } from './rng'
import { other, type ChoiceOption, type Die, type GameState, type Keyword, type PlayerId } from './types'

// ───────── helpers ─────────

const units = (s: GameState, p: PlayerId) => s.players[p].field.map((u) => u.uid)
const faceUpCount = (s: GameState, p: PlayerId) => s.players[p].legends.filter((l) => l.faceUp).length
const yesNo = (c: Ctx, prompt: string, yes: string, score = 1, who: PlayerId = c.owner) =>
	one(c, who, prompt, [
		{ id: 'yes', label: yes, score },
		{ id: 'no', label: 'No', score: 0 },
	]) === 'yes'
const cardOpts = (s: GameState, uids: number[], score: (u: number) => number = (u) => def(s, u).cost ?? 0): ChoiceOption[] =>
	uids.map((u) => ({ id: String(u), label: `${nameOf(s, u)} (${def(s, u).type}, cost ${def(s, u).cost ?? '—'})`, uid: u, score: score(u) }))

/** "Choose one effect" (or both). Returns the chosen indexes. */
function chooseModes(c: Ctx, labels: string[], scores: number[], both: boolean, who: PlayerId = c.owner): number[] {
	if (both) return labels.map((_, i) => i)
	const pick = one(
		c,
		who,
		`${def(c.s, c.source).name}: choose one effect.`,
		labels.map((l, i) => ({ id: String(i), label: l, score: scores[i] ?? 0 })),
	)
	return pick === null ? [] : [Number(pick)]
}
/** Move a card from a hidden/other zone into its owner's hand. */
function toHand(c: Ctx, uid: number, from: 'deck' | 'trash', reveal = true) {
	const p = ownerOf(c.s, uid)
	const pl = c.s.players[p]
	const z = from === 'deck' ? pl.deck : pl.trash
	const i = z.indexOf(uid)
	if (i >= 0) z.splice(i, 1)
	pl.hand.push(uid)
	c.log(`${pl.name} adds ${reveal ? nameOf(c.s, uid) : 'a card'} to their hand from their ${from}.`)
}
/** Look at the top n cards; pick up to `max` matching cards for the hand; the rest go to the bottom. */
function searchTop(c: Ctx, n: number, ok: (uid: number) => boolean, max: number, what: string) {
	const pl = c.s.players[c.owner]
	const top = pl.deck.slice(0, n)
	if (!top.length) return []
	const okCards = top.filter(ok)
	let picks: number[] = []
	if (okCards.length && max > 0)
		picks = c
			.ask(c.owner, {
				prompt: `${def(c.s, c.source).name}: the top ${top.length} cards — add ${max > 1 ? `up to ${max}` : '1'} ${what} to your hand.`,
				options: cardOpts(c.s, okCards, (u) => (def(c.s, u).cost ?? 0) + 1),
				min: Math.min(1, okCards.length),
				max: Math.min(max, okCards.length),
				reveal: top,
			})
			.map(Number)
	pl.deck = pl.deck.slice(top.length)
	for (const u of picks) pl.hand.push(u)
	pl.deck.push(...top.filter((u) => !picks.includes(u)))
	c.log(`${pl.name} looks at the top ${top.length}: takes ${picks.length ? picks.map((u) => nameOf(c.s, u)).join(', ') : 'nothing'}; the rest go to the bottom.`)
	return picks
}
/** Ask for a friendly host (Unit or face-up Legend) for a Gear. */
function chooseHost(c: Ctx, prompt: string, filter: (uid: number) => boolean = () => true): number | null {
	const pl = c.s.players[c.owner]
	const hosts = [...pl.field.map((u) => u.uid), ...pl.legends.filter((l) => l.faceUp).map((l) => l.uid)].filter(filter)
	const pick = one(
		c,
		c.owner,
		prompt,
		hosts.map((h) => ({ id: String(h), label: nameOf(c.s, h), uid: h, score: findUnit(c.s, h) ? power(c.s, h) : 0 })),
	)
	return pick === null ? null : Number(pick)
}
/** Play a card for free from wherever it is: Units enter play, Gear asks for a host, Programs run. */
function playFree(c: Ctx, uid: number, opts: { bottomProgram?: boolean; hostFilter?: (h: number) => boolean } = {}) {
	const d = def(c.s, uid)
	if (d.type === 'unit') putUnitInPlay(c.s, c.owner, uid)
	else if (d.type === 'gear') {
		const h = chooseHost(c, `Equip ${d.name} to:`, opts.hostFilter)
		if (h !== null) equipFree(c.s, c.owner, uid, h)
	} else if (d.type === 'program') runProgramFree(c.s, c.owner, uid, !!opts.bottomProgram)
}
/** Choose one of a player's Gig dice. */
function chooseDie(c: Ctx, prompt: string, dice: { d: Die; p: PlayerId }[], score: (d: Die, p: PlayerId) => number, optional = false, who: PlayerId = c.owner): { d: Die; p: PlayerId } | null {
	const pick = one(
		c,
		who,
		prompt,
		dice.map(({ d, p }) => ({ id: d.id, label: dieName(c.s, who, d, p), dieId: d.id, score: score(d, p) })),
		optional,
	)
	return pick === null ? null : findDie(c.s, pick)!
}
const myDice = (c: Ctx, p: PlayerId = c.owner) => c.s.players[p].gigs.map((d) => ({ d, p }))
const plusPower = (c: Ctx, uid: number, n: number) => {
	findUnit(c.s, uid)!.powerThisTurn += n
	c.log(`${nameOf(c.s, uid)} gets ${n >= 0 ? '+' : ''}${n} power this turn.`)
}
const untilMyNext = (p: PlayerId) => `start${p}` as 'start0' | 'start1'
const spentRivalUnits = (c: Ctx) => c.s.players[c.rival].field.filter((u) => u.spent).map((u) => u.uid)

// ───────── triggered scripts ─────────

export const SET1_HANDLERS: Record<string, Handler> = {
	// ═════ Legends ═════
	'adam-smasher-ender-of-legends:play': (c) => {
		const t = chooseUnit(c, 'Adam Smasher: defeat a rival Unit.', units(c.s, c.rival), false, (u) => power(c.s, u))
		if (t !== null) defeatUnit(c.s, t)
	},
	'alt-cunningham-soulkiller-architect:act0': (c) => {
		addMark(c.s.players[c.owner], 'altProgram', 'eot')
		c.log(`Your next Program this turn costs 1 less for each of your Gigs showing 1 (now ${minGigs(c.s, c.owner)}).`)
	},
	'alt-cunningham-soulkiller-architect:act1': (c) => {
		const pl = c.s.players[c.owner]
		const progs = pl.trash.filter((u) => def(c.s, u).type === 'program' && available(c.s, c.owner) >= costOf(c.s, c.owner, u))
		const pick = one(c, c.owner, 'Alt Cunningham: play a Program from your trash (you pay its cost; it goes to the bottom of your deck).', cardOpts(c.s, progs))
		if (pick === null) return
		const u = Number(pick)
		pay(c.s, c.owner, costOf(c.s, c.owner, u))
		runProgramFree(c.s, c.owner, u, true)
	},
	'dexter-deshawn-off-the-grid:call': (c) => {
		const my = units(c.s, c.owner)
		const m = chooseModes(c, ['Give a friendly Unit +2 power this turn', 'Draw 1'], [my.length ? 2 : -1, 1], false)
		if (m[0] === 0) {
			const t = chooseUnit(c, 'Give which Unit +2 power?', my, false, (u) => power(c.s, u))
			if (t !== null) plusPower(c, t, 2)
		} else if (m[0] === 1) drawCards(c.s, c.owner, 1)
	},
	'dexter-deshawn-off-the-grid:act0': (c) => void changeGig(c, 'increase', 2),
	'dum-dum-maelstrom-triggerman:call': (c) => {
		const gear = [...c.s.players[c.owner].field, ...c.s.players[c.owner].legends].flatMap((h) => h.gear)
		const pick = one(c, c.owner, 'Dum Dum: you may defeat one of your Gear to draw 2 (otherwise draw 1).', cardOpts(c.s, gear, (u) => 1 - (def(c.s, u).power ?? 0)), true)
		if (pick !== null) {
			defeatGear(c.s, Number(pick))
			drawCards(c.s, c.owner, 2)
		} else drawCards(c.s, c.owner, 1)
	},
	'dum-dum-maelstrom-triggerman:act0': (c) => {
		const eq = c.s.players[c.owner].field.filter((u) => u.gear.length).map((u) => u.uid)
		const t = chooseUnit(c, 'Dum Dum: +1 power this turn for each Gear on the Unit.', eq, false, (u) => findUnit(c.s, u)!.gear.length)
		if (t !== null) plusPower(c, t, findUnit(c.s, t)!.gear.length)
	},
	'evelyn-parker-beautiful-enigma:act0': (c) => {
		const t = chooseUnit(c, 'Evelyn Parker: a rival Unit must attack on their next turn if it can.', units(c.s, c.rival), false, (u) => -power(c.s, u))
		if (t !== null) {
			addMark(findUnit(c.s, t)!, 'mustAttack', untilMyNext(c.owner))
			c.log(`${nameOf(c.s, t)} must attack next turn if it can.`)
		}
	},
	'goro-takemura-vengeful-bodyguard:act0': (c) => {
		const ok = units(c.s, c.owner).filter((u) => (def(c.s, u).cost ?? 0) <= 4)
		const t = chooseUnit(c, 'Goro Takemura: give a Unit (cost 4 or less) Blocker this turn.', ok, false, (u) => (findUnit(c.s, u)!.spent ? -5 : power(c.s, u)))
		if (t === null) return
		addMark(findUnit(c.s, t)!, 'kw:blocker', 'eot')
		c.log(`${nameOf(c.s, t)} has Blocker this turn.`)
		if (valuePairs(c.s, c.owner) > 0) plusPower(c, t, 1)
	},
	'goro-takemura-vengeful-bodyguard:block': (c) => {
		if (!c.s.players[c.owner].hand.length) return
		if (!yesNo(c, 'Goro Takemura: discard 1 to draw 1?', 'Discard 1, draw 1', 0.5)) return
		discardFromHand(c, 1)
		drawCards(c.s, c.owner, 1)
	},
	'hanako-arasaka-daughter-of-the-emperor:act0': (c) => {
		const a = chooseDie(c, 'Hanako Arasaka: swap one of your Gigs…', myDice(c), (d) => -d.value)
		const b = a && chooseDie(c, '…with one of the rival’s Gigs.', myDice(c, c.rival), (d) => d.value)
		if (!a || !b) return
		const mine = c.s.players[c.owner].gigs
		const theirs = c.s.players[c.rival].gigs
		mine.splice(mine.indexOf(a.d), 1, b.d)
		theirs.splice(theirs.indexOf(b.d), 1, a.d)
		c.log(`${c.s.players[c.owner].name} swaps their d${a.d.sides} (${a.d.value}) for the rival’s d${b.d.sides} (${b.d.value}).`)
		emit(c.s, { type: 'gigChange', by: c.owner, dieOwner: c.rival })
	},
	'jackie-welles-mama-s-favorite:save': (c) => {
		const uid = c.data.uid as number
		if (!findUnit(c.s, uid)) return
		const j = c.s.players[c.owner].legends.find((l) => l.uid === c.source)
		if (j && available(c.s, c.owner, j.uid) >= 1 && yesNo(c, `Jackie Welles: pay 1 €$ and remove Jackie from the game so ${nameOf(c.s, uid)} isn’t defeated?`, 'Pay 1 €$ — Jackie takes it', (def(c.s, uid).cost ?? 0) >= 5 ? 1 : -1)) {
			pay(c.s, c.owner, 1, j.uid)
			const pl = c.s.players[c.owner]
			pl.legends.splice(pl.legends.indexOf(j), 1)
			pl.removed.push(j.uid)
			c.log(`Jackie Welles takes the fall: ${nameOf(c.s, uid)} survives, Jackie is removed from the game.`)
		} else defeatUnitNow(c.s, uid)
	},
	'johnny-silverhand-rocking-renegade:act0': (c) => {
		const t = chooseUnit(c, 'Johnny Silverhand: this Unit can attack spent rival Units the turn it’s played.', units(c.s, c.owner), false, (u) => (findUnit(c.s, u)!.lag ? 5 : 0) + (tag(c.s, u, 'rocker') ? 2 : 0))
		if (t === null) return
		addMark(findUnit(c.s, t)!, 'lagSpentUnits', 'eot')
		if (tag(c.s, t, 'rocker')) plusPower(c, t, 2)
	},
	'judy-a-lvarez-braindance-maestro:program': (c) => {
		const t = chooseUnit(c, 'Judy Álvarez: give a friendly Unit +1 power this turn.', units(c.s, c.owner), false, (u) => power(c.s, u))
		if (t !== null) plusPower(c, t, 1)
	},
	'judy-a-lvarez-braindance-maestro:act0': (c) => {
		const [u] = trashTop(c.s, c.owner, 1)
		if (u !== undefined && def(c.s, u).type === 'program' && yesNo(c, `Judy Álvarez: put ${nameOf(c.s, u)} into your hand?`, 'Add it to my hand')) toHand(c, u, 'trash')
	},
	'kerry-eurodyne-axe-attitude-audience:roll': (c) => {
		const die = c.s.players[c.owner].gigs.find((d) => d.id === c.data.dieId)
		if (!die) return
		if (c.data.fromFixer && yesNo(c, `Kerry Eurodyne: you rolled ${die.value} on the d${die.sides}. Re-roll it once?`, 'Re-roll', die.value <= die.sides / 2 ? 1 : -1)) {
			const rng = new Rng(c.s.rng)
			die.value = rng.roll(die.sides)
			c.s.rng = rng.seed
			c.log(`${c.s.players[c.owner].name} re-rolls the d${die.sides}: ${die.value}.`)
		}
		if (die.value === 1 || die.value === die.sides) {
			const n = die.sides === 20 ? 3 : 1
			c.log(`Kerry Eurodyne: a ${die.value === 1 ? 'min' : 'max'} roll — draw ${n}.`)
			drawCards(c.s, c.owner, n)
		}
	},
	'lucyna-kushinada-fresh-beginnings:call': (c) => drawCards(c.s, c.owner, minGigs(c.s, c.owner) >= 2 ? 2 : 1),
	'muamar-reyes-el-capita-n:call': (c) => {
		const my = units(c.s, c.owner)
		const m = chooseModes(c, ['A friendly Unit can’t be defeated in a fight this turn', 'Draw 1'], [my.length && c.s.active === c.owner ? 1.5 : 0, 1], false)
		if (m[0] === 0) {
			const t = chooseUnit(c, 'Which Unit can’t be defeated in a fight this turn?', my, false, (u) => def(c.s, u).cost ?? 0)
			if (t !== null) {
				addMark(findUnit(c.s, t)!, 'noFightDefeat', 'eot')
				c.log(`${nameOf(c.s, t)} can’t be defeated in a fight this turn.`)
			}
		} else if (m[0] === 1) drawCards(c.s, c.owner, 1)
	},
	'muamar-reyes-el-capita-n:act0': (c) => void changeGig(c, 'adjust', 1),
	'padre-man-of-the-cross:call': (c) => {
		const ready = c.s.players[c.rival].field.filter((u) => !u.spent).map((u) => u.uid)
		const m = chooseModes(c, ['Spend a rival Unit', 'Draw 1'], [ready.length ? 1.2 : -1, 1], false)
		if (m[0] === 0) {
			const t = chooseUnit(c, 'Padre: spend which rival Unit?', ready, false, (u) => power(c.s, u))
			if (t !== null) {
				spendCard(c.s, t)
				c.log(`${nameOf(c.s, t)} is spent.`)
			}
		} else if (m[0] === 1) drawCards(c.s, c.owner, 1)
	},
	'padre-man-of-the-cross:act0': (c) => {
		const a = chooseDie(c, 'Padre: set which Gig…', allGigs(c.s), (d, p) => (p === c.owner ? -d.value : d.value) / 2)
		if (!a) return
		const b = chooseDie(c, `…to the value of which of ${a.p === c.owner ? 'the rival’s' : 'your'} Gigs?`, myDice(c, other(a.p)).filter((x) => x.d.value <= a.d.sides), (d) => (a.p === c.owner ? d.value : -d.value))
		if (!b) return
		const from = a.d.value
		a.d.value = b.d.value
		c.log(`${c.s.players[c.owner].name} sets ${a.p === c.owner ? 'their' : 'the rival’s'} d${a.d.sides} from ${from} to ${a.d.value}.`)
		emit(c.s, { type: 'gigChange', by: c.owner, dieOwner: a.p })
	},
	'panam-palmer-nomad-cavalry:act0': (c) => {
		const leg = c.s.players[c.owner].legends.find((l) => l.uid === c.source)!
		const g = one(c, c.owner, 'Panam Palmer: move which Gear?', cardOpts(c.s, leg.gear, (u) => def(c.s, u).power ?? 0))
		const t = g !== null ? chooseUnit(c, 'To which unequipped Unit? (it readies)', c.s.players[c.owner].field.filter((u) => !u.gear.length).map((u) => u.uid), false, (u) => (findUnit(c.s, u)!.spent ? 5 : 0) + power(c.s, u)) : null
		if (g === null || t === null) return
		leg.gear.splice(leg.gear.indexOf(Number(g)), 1)
		const u = findUnit(c.s, t)!
		u.gear.push(Number(g))
		u.spent = false
		c.log(`${nameOf(c.s, Number(g))} moves to ${nameOf(c.s, t)}, which readies.`)
	},
	'river-ward-detective-on-the-hunt:act0': (c) => {
		const pl = c.s.players[c.owner]
		const gear = pl.hand.filter((u) => def(c.s, u).type === 'gear' && (def(c.s, u).cost ?? 0) <= 2)
		const g = one(c, c.owner, 'River Ward: play a Gear (cost 2 or less) from your hand for free.', cardOpts(c.s, gear))
		if (g !== null) playFree(c, Number(g))
	},
	'river-ward-detective-on-the-hunt:defeated2': (c) => {
		const pl = c.s.players[c.owner]
		const top = pl.deck.slice(0, 2)
		if (!top.length) return
		const t = one(c, c.owner, 'River Ward: look at your top 2 cards and trash 1.', cardOpts(c.s, top, (u) => -(def(c.s, u).cost ?? 0)), false, top)
		if (t === null) return
		pl.deck.splice(pl.deck.indexOf(Number(t)), 1)
		pl.trash.push(Number(t))
		c.log(`${pl.name} trashes ${nameOf(c.s, Number(t))} from the top of their deck.`)
	},
	'rogue-amendiares-preem-solo:steal': (c) => {
		if ((c.data.value as number) % 2 === 0) {
			c.log('Rogue: an even Gig — draw 1.')
			drawCards(c.s, c.owner, 1)
		} else {
			c.log('Rogue: an odd Gig — the rival discards 1.')
			discardFromHand(c, 1, c.rival)
		}
	},
	'sasha-yakovleva-won-t-let-you-down:attack': (c) => {
		const pl = c.s.players[c.owner]
		const top = pl.deck[0]
		if (top === undefined) return
		pl.deck.shift()
		pl.hand.push(top)
		const n = def(c.s, top).cost ?? 0
		c.log(`Sasha reveals ${nameOf(c.s, top)} and adds it to the hand.`)
		if (findUnit(c.s, c.source)) plusPower(c, c.source, n)
	},
	'sasha-yakovleva-won-t-let-you-down:defeated': (c) => void discardFromHand(c, 1, c.rival),
	'v-streetkid:call': (c) => {
		trashTop(c.s, c.owner, 3)
		const bd = c.s.players[c.owner].trash.filter((u) => def(c.s, u).type === 'program' && tag(c.s, u, 'braindance'))
		const pick = one(c, c.owner, 'V: add a BRAINDANCE Program from your trash to your hand.', cardOpts(c.s, bd))
		if (pick !== null) toHand(c, Number(pick), 'trash')
	},
	'wakako-okada-peace-and-harmony:call': (c) => {
		const rv = units(c.s, c.rival)
		const m = chooseModes(c, ['Give a rival Unit −2 power this turn', 'Draw 1'], [rv.length && c.s.active !== c.owner ? 1.5 : 0.2, 1], false)
		if (m[0] === 0) {
			const t = chooseUnit(c, 'Give which rival Unit −2 power?', rv, false, (u) => (c.s.attacking === u ? 10 : 0) + power(c.s, u))
			if (t !== null) plusPower(c, t, -2)
		} else if (m[0] === 1) drawCards(c.s, c.owner, 1)
	},
	'wakako-okada-peace-and-harmony:act0': (c) => void changeGig(c, 'decrease', 2),

	// ═════ Programs ═════
	'all-is-lost:program': (c) => {
		const t = trashTop(c.s, c.owner, 3).filter((u) => def(c.s, u).type === 'unit')
		const pick = one(c, c.owner, 'All Is Lost: add a Unit from among them to your hand.', cardOpts(c.s, t))
		if (pick !== null) toHand(c, Number(pick), 'trash')
	},
	'appetite-for-destruction:program': (c) => {
		addMark(c.s.players[c.owner], 'appetite', 'eot')
		c.log('The next time one of your Units wins a fight by 3+ power this turn, it also steals a Gig.')
	},
	'bonnie-and-clyde:program': (c) => {
		const ok = units(c.s, c.rival).filter((u) => power(c.s, u) <= 4)
		const two = c.s.players[c.rival].gigs.length >= c.s.players[c.owner].gigs.length + 2
		if (!ok.length) return
		const picks = c.ask(c.owner, { prompt: `Bonnie and Clyde: defeat ${two ? 'up to 2 rival Units' : 'a rival Unit'} with power 4 or less.`, options: ok.map((u) => ({ id: String(u), label: `${nameOf(c.s, u)} (${power(c.s, u)})`, uid: u, score: power(c.s, u) + 1 })), min: 1, max: two ? Math.min(2, ok.length) : 1 })
		for (const id of picks) defeatUnit(c.s, Number(id))
	},
	'bootleg-black-sapphire-show:program': (c) => {
		const pl = c.s.players[c.owner]
		const top = pl.deck.shift()
		if (top !== undefined) {
			pl.eddies.push({ uid: top, spent: false })
			c.log(`${pl.name} sells the top card of their deck for an Eddie.`)
		}
		const vals = pl.gigs.map((d) => d.value % 2)
		if (vals.includes(0) && vals.includes(1)) {
			c.log('An even Gig and an odd Gig — draw 2.')
			drawCards(c.s, c.owner, 2)
		}
	},
	'carnage-at-the-colosseum:program': (c) => {
		const best = Math.max(0, ...units(c.s, c.owner).map((u) => power(c.s, u)))
		const ok = units(c.s, c.rival).filter((u) => power(c.s, u) < best)
		const t = chooseUnit(c, `Carnage at the Colosseum: defeat a rival Unit with less than ${best} power.`, ok, false, (u) => power(c.s, u))
		if (t !== null) defeatUnit(c.s, t)
	},
	'chrome-reverie:program': (c) => {
		const t = chooseUnit(c, 'Chrome Reverie: which rival Unit can’t attack until your next turn?', units(c.s, c.rival), false, (u) => power(c.s, u))
		if (t !== null) {
			addMark(findUnit(c.s, t)!, 'noAttack', untilMyNext(c.owner))
			c.log(`${nameOf(c.s, t)} can’t attack until ${c.s.players[c.owner].name}’s next turn.`)
		}
		const pl = c.s.players[c.owner]
		if (minGigs(c.s, c.owner) > 0 && !pl.calledThisTurn && pl.legends.some((l) => !l.faceUp) && yesNo(c, 'Chrome Reverie: Call a Legend for free?', 'Call a Legend')) freeCallLegend(c.s, c.owner)
	},
	'cyberpsychosis:program': (c) => {
		const eq = [...c.s.players[c.owner].field, ...c.s.players[c.rival].field].filter((u) => u.gear.length).map((u) => u.uid)
		const t = chooseUnit(c, 'Cyberpsychosis: +3 power this turn per equipped Gear (it’s defeated at end of turn if it steals or fights).', eq, false, (u) => (ownerOf(c.s, u) === c.owner ? 1 : -1) * findUnit(c.s, u)!.gear.length)
		if (t === null) return
		plusPower(c, t, 3 * findUnit(c.s, t)!.gear.length)
		addMark(findUnit(c.s, t)!, 'psycho', 'eot')
	},
	'detonate:program': (c) => {
		const gear = [...c.s.players[c.rival].field, ...c.s.players[c.rival].legends].flatMap((h) => h.gear).filter((g) => (def(c.s, g).power ?? 0) <= 2)
		const g = one(c, c.owner, 'Detonate: defeat a rival Gear with power 2 or less.', cardOpts(c.s, gear, (u) => def(c.s, u).cost ?? 0))
		if (g !== null) defeatGear(c.s, Number(g))
	},
	'don-t-fear-the-reaper:program': (c) => {
		for (const u of c.s.players[c.rival].field) spendCard(c.s, u.uid)
		c.log('All rival Units are spent.')
		const spent = [...c.s.players[c.rival].field, ...c.s.players[c.owner].field].filter((u) => u.spent).map((u) => u.uid)
		const t = chooseUnit(c, 'Don’t Fear the Reaper: defeat a spent Unit.', spent, false, (u) => (ownerOf(c.s, u) === c.owner ? -10 : power(c.s, u)))
		if (t !== null) defeatUnit(c.s, t)
	},
	'fool-on-the-hill:program': (c) => {
		const pl = c.s.players[c.owner]
		const top = pl.deck.slice(0, 2)
		if (!top.length) return
		c.log(`${pl.name} reveals ${top.map((u) => nameOf(c.s, u)).join(' and ')}.`)
		const val = top.reduce((a, u) => a + (def(c.s, u).cost ?? 0), 0)
		const pick = one(
			c,
			c.rival,
			`Fool on the Hill: ${pl.name} revealed ${top.map((u) => nameOf(c.s, u)).join(' and ')}. Do they go to their hand, or to the trash (and they draw 2)?`,
			[
				{ id: 'hand', label: 'Into their hand', score: val <= 4 ? 1 : 0 },
				{ id: 'trash', label: 'Trash them (they draw 2)', score: val > 4 ? 1 : 0 },
			],
			false,
			top,
		)
		pl.deck.splice(0, top.length)
		if (pick === 'hand') {
			pl.hand.push(...top)
			c.log('They go into the hand.')
		} else {
			pl.trash.push(...top)
			c.log('They are trashed — draw 2.')
			drawCards(c.s, c.owner, 2)
		}
	},
	'gunpoint-diplomacy:program': (c) => {
		const t = chooseUnit(c, 'Gunpoint Diplomacy: which Unit?', units(c.s, c.owner), false, (u) => (findUnit(c.s, u)!.spent ? -5 : power(c.s, u)))
		if (t === null) return
		const behind = credLess(credOf(c.s, c.owner), credOf(c.s, c.rival))
		const modes = behind ? chooseModes(c, ['Its next attack this turn may target a ready Unit', '+3 power this turn'], [1, 0.5], false, c.rival) : [0, 1]
		if (modes.includes(0)) {
			addMark(findUnit(c.s, t)!, 'attackReady', 'eot')
			c.log(`${nameOf(c.s, t)} may attack a ready Unit with its next attack this turn.`)
		}
		if (modes.includes(1)) plusPower(c, t, 3)
	},
	'les-e-le-mens:program': (c) => {
		const rv = units(c.s, c.rival)
		if (!rv.length) return
		const low = Math.min(...rv.map((u) => power(c.s, u)))
		const t = chooseUnit(c, 'Les Éléments: bottom-deck the rival’s lowest-power Unit.', rv.filter((u) => power(c.s, u) === low), false, (u) => def(c.s, u).cost ?? 0)
		if (t !== null) bottomDeckUnit(c.s, t)
	},
	'live-with-the-aftermath:program': (c) => {
		for (const p of [c.owner, c.rival]) {
			const mine = units(c.s, p)
			const pick = one(c, p, 'Live with the Aftermath: defeat one of your Units.', mine.map((u) => ({ id: String(u), label: `${nameOf(c.s, u)} (${power(c.s, u)})`, uid: u, score: -(def(c.s, u).cost ?? 0) })))
			if (pick !== null) defeatUnit(c.s, Number(pick))
		}
	},
	'memory-relapse:program': (c) => {
		const ready = c.s.players[c.rival].field.filter((u) => !u.spent).map((u) => u.uid)
		const t = chooseUnit(c, 'Memory Relapse: spend a rival Unit; it won’t ready until your next turn.', ready.length ? ready : units(c.s, c.rival), false, (u) => power(c.s, u))
		if (t !== null) {
			spendCard(c.s, t)
			addMark(findUnit(c.s, t)!, 'noReady', untilMyNext(c.owner))
			c.log(`${nameOf(c.s, t)} is spent and can’t ready until ${c.s.players[c.owner].name}’s next turn.`)
		}
		const cred = credOf(c.s, c.owner)
		if (cred !== null && cred % 2 === 0) {
			c.log('Your Street Cred is even — draw 1.')
			drawCards(c.s, c.owner, 1)
		}
	},
	'nocturne-op55-n1:program': (c) => {
		const solo = c.s.players[c.owner].legends.some((l) => l.faceUp && hasKw(c.s, l.uid, 'goSolo'))
		const m = chooseModes(c, ['Draw 2', 'A Unit can’t attack until your next turn', 'A friendly Legend can Go Solo for 2 less this turn'], [2, units(c.s, c.rival).length ? 1 : -1, solo ? 1.5 : -1], false)
		if (m[0] === 0) drawCards(c.s, c.owner, 2)
		if (m[0] === 1) {
			const t = chooseUnit(c, 'Which Unit can’t attack until your next turn?', [...units(c.s, c.rival), ...units(c.s, c.owner)], false, (u) => (ownerOf(c.s, u) === c.owner ? -5 : power(c.s, u)))
			if (t !== null) addMark(findUnit(c.s, t)!, 'noAttack', untilMyNext(c.owner))
		}
		if (m[0] === 2) addMark(c.s.players[c.owner], 'nocturneSolo', 'eot')
	},
	'peace-offering:program': (c) => {
		const a = chooseDie(c, 'Peace Offering: you may set a Gig’s value…', allGigs(c.s), (d, p) => (p === c.owner ? 0.5 : 0.2), true)
		if (a) {
			const b = chooseDie(c, '…to the value of another Gig.', allGigs(c.s).filter((x) => x.d.id !== a.d.id && x.d.value <= a.d.sides), (d, p) => (a.p === c.owner ? d.value : -d.value) + (p === c.owner && a.p === c.owner && d.value === a.d.value ? 0 : 0))
			if (b) {
				const from = a.d.value
				a.d.value = b.d.value
				c.log(`${c.s.players[c.owner].name} sets ${a.p === c.owner ? 'their' : 'the rival’s'} d${a.d.sides} from ${from} to ${a.d.value}.`)
				emit(c.s, { type: 'gigChange', by: c.owner, dieOwner: a.p })
			}
		}
		if (valuePairs(c.s, c.owner) > 0) {
			c.log('You have a value-pair — draw 1.')
			drawCards(c.s, c.owner, 1)
		}
	},
	'pyramid-song:program': (c) => {
		const both = c.s.players[c.owner].gigs.some((d) => d.sides === 4 && d.value === 1)
		const zero = units(c.s, c.rival).filter((u) => power(c.s, u) === 0)
		const m = chooseModes(c, ['Give a rival Unit −4 power this turn', 'Bottom-deck a rival Unit with power 0'], [1, zero.length ? 1.5 : -1], both)
		if (m.includes(0)) {
			const t = chooseUnit(c, 'Give which rival Unit −4 power?', units(c.s, c.rival), false, (u) => (c.s.attacking === u ? 10 : 0) + power(c.s, u))
			if (t !== null) plusPower(c, t, -4)
		}
		if (m.includes(1)) {
			const z = units(c.s, c.rival).filter((u) => power(c.s, u) === 0)
			const t = chooseUnit(c, 'Bottom-deck which 0-power rival Unit?', z, false, (u) => def(c.s, u).cost ?? 0)
			if (t !== null) bottomDeckUnit(c.s, t)
		}
	},
	'safety-override:program': (c) => {
		addMark(c.s.players[c.owner], 'safetyOverride', 'eot')
		c.log('The next time one of your Units loses a fight this turn, the opposing Unit is defeated too.')
	},
	'synapse-burnout:program': (c) => {
		const t = chooseUnit(c, 'Synapse Burnout: which Unit gets +1 per face-up Legend while fighting this turn?', units(c.s, c.owner), false, (u) => power(c.s, u))
		if (t === null) return
		const n = faceUpCount(c.s, c.owner)
		addMark(findUnit(c.s, t)!, 'synapse', 'eot', n)
		c.log(`${nameOf(c.s, t)} has +${n} power while fighting rival Units this turn.`)
	},
	'take-control:program': (c) => {
		const t = chooseUnit(c, 'Take Control: which rival Unit steals 1 fewer Gig this turn?', units(c.s, c.rival), false, (u) => (c.s.attacking === u ? 10 : 0) + power(c.s, u))
		if (t === null) return
		addMark(findUnit(c.s, t)!, 'stealLess', 'eot')
		c.log(`${nameOf(c.s, t)} steals 1 fewer Gig this turn.`)
		if (['ai', 'drone', 'vehicle'].some((x) => tag(c.s, t, x))) drawCards(c.s, c.owner, 1)
	},
	'the-heist:program': (c) => {
		const gear = trashTop(c.s, c.owner, 4).filter((u) => def(c.s, u).type === 'gear')
		const pick = one(c, c.owner, 'The Heist: add a Gear from among them to your hand.', cardOpts(c.s, gear, (u) => (def(c.s, u).power ?? 0) + (def(c.s, u).cost ?? 0)))
		if (pick === null) return
		const g = Number(pick)
		const match = c.s.players[c.owner].gigs.some((d) => d.value === def(c.s, g).cost)
		const hosts = c.s.players[c.owner].field.length + c.s.players[c.owner].legends.filter((l) => l.faceUp).length
		if (match && hosts && yesNo(c, `The Heist: ${nameOf(c.s, g)}’s cost matches one of your Gigs — play it for free now?`, 'Play it for free')) playFree(c, g)
		else toHand(c, g, 'trash')
	},
	'three-mouths-one-desire:program': (c) => void searchTop(c, 3, () => true, 1 + minGigs(c.s, c.owner), 'card(s)'),
	'towerfall:program': (c) => {
		const both = credLess(credOf(c.s, c.owner), credOf(c.s, c.rival))
		const m = chooseModes(c, ['All rival Units get −5 power this turn', 'Bottom-deck all rival Units with power 0'], [1, 0.5], both)
		if (m.includes(0)) {
			for (const u of units(c.s, c.rival)) findUnit(c.s, u)!.powerThisTurn -= 5
			c.log('All rival Units get −5 power this turn.')
		}
		if (m.includes(1)) for (const u of units(c.s, c.rival).filter((u) => power(c.s, u) === 0)) bottomDeckUnit(c.s, u)
	},
	'trust-no-one:program': (c) => {
		changeGig(c, 'decrease', 3, false, (d, p, nv) => (p === c.owner ? (nv === 1 ? 3 : -1) : d.value - nv))
		if (minGigs(c.s, c.owner) > 0) {
			c.log('You have a Gig showing 1 — draw 1.')
			drawCards(c.s, c.owner, 1)
		}
	},
	'unlikely-bond:program': (c) => {
		const mine = c.s.players[c.owner].field.filter((u) => !u.spent).map((u) => u.uid)
		const theirs = spentRivalUnits(c)
		if (!theirs.length) return
		const a = chooseUnit(c, 'Unlikely Bond: bottom-deck one of your ready Units…', mine, false, (u) => -(def(c.s, u).cost ?? 0))
		if (a === null) return
		bottomDeckUnit(c.s, a)
		const b = chooseUnit(c, '…and bottom-deck a spent rival Unit.', spentRivalUnits(c), false, (u) => def(c.s, u).cost ?? 0)
		if (b !== null) bottomDeckUnit(c.s, b)
	},
	'we-gotta-live-together:program': (c) => {
		const ok = c.s.players[c.owner].trash.filter((u) => def(c.s, u).type === 'unit' && (def(c.s, u).cost ?? 0) <= 3)
		if (!ok.length) return
		const picks = c.ask(c.owner, { prompt: 'We Gotta Live Together: play up to 2 Units (cost 3 or less) from your trash for free.', options: cardOpts(c.s, ok, (u) => (def(c.s, u).power ?? 0) + 1), min: 0, max: Math.min(2, ok.length) })
		for (const id of picks) putUnitInPlay(c.s, c.owner, Number(id))
	},
	'wild-in-the-streets:program': (c) => {
		const spent = [...c.s.players[c.rival].field, ...c.s.players[c.owner].field].filter((u) => u.spent).map((u) => u.uid)
		const t = chooseUnit(c, 'Wild in the Streets: defeat a spent Unit.', spent, false, (u) => (ownerOf(c.s, u) === c.owner ? -10 : power(c.s, u)))
		if (t !== null) defeatUnit(c.s, t)
	},

	// ═════ Units ═════
	'6th-street-recruits:steal': (c) => void changeGig(c, 'increase', 6),
	'adam-smasher-metal-over-meat:play': (c) => {
		const all = [...units(c.s, c.owner), ...units(c.s, c.rival)].filter((u) => u !== c.source)
		if (all.length) c.log('Adam Smasher defeats every other Unit.')
		for (const u of all) defeatUnit(c.s, u)
	},
	'alt-cunningham-mother-of-daemons:prevent': (c) => {
		const attacker = c.data.attacker as number
		const dieId = c.data.dieId as string
		const d = c.s.players[c.owner].gigs.find((x) => x.id === dieId)
		if (!d) return
		const ok = c.s.players[c.owner].hand.filter((u) => def(c.s, u).cost === d.value)
		const pick = one(c, c.owner, `Alt Cunningham: discard a card costing ${d.value} so your d${d.sides} (${d.value}) isn’t stolen?`, cardOpts(c.s, ok, () => d.value), true)
		if (pick !== null) {
			const pl = c.s.players[c.owner]
			pl.hand.splice(pl.hand.indexOf(Number(pick)), 1)
			pl.trash.push(Number(pick))
			c.log(`${pl.name} discards ${nameOf(c.s, Number(pick))}: the d${d.sides} isn’t stolen.`)
		} else stealDieNow(c.s, attacker, dieId)
	},
	'augmented-negotiators:block': (c) => void discardFromHand(c, 1, c.rival),
	'caliber-totentanz-s-top-dog:play': (c) => {
		const t = chooseUnit(c, 'Caliber: defeat a rival Unit with cost 2 or less.', units(c.s, c.rival).filter((u) => (def(c.s, u).cost ?? 0) <= 2), false, (u) => power(c.s, u))
		if (t !== null) defeatUnit(c.s, t)
	},
	'caliber-totentanz-s-top-dog:defeated': (c) => {
		const [d] = discardFromHand(c, 1, c.rival)
		if (d !== undefined && c.s.players[c.owner].gigs.some((g) => g.value === def(c.s, d).cost)) {
			c.log('Its cost matches one of Caliber’s owner’s Gigs — discard 1 more.')
			discardFromHand(c, 1, c.rival)
		}
	},
	'delamain-rideshare-ai:play': (c) => drawCards(c.s, c.owner, 2),
	'el-sombrero-n-la-venganza-lenta:attack': (c) => {
		const maxes = c.s.players[c.owner].gigs.filter((d) => d.value === d.sides)
		if (!maxes.length || available(c.s, c.owner) < 2) return
		const best = Math.max(...maxes.map((d) => d.value))
		if (!yesNo(c, `El Sombrerón: pay 2 €$ to gain +${best} power this turn?`, `Pay 2 €$ (+${best})`)) return
		pay(c.s, c.owner, 2)
		plusPower(c, c.source, best)
	},
	'gilded-mato-n:play': (c) => {
		const gear = [...c.s.players[c.owner].field, ...c.s.players[c.owner].legends].flatMap((h) => h.gear)
		const ok = units(c.s, c.rival).filter((u) => (def(c.s, u).cost ?? 0) <= 3)
		if (!gear.length || !ok.length) return
		const g = one(c, c.owner, 'Gilded Matón: you may defeat one of your Gear to defeat a rival Unit costing 3 or less.', cardOpts(c.s, gear, (u) => 1 - (def(c.s, u).power ?? 0)), true)
		if (g === null) return
		defeatGear(c.s, Number(g))
		const t = chooseUnit(c, 'Defeat which rival Unit?', ok, false, (u) => power(c.s, u))
		if (t !== null) defeatUnit(c.s, t)
	},
	'hacked-corpo:play': (c) => {
		const p = trashTop(c.s, c.owner, 3).filter((u) => def(c.s, u).type === 'program')
		const pick = one(c, c.owner, 'Hacked Corpo: add a Program from among them to your hand.', cardOpts(c.s, p))
		if (pick !== null) toHand(c, Number(pick), 'trash')
	},
	'hanako-arasaka-in-a-gilded-cage:play': (c) => {
		const vals = new Set(c.s.players[c.owner].gigs.map((d) => d.value))
		void searchTop(c, 4, (u) => vals.has(def(c.s, u).cost ?? -1), 4, 'cards whose cost matches one of your Gigs')
	},
	'jackie-welles-ride-or-die-choom:attack': (c) => {
		const n = c.s.players[c.owner].gigs.filter((d) => d.value % 2 === 0).length
		if (n) plusPower(c, c.source, 2 * n)
	},
	'jackie-welles-ride-or-die-choom:defeated': (c) => drawCards(c.s, c.owner, c.s.players[c.owner].gigs.filter((d) => d.value % 2 === 1).length),
	'japantown-jonin:play': (c) => {
		const t = chooseUnit(c, 'Japantown Jōnin: give a friendly Unit +2 power this turn.', units(c.s, c.owner), false, (u) => (findUnit(c.s, u)!.lag ? 0 : 5) + power(c.s, u))
		if (t !== null) plusPower(c, t, 2)
	},
	'judy-a-lvarez-nothing-to-doubt:act0': (c) => {
		const pl = c.s.players[c.owner]
		const top = pl.deck[0]
		if (top === undefined) return
		const d = def(c.s, top)
		c.log(`Judy reveals ${nameOf(c.s, top)}.`)
		const canPlay = d.type !== 'gear' || pl.field.length + pl.legends.filter((l) => l.faceUp).length > 0
		if (canPlay && yesNo(c, `Judy Álvarez: play ${nameOf(c.s, top)} for free? (Otherwise it goes to your hand.)`, 'Play it for free', (d.cost ?? 0) >= 2 ? 1 : 0, c.owner)) playFree(c, top)
		else {
			pl.deck.shift()
			pl.hand.push(top)
		}
	},
	'kerry-eurodyne-the-last-rockerboy:act0': (c) => {
		if (gigs8(c.s, c.owner)) drawCards(c.s, c.owner, 2)
		else c.log('No Gig worth 8+ — nothing happens.')
	},
	'la-llorona-ghost-of-the-past:block': (c) => void changeGig(c, 'increase', 3),
	'lizzy-wizzy-delicate-weapon:play': (c) => {
		const pl = c.s.players[c.owner]
		const ok = [...pl.hand, ...pl.trash].filter((u) => def(c.s, u).type === 'program' && (def(c.s, u).cost ?? 0) <= 3)
		const pick = one(c, c.owner, 'Lizzy Wizzy: you may play a Program (cost 3 or less) from your hand or trash for free; it then goes to the bottom of your deck.', cardOpts(c.s, ok), true)
		if (pick !== null) playFree(c, Number(pick), { bottomProgram: true })
	},
	'maelstrom-goons:steal': (c) => void discardFromHand(c, 1, c.rival),
	'maman-brigitte-spirit-of-death:play': (c) => {
		const progs = c.s.players[c.owner].hand.filter((u) => def(c.s, u).type === 'program')
		const targets = c.s.players[c.rival].field.filter((u) => !u.gear.length).map((u) => u.uid)
		if (progs.length < 2 || !targets.length) return
		const picks = c.ask(c.owner, { prompt: 'Maman Brigitte: you may discard 2 Programs to bottom-deck a rival Unit with no Gear.', options: cardOpts(c.s, progs, (u) => -(def(c.s, u).cost ?? 0)), min: 0, max: 2 })
		if (picks.length !== 2) return
		const pl = c.s.players[c.owner]
		for (const id of picks) {
			pl.hand.splice(pl.hand.indexOf(Number(id)), 1)
			pl.trash.push(Number(id))
		}
		c.log(`${pl.name} discards ${picks.map((x) => nameOf(c.s, Number(x))).join(' and ')}.`)
		const t = chooseUnit(c, 'Bottom-deck which rival Unit?', targets, false, (u) => power(c.s, u))
		if (t !== null) bottomDeckUnit(c.s, t)
	},
	'maxtac-squadron:eot': (c) => {
		const spent = c.s.players[c.owner].legends.filter((l) => l.faceUp && l.spent).map((l) => l.uid)
		const pick = one(c, c.owner, 'MaxTac Squadron: ready one of your face-up Legends.', spent.map((u) => ({ id: String(u), label: nameOf(c.s, u), uid: u, score: 1 })))
		if (pick !== null) {
			c.s.players[c.owner].legends.find((l) => l.uid === Number(pick))!.spent = false
			c.log(`${nameOf(c.s, Number(pick))} readies.`)
		}
	},
	'meredith-stout-stone-cold-corpo:gigs': (c) => {
		const pl = c.s.players[c.owner]
		const pick = one(c, c.owner, 'Meredith Stout: the rival changed your Gigs — you may add a card from your trash to your hand.', cardOpts(c.s, pl.trash, (u) => def(c.s, u).cost ?? 0), true)
		if (pick !== null) toHand(c, Number(pick), 'trash')
	},
	'misty-olszewski-mender-of-broken-spirits:eot': (c) => {
		const pl = c.s.players[c.owner]
		if (!pl.deck.length) return
		const counts = { unit: 0, gear: 0, program: 0 } as Record<string, number>
		for (const u of pl.deck) counts[def(c.s, u).type] = (counts[def(c.s, u).type] ?? 0) + 1
		const t = one(
			c,
			c.owner,
			'Misty Olszewski: name a card type, then reveal your top card. If it matches, it goes to your hand and you ready 1 Eddie; otherwise it’s trashed.',
			['unit', 'gear', 'program'].map((x) => ({ id: x, label: x[0].toUpperCase() + x.slice(1), score: counts[x] })),
		)
		const top = pl.deck.shift()!
		c.log(`Misty names ${t}; the top card is ${nameOf(c.s, top)}.`)
		if (def(c.s, top).type === t) {
			pl.hand.push(top)
			readyEddies(c.s, c.owner, 1, 'Misty')
		} else pl.trash.push(top)
	},
	'mox-inciters:play': (c) => {
		const t = chooseUnit(c, 'Mox Inciters: a rival Unit must attack next turn if it can.', units(c.s, c.rival), false, (u) => -power(c.s, u))
		if (t !== null) {
			addMark(findUnit(c.s, t)!, 'mustAttack', untilMyNext(c.owner))
			c.log(`${nameOf(c.s, t)} must attack next turn if it can.`)
		}
	},
	'pacifica-netrunner:play': (c) => {
		const cred = credOf(c.s, c.owner)
		if (cred === null || cred % 2 !== 0) return
		const t = chooseUnit(c, 'Pacifica Netrunner: a rival Unit can’t ready until your next turn.', units(c.s, c.rival), false, (u) => (findUnit(c.s, u)!.spent ? 5 : 0) + power(c.s, u))
		if (t !== null) {
			addMark(findUnit(c.s, t)!, 'noReady', untilMyNext(c.owner))
			c.log(`${nameOf(c.s, t)} can’t ready until ${c.s.players[c.owner].name}’s next turn.`)
		}
	},
	'panam-palmer-strength-through-family:attack': (c) => {
		if (!c.s.players[c.owner].hand.length) return
		discardFromHand(c, 1)
		drawCards(c.s, c.owner, faceUpCount(c.s, c.owner))
	},
	'pepe-najarro-working-doubles:attack': (c) => {
		if (!valuePairs(c.s, c.owner)) return
		const merc = c.s.players[c.owner].legends.filter((l) => l.spent && tag(c.s, l.uid, 'merc')).slice(0, 2)
		for (const l of merc) l.spent = false
		if (merc.length) c.log(`Pepe Najarro readies ${merc.length} MERC Legend${merc.length > 1 ? 's' : ''}.`)
	},
	'placide-voodoo-sentinel:play': (c) => placide(c),
	'placide-voodoo-sentinel:attack': (c) => placide(c),
	'rita-wheeler-no-stupid-questions:spent': (c) => {
		drawCards(c.s, c.owner, 1)
		discardFromHand(c, 1)
	},
	'rogue-amendiares-queen-of-the-afterlife:steal': (c) => readyEddies(c.s, c.owner, 2, 'Rogue Amendiares'),
	'rogue-amendiares-queen-of-the-afterlife:act0': (c) => {
		const n = power(c.s, c.source)
		const t = chooseUnit(c, `Rogue Amendiares: a rival Unit gets −${n} power this turn.`, units(c.s, c.rival), false, (u) => (c.s.attacking === u ? 10 : 0) + power(c.s, u))
		if (t !== null) plusPower(c, t, -n)
	},
	'royce-don-t-call-me-simon:play': (c) => {
		const lim = credLess(credOf(c.s, c.rival), credOf(c.s, c.owner)) ? 3 : 2
		const t = chooseUnit(c, `Royce: defeat a rival Unit with power ${lim} or less.`, units(c.s, c.rival).filter((u) => power(c.s, u) <= lim), false, (u) => power(c.s, u))
		if (t !== null) defeatUnit(c.s, t)
	},
	'sandayu-oda-hanako-s-guardian:play': (c) => {
		const n = valuePairs(c.s, c.owner)
		const ready = c.s.players[c.rival].field.filter((u) => !u.spent).map((u) => u.uid)
		if (!n || !ready.length) return
		const k = Math.min(n, ready.length)
		const picks = c.ask(c.owner, { prompt: `Sandayu Oda: spend ${k} rival Unit${k > 1 ? 's' : ''}.`, options: ready.map((u) => ({ id: String(u), label: `${nameOf(c.s, u)} (${power(c.s, u)})`, uid: u, score: power(c.s, u) })), min: k, max: k })
		for (const id of picks) spendCard(c.s, Number(id))
		c.log(`${picks.map((x) => nameOf(c.s, Number(x))).join(', ')} spent.`)
	},
	'screw-lovelorn-fool:defeated': (c) => {
		const ok = c.s.players[c.owner].trash.filter((u) => u !== c.source && def(c.s, u).type === 'unit')
		const pick = one(c, c.owner, 'Screw: add another Unit from your trash to your hand.', cardOpts(c.s, ok))
		if (pick !== null) toHand(c, Number(pick), 'trash')
	},
	'sketchy-ripper:attack': (c) => void searchTop(c, 3, (u) => def(c.s, u).type === 'gear', 1, 'Gear'),
	'tyger-s-whisper:play': (c) => {
		const pl = c.s.players[c.owner]
		if (!pl.calledThisTurn && pl.legends.some((l) => !l.faceUp) && yesNo(c, 'Tyger’s Whisper: Call a Legend for free?', 'Call a Legend')) freeCallLegend(c.s, c.owner)
	},
	'v-roamer-of-the-badlands:steal': (c) => void changeGig(c, 'increase', 5, true, undefined, c.data.dieId as string),
	'valentino-street-racer:play': (c) => {
		const ok = units(c.s, c.owner).filter((u) => u !== c.source && (def(c.s, u).cost ?? 0) <= 5)
		const t = chooseUnit(c, 'Valentino Street Racer: give another Unit (cost 5 or less) Adrenaline this turn.', ok, false, (u) => (findUnit(c.s, u)!.lag ? 5 : 0) + power(c.s, u))
		if (t !== null) {
			addMark(findUnit(c.s, t)!, 'kw:adrenaline', 'eot')
			c.log(`${nameOf(c.s, t)} has Adrenaline this turn.`)
		}
	},
	'viktor-vektor-you-might-feel-a-little-pinch:play': (c) => {
		const ok = c.s.players[c.owner].trash.filter((u) => def(c.s, u).type === 'gear' && tag(c.s, u, 'cyberware') && (def(c.s, u).cost ?? 0) <= 2)
		const others = units(c.s, c.owner).filter((u) => u !== c.source)
		if (!others.length) return
		const g = one(c, c.owner, 'Viktor Vektor: play a CYBERWARE Gear (cost 2 or less) from your trash for free onto another Unit.', cardOpts(c.s, ok, (u) => def(c.s, u).power ?? 0))
		if (g !== null) playFree(c, Number(g), { hostFilter: (h) => h !== c.source && !!findUnit(c.s, h) })
	},
	'westbrook-netrunner:play': (c) => {
		addMark(c.s.players[c.owner], 'westbrook', untilMyNext(c.owner))
		c.log('Until your next turn, rival Legends can’t steal your Gigs worth less than their power.')
	},
	'wraith-marauders:steal': (c) => {
		const v = c.data.value as number
		const ok = c.s.players[c.owner].field.filter((u) => u.uid !== c.source && u.spent && power(c.s, u.uid) === v).map((u) => u.uid)
		const t = chooseUnit(c, `Wraith Marauders: ready another Unit with power ${v}.`, ok, false, (u) => power(c.s, u))
		if (t !== null) {
			findUnit(c.s, t)!.spent = false
			c.log(`${nameOf(c.s, t)} readies.`)
		}
	},
	'yorinobu-arasaka-steel-dragon:play': (c) => {
		const pl = c.s.players[c.owner]
		const ok = [...pl.hand, ...pl.trash].filter((u) => def(c.s, u).type === 'unit' && (def(c.s, u).cost ?? 0) <= 4)
		const pick = one(c, c.owner, 'Yorinobu Arasaka: you may play a Unit (cost 4 or less) from your hand or trash for free; it can attack rival Units this turn.', cardOpts(c.s, ok, (u) => (def(c.s, u).power ?? 0) + 1), true)
		if (pick === null) return
		putUnitInPlay(c.s, c.owner, Number(pick))
		addMark(findUnit(c.s, Number(pick))!, 'lagUnits', 'eot')
	},
	'yorinobu-arasaka-steel-dragon:arasakaDefeated': (c) => {
		c.log('Yorinobu Arasaka: an ARASAKA Unit was defeated — draw 1.')
		drawCards(c.s, c.owner, 1)
	},

	// ═════ Gear ═════
	'gorilla-arms:steal': (c) => {
		const mine = new Set(c.s.players[c.owner].gigs.map((d) => d.value))
		const ok = c.s.players[c.rival].gigs.filter((d) => !mine.has(d.value)).map((d) => ({ d, p: c.rival }))
		const host = c.data.host as number
		const x = chooseDie(c, 'Gorilla Arms: steal a rival Gig whose value none of your Gigs shows.', ok, (d) => d.value)
		if (x && findUnit(c.s, host)) stealDieNow(c.s, host, x.d.id)
	},
	'netwatch-netdriver:hostSpent': (c) => drawCards(c.s, c.owner, 1),
	'overwatch-panam-s-gift:act0': (c) => {
		const d = discardFromHand(c, 1)[0]
		if (d === undefined) return
		const lim = def(c.s, d).cost ?? 0
		const t = chooseUnit(c, `Overwatch: defeat a spent rival Unit with cost ${lim} or less.`, spentRivalUnits(c).filter((u) => (def(c.s, u).cost ?? 0) <= lim), false, (u) => power(c.s, u))
		if (t !== null) defeatUnit(c.s, t)
	},
	'the-relic-experimental-biochip:hostDefeated': (c) => {
		const host = c.data.host as number
		const pl = c.s.players[c.owner]
		const ok = pl.trash.filter((u) => u !== host && def(c.s, u).type === 'unit' && (def(c.s, u).cost ?? 0) <= 9)
		const pick = one(c, c.owner, 'The Relic: play another Unit (cost 9 or less) from your trash for free.', cardOpts(c.s, ok, (u) => def(c.s, u).power ?? 0))
		if (pick !== null) putUnitInPlay(c.s, c.owner, Number(pick))
		const i = pl.trash.indexOf(host)
		if (i >= 0) {
			pl.trash.splice(i, 1)
			pl.deck.push(host)
			c.log(`${nameOf(c.s, host)} goes to the bottom of the deck.`)
		}
	},
}

function placide(c: Ctx) {
	const progs = c.s.players[c.owner].hand.filter((u) => def(c.s, u).type === 'program')
	const rv = units(c.s, c.rival)
	if (!progs.length || !rv.length) return
	const pick = one(c, c.owner, 'Placide: you may discard a Program to bottom-deck a rival Unit.', cardOpts(c.s, progs, (u) => 2 - (def(c.s, u).cost ?? 0)), true)
	if (pick === null) return
	const pl = c.s.players[c.owner]
	pl.hand.splice(pl.hand.indexOf(Number(pick)), 1)
	pl.trash.push(Number(pick))
	c.log(`${pl.name} discards ${nameOf(c.s, Number(pick))}.`)
	const t = chooseUnit(c, 'Bottom-deck which rival Unit?', units(c.s, c.rival), false, (u) => power(c.s, u))
	if (t !== null) bottomDeckUnit(c.s, t)
}

// ───────── activated abilities ─────────

const hasSpentRival = (s: GameState, p: PlayerId) => s.players[other(p)].field.some((u) => u.spent)
const need = (ok: boolean, why: string) => (ok ? null : why)

export const ABILITIES: Record<string, Ability[]> = {
	'alt-cunningham-soulkiller-architect': [
		{ label: 'next Program costs less', spend: 'self', key: 'alt-cunningham-soulkiller-architect:act0', bot: (s, p) => minGigs(s, p) > 0 && s.players[p].hand.some((u) => def(s, u).type === 'program') },
		{
			label: 'play a Program from your trash',
			cost: 1,
			spend: 'self',
			key: 'alt-cunningham-soulkiller-architect:act1',
			legal: (s, p) => need(s.players[p].trash.some((u) => def(s, u).type === 'program'), 'No Program in your trash'),
			bot: () => true,
		},
	],
	'dexter-deshawn-off-the-grid': [{ label: 'increase a Gig by up to 2', spend: 'self', key: 'dexter-deshawn-off-the-grid:act0', legal: (s) => need(allGigs(s).length > 0, 'No Gigs'), bot: (s, p) => s.players[p].gigs.some((d) => d.value < d.sides) }],
	'dum-dum-maelstrom-triggerman': [
		{ label: '+1 power per Gear on a Unit', cost: 1, spend: 'self', quick: true, key: 'dum-dum-maelstrom-triggerman:act0', legal: (s, p) => need(s.players[p].field.some((u) => u.gear.length), 'No equipped Unit') },
	],
	'evelyn-parker-beautiful-enigma': [{ label: 'a rival Unit must attack next turn', cost: 1, spend: 'self', key: 'evelyn-parker-beautiful-enigma:act0', legal: (s, p) => need(s.players[other(p)].field.length > 0, 'No rival Units') }],
	'goro-takemura-vengeful-bodyguard': [
		{ label: 'give a Unit Blocker this turn', cost: 1, spend: 'self', quick: true, key: 'goro-takemura-vengeful-bodyguard:act0', legal: (s, p) => need(s.players[p].field.some((u) => (def(s, u.uid).cost ?? 0) <= 4), 'No Unit with cost 4 or less') },
	],
	'hanako-arasaka-daughter-of-the-emperor': [
		{ label: 'swap a Gig with a rival Gig', spend: 'self', key: 'hanako-arasaka-daughter-of-the-emperor:act0', legal: (s, p) => need(s.players[p].gigs.length > 0 && s.players[other(p)].gigs.length > 0, 'Both players need a Gig'), bot: (s, p) => Math.max(0, ...s.players[other(p)].gigs.map((d) => d.value)) > Math.min(99, ...s.players[p].gigs.map((d) => d.value)) + 2 },
	],
	'johnny-silverhand-rocking-renegade': [
		{ label: 'a Unit may attack spent Units the turn it’s played', cost: (s, p) => Math.max(0, 2 - gigs8(s, p)), spend: 'self', key: 'johnny-silverhand-rocking-renegade:act0', legal: (s, p) => need(s.players[p].field.length > 0, 'No Units') },
	],
	'judy-a-lvarez-braindance-maestro': [{ label: 'trash your top card (keep it if it’s a Program)', spend: 'self', key: 'judy-a-lvarez-braindance-maestro:act0', bot: (s, p) => s.players[p].deck.length > 8 }],
	'muamar-reyes-el-capita-n': [{ label: 'adjust a Gig by 1', spend: 'self', key: 'muamar-reyes-el-capita-n:act0', legal: (s) => need(allGigs(s).length > 0, 'No Gigs') }],
	'padre-man-of-the-cross': [{ label: 'set a Gig to the value of another player’s Gig', spend: 'self', key: 'padre-man-of-the-cross:act0', legal: (s, p) => need(s.players[p].gigs.length > 0 && s.players[other(p)].gigs.length > 0, 'Both players need a Gig') }],
	'panam-palmer-nomad-cavalry': [
		{
			label: 'move a Gear from Panam to an unequipped Unit (it readies)',
			cost: 2,
			spend: 'self',
			key: 'panam-palmer-nomad-cavalry:act0',
			legal: (s, p, uid) => need(!!s.players[p].legends.find((l) => l.uid === uid)?.gear.length && s.players[p].field.some((u) => !u.gear.length), 'Needs a Gear on Panam and an unequipped Unit'),
		},
	],
	'river-ward-detective-on-the-hunt': [
		{ label: 'play a Gear (cost 2 or less) from hand for free', spend: 'self', quick: true, key: 'river-ward-detective-on-the-hunt:act0', legal: (s, p) => need(s.players[p].hand.some((u) => def(s, u).type === 'gear' && (def(s, u).cost ?? 0) <= 2) && s.players[p].field.length + s.players[p].legends.filter((l) => l.faceUp).length > 0, 'No cheap Gear in hand'), bot: () => true },
	],
	'wakako-okada-peace-and-harmony': [{ label: 'decrease a Gig by up to 2', spend: 'self', key: 'wakako-okada-peace-and-harmony:act0', legal: (s) => need(allGigs(s).some(({ d }) => d.value > 1), 'No Gig to decrease'), bot: (s, p) => s.players[other(p)].gigs.some((d) => d.value > 2) }],
	'judy-a-lvarez-nothing-to-doubt': [{ label: 'reveal your top card: play it free or take it', cost: 1, spend: 'self', key: 'judy-a-lvarez-nothing-to-doubt:act0', legal: (s, p) => need(s.players[p].deck.length > 0, 'Your deck is empty'), bot: (s, p) => s.active === p }],
	'kerry-eurodyne-the-last-rockerboy': [{ label: 'draw 2 if you have a Gig worth 8+', spend: 'self', key: 'kerry-eurodyne-the-last-rockerboy:act0', legal: (s, p) => need(gigs8(s, p) > 0, 'You need a Gig worth 8+'), bot: () => true }],
	'rogue-amendiares-queen-of-the-afterlife': [
		{ label: 'a rival Unit loses power equal to Rogue’s', cost: 2, spend: 'self', quick: true, key: 'rogue-amendiares-queen-of-the-afterlife:act0', legal: (s, p) => need(s.players[other(p)].field.length > 0, 'No rival Units') },
	],
	'overwatch-panam-s-gift': [
		{ label: 'discard 1: defeat a spent rival Unit costing no more', cost: 1, spend: 'host', quick: true, key: 'overwatch-panam-s-gift:act0', legal: (s, p) => need(s.players[p].hand.length > 0 && hasSpentRival(s, p), 'Needs a card in hand and a spent rival Unit') },
	],
}

// ───────── listeners ─────────

const once = (s: GameState, p: PlayerId, key: string) => {
	const pl = s.players[p]
	if (pl.usedThisTurn?.includes(key)) return false
	;(pl.usedThisTurn ??= []).push(key)
	return true
}

export const LISTENERS: Record<string, Listener> = {
	'evelyn-parker-beautiful-enigma': (s, ev, me) => {
		if (ev.type === 'steal' && ev.first && ev.owner === me.owner && (tag(s, ev.uid, 'corpo') || tag(s, ev.uid, 'ganger'))) readyEddies(s, me.owner, 1, 'Evelyn Parker')
	},
	'goro-takemura-vengeful-bodyguard': (s, ev, me) => {
		if (ev.type === 'block' && ev.owner === me.owner) fire(s, 'goro-takemura-vengeful-bodyguard:block', me.uid, me.owner)
	},
	'hanako-arasaka-daughter-of-the-emperor': (s, ev, me) => {
		if (ev.type === 'startTurn' && ev.p === me.owner) {
			const n = valuePairs(s, me.owner)
			if (n) {
				s.log.push(`Hanako Arasaka: ${n} value-pair${n > 1 ? 's' : ''} — draw ${n}.`)
				drawCards(s, me.owner, n)
			}
		}
	},
	'judy-a-lvarez-braindance-maestro': (s, ev, me) => {
		if (ev.type === 'program' && ev.owner === me.owner && tag(s, ev.uid, 'braindance') && s.players[me.owner].field.length) fire(s, 'judy-a-lvarez-braindance-maestro:program', me.uid, me.owner)
	},
	'kerry-eurodyne-axe-attitude-audience': (s, ev, me) => {
		if (ev.type === 'roll' && ev.p === me.owner) fire(s, 'kerry-eurodyne-axe-attitude-audience:roll', me.uid, me.owner, { dieId: ev.dieId, fromFixer: ev.fromFixer })
	},
	'river-ward-detective-on-the-hunt': (s, ev, me) => {
		if (ev.type === 'defeated' && ev.owner === me.owner && ev.equipped) fire(s, 'river-ward-detective-on-the-hunt:defeated2', me.uid, me.owner)
	},
	'rogue-amendiares-preem-solo': (s, ev, me) => {
		if (ev.type === 'steal' && ev.owner === me.owner && findUnit(s, ev.uid)?.goSolo) fire(s, 'rogue-amendiares-preem-solo:steal', me.uid, me.owner, { value: ev.value })
	},
	'6th-street-recruits': (s, ev, me) => {
		if (ev.type === 'steal' && ev.owner === me.owner && ev.sides === 6) fire(s, '6th-street-recruits:steal', me.uid, me.owner)
	},
	'alt-cunningham-mother-of-daemons': (s, ev, me) => {
		if (ev.type === 'spent' && ev.owner === me.owner && ev.equipped) {
			s.log.push('Alt Cunningham: an equipped card was spent — draw 1.')
			drawCards(s, me.owner, 1)
		}
	},
	'augmented-negotiators': (s, ev, me) => {
		if (ev.type === 'block' && ev.uid === me.uid) fire(s, 'augmented-negotiators:block', me.uid, me.owner)
	},
	'la-llorona-ghost-of-the-past': (s, ev, me) => {
		if (ev.type === 'block' && ev.uid === me.uid) fire(s, 'la-llorona-ghost-of-the-past:block', me.uid, me.owner)
	},
	'maelstrom-goons': (s, ev, me) => {
		if (ev.type === 'steal' && ev.uid === me.uid && findUnit(s, me.uid)?.gear.length) fire(s, 'maelstrom-goons:steal', me.uid, me.owner)
	},
	'meredith-stout-stone-cold-corpo': (s, ev, me) => {
		if (ev.type === 'gigChange' && ev.dieOwner === me.owner && ev.by !== me.owner && s.players[me.owner].trash.length) fire(s, 'meredith-stout-stone-cold-corpo:gigs', me.uid, me.owner)
	},
	'rita-wheeler-no-stupid-questions': (s, ev, me) => {
		if (ev.type === 'spent' && ev.uid === me.uid && once(s, me.owner, `rita${me.uid}`)) fire(s, 'rita-wheeler-no-stupid-questions:spent', me.uid, me.owner)
	},
	'rogue-amendiares-queen-of-the-afterlife': (s, ev, me) => {
		if (ev.type === 'steal' && ev.owner === me.owner && ev.uid !== me.uid && ev.value < Math.max(0, unitPower(s, findUnit(s, ev.uid)!)) && once(s, me.owner, `rogueQ${me.uid}`)) fire(s, 'rogue-amendiares-queen-of-the-afterlife:steal', me.uid, me.owner)
	},
	'v-roamer-of-the-badlands': (s, ev, me) => {
		if (ev.type === 'steal' && ev.uid === me.uid) fire(s, 'v-roamer-of-the-badlands:steal', me.uid, me.owner, { dieId: ev.dieId })
	},
	'wraith-marauders': (s, ev, me) => {
		if (ev.type === 'steal' && ev.uid === me.uid) fire(s, 'wraith-marauders:steal', me.uid, me.owner, { value: ev.value })
	},
	'yorinobu-arasaka-steel-dragon': (s, ev, me) => {
		if (ev.type === 'defeated' && tag(s, ev.uid, 'arasaka') && once(s, me.owner, 'yorinobuSD')) fire(s, 'yorinobu-arasaka-steel-dragon:arasakaDefeated', me.uid, me.owner)
	},
	'gorilla-arms': (s, ev, me) => {
		if (ev.type === 'steal' && ev.uid === me.host && ev.first && once(s, me.owner, `gorilla${me.host}`)) fire(s, 'gorilla-arms:steal', me.uid, me.owner, { host: me.host })
	},
}

// ───────── keywords and vanilla cards ─────────

export const KEYWORDS: Record<string, Keyword[]> = {
	// starter decks
	'v-corporate-exile': ['goSolo'],
	'goro-takemura-hands-unclean': ['goSolo', 'blocker'],
	'secondhand-bombus': ['blocker'],
	'corpo-security': ['blocker'],
	'floor-it': ['quick'],
	'reboot-optics': ['quick'],
	// the rest of the set
	'adam-smasher-ender-of-legends': ['goSolo'],
	'jackie-welles-mama-s-favorite': ['goSolo'],
	'rogue-amendiares-preem-solo': ['goSolo'],
	'royce-psycho-on-the-edge': ['goSolo'],
	'sasha-yakovleva-won-t-let-you-down': ['goSolo'],
	'v-streetkid': ['goSolo'],
	'augmented-negotiators': ['blocker'],
	'la-llorona-ghost-of-the-past': ['blocker'],
	'lizzy-wizzy-delicate-weapon': ['blocker'],
	'meredith-stout-stone-cold-corpo': ['blocker'],
	'mox-inciters': ['blocker'],
	'rita-wheeler-no-stupid-questions': ['blocker'],
	'modded-kusanagi': ['adrenaline'],
	'riding-nomad': ['adrenaline'],
	cyberpsychosis: ['quick'],
	detonate: ['quick'],
	'safety-override': ['quick'],
	'synapse-burnout': ['quick'],
	'take-control': ['quick'],
}

/** Cards with no abilities (or only rules the engine applies by itself). */
export const VANILLA = new Set([
	'psycho-squad',
	'emergency-atlus',
	'mantis-blades',
	'animals-wrecker',
	'rockn-rockerboy',
	'maxtac-heavy',
	'octant',
	'trauma-team-operatives',
	'zetatech-berserk',
	'riot-shield',
	'deadman-transmitter',
	'adrenaline-converter',
	'royce-psycho-on-the-edge',
	'jacked-in-voodoo-boy',
	'maxtac-suppression-team',
	'nadia-fighting-through-grief',
	'valentino-guerrera',
	'viktor-vektor-drop-your-illusions',
	'saul-bright-stormrider',
	'modded-muramasa',
	'modded-kusanagi',
	'johnny-silverhand-never-stop-fighting',
	'maelstrom-zealots',
	'panam-palmer-strength-through-family',
	'jackie-welles-mama-s-favorite',
	'sandayu-oda-hanako-s-guardian',
	'riding-nomad',
])

// re-exported for tests
export { attackTargets, streetCred }
