// Deck lessons for the two starter decks: a game-plan guide, combo drills (set positions with a
// goal and step-by-step coaching) and combo alerts during a coached full game.
// Everything here is written in our own words — no card text is copied.

import { gigsToSteal, unitPower, findUnit, streetCred } from '../engine/engine'
import { scenario, type SideSpec } from '../engine/scenario'
import { starterDeck, STARTERS, type StarterDeck } from '../data/starters'
import { other, type CardDef, type GameState, type PlayerId } from '../engine/types'
import type { CoachStep, Hint } from './coach'

export type DeckId = StarterDeck['id']
export const deckName = (id: DeckId) => STARTERS.find((d) => d.id === id)!.name
export const otherDeck = (id: DeckId): DeckId => (id === 'heist' ? 'power' : 'heist')

// ───────── game plans ─────────

export const PLANS: Record<DeckId, { title: string; body: string }[]> = {
	heist: [
		{
			title: 'The Heist — the game plan',
			body: 'Yellow/Blue, led by V, Jackie Welles and Viktor Vektor. This deck is a toolbox: cheap Units that are better with cyberware on them, and Gear that both adds power and does something extra every time the Unit attacks or is spent. You win by making each attack count — stealing two Gigs at once instead of one — and by bending dice values so your rival’s attacks steal less.',
		},
		{
			title: 'The magic number is 10',
			body: 'An attack on Gigs steals 1, plus 1 more for every full 10 power. So 9 power steals one Gig but 10 steals two. Count before you attack: V is 8 on her own — put Dying Night on her (+2) and she hits exactly 10. Heywood is also 8: any +2 Gear (Zetatech Faceplate, Dying Night) makes him a two-Gig threat.',
		},
		{
			title: 'Legends: who does what',
			body: 'Viktor, when Called, digs through your top five cards for up to two cheap Gear — and every Gear in this deck is cheap enough. Jackie, once face-up, rewards your first Blue Unit or Gear each turn by letting you lower one of your own Gigs by up to 2; drop it to 1 and you draw a card. V can Go Solo for 5: an 8-power Unit that attacks the turn she arrives.',
		},
		{
			title: 'Dice are a resource',
			body: 'Many of your cards adjust Gig values: Dexter (when played and when attacking), Afterparty at Lizzie’s, Zetatech Faceplate, Dying Night. Lower your rival’s big dice before they’re stolen back, set your own dice to different values (Faceplate and Afterparty draw you cards for that), or match a value for Heywood. Lower Street Cred also keeps MT0D12 Flathead unblockable — it can’t be blocked while you’re behind.',
		},
		{
			title: 'Tricks on the rival’s turn',
			body: 'Floor It and Reboot Optics are Quick: you can play them while the rival is attacking. Floor It takes 1 power off an attacker — enough to turn a 10-power two-Gig steal into a one-Gig steal, or to win a tied fight — and draws you a card. Reboot Optics keeps one of your Units alive in the next fight. Keep an Eddie spare for them.',
		},
	],
	power: [
		{
			title: 'Embracing Power — the game plan',
			body: 'Red/Green Arasaka, led by Saburo, Yorinobu and Goro Takemura. This deck builds a board of tough Units and loads them with heavy cyberware: Mantis Blades, Satori and Sandevistan each add +2 power. It keeps pressure on the rival’s Gigs every turn while its Programs clear blockers out of the way.',
		},
		{
			title: 'The magic number is 10',
			body: 'An attack on Gigs steals 1, plus 1 more for every full 10 power. MaxTac AV is 8 — one +2 Gear makes it 10. Minotaur is 9 — with Saburo face-up, ARASAKA Units get +1 while attacking, so Minotaur hits 10 on its own. Goro (Losing His Way) is only 4, but if all three of your Legends are face-up he gets +5 when he attacks — and Saburo adds 1 more: 10.',
		},
		{
			title: 'Legends: who does what',
			body: 'Saburo face-up: +1 power for your ARASAKA attackers. Yorinobu face-up: the first time an ARASAKA Unit attacks each turn you draw a card (and discard one if your Street Cred is under 20). Goro (Hands Unclean) can Go Solo for 5 as a 7-power Blocker. Arasaka Emergency Radioport lets you peek at a face-down Legend when its Unit is spent, and Call it for free if it’s ARASAKA or can Go Solo — that’s every Legend in this deck.',
		},
		{
			title: 'Clear the way',
			body: 'Only spent Units can be attacked, and Blockers stop direct attacks. Corporate Surveillance spends a cheap rival Unit (cost 4 or less) — a ready Blocker becomes a spent target. Minotaur defeats a small rival Unit when it arrives, but only if your Street Cred is higher than theirs: play Industrial Assembly first to push one of your dice up. Over the Edge kills anything weaker than your d20’s value.',
		},
		{
			title: 'Hit and stay safe',
			body: 'Attacking spends your Unit, which lets the rival attack it on their turn. Sandevistan readies its Unit at the end of your turn: you swing, then it stands up again as a defender. Chrome Fang stops the rival stealing your Gigs that are worth more than the attacker’s power until your next turn — great when your d20 is high. Satori draws you a card whenever its Unit wins a fight.',
		},
	],
}

// ───────── combo drills ─────────

export interface DrillStep {
	text: string
	hint: Hint
	done: (s: GameState, start: GameState) => boolean
}
export interface Drill {
	id: string
	deck: DeckId
	title: string
	goal: string
	/** shown when the drill is solved */
	lesson: string
	build: (cards: Record<string, CardDef>, seed: number) => GameState
	steps: (s: GameState) => DrillStep[]
	success: (s: GameState, start: GameState) => boolean
}

const uidOf = (s: GameState, p: PlayerId, id: string, zone: 'hand' | 'field' | 'legends' | 'any' = 'any') => {
	const pl = s.players[p]
	const pools = zone === 'hand' ? [pl.hand] : zone === 'field' ? [pl.field.map((u) => u.uid)] : zone === 'legends' ? [pl.legends.map((l) => l.uid)] : [pl.hand, pl.field.map((u) => u.uid), pl.legends.map((l) => l.uid)]
	for (const list of pools) for (const u of list) if (s.instances[u].cardId === id) return u
	return undefined
}
const inField = (s: GameState, p: PlayerId, id: string) => s.players[p].field.some((u) => s.instances[u.uid].cardId === id)
const equipped = (s: GameState, p: PlayerId, gear: string, host?: string) =>
	[...s.players[p].field, ...s.players[p].legends].some((h) => (!host || s.instances[h.uid].cardId === host) && h.gear.some((g) => s.instances[g].cardId === gear))
const stole = (n: number) => (s: GameState, start: GameState) => s.players[0].gigs.length - start.players[0].gigs.length >= n
const attacked = (id: string) => (s: GameState) => s.players[0].field.some((u) => s.instances[u.uid].cardId === id && u.spent) || s.pending.kind === 'react' || s.pending.kind === 'steal'
const ended = (s: GameState) => s.active !== 0

function build(deck: DeckId, me: SideSpec, rival: SideSpec, cards: Record<string, CardDef>, seed: number) {
	return scenario({ seed, cards, decks: [starterDeck(deck), starterDeck(otherDeck(deck))], names: ['Player', 'Rival'], sides: [me, rival] })
}

export const DRILLS: Drill[] = [
	// ═════ The Heist ═════
	{
		id: 'heist-v',
		deck: 'heist',
		title: 'V + Dying Night: a two-Gig heist',
		goal: 'Steal 2 Gigs with a single attack this turn.',
		lesson: 'V (8) + Dying Night (+2) = 10 power, so the attack steals two Gigs. Dying Night also lowered one of the rival’s dice, and because it was on V it readies 2 Eddies at the end of your turn — you paid 7 and got 2 back.',
		build: (cards, seed) =>
			build(
				'heist',
				{ hand: ['dying-night-v-s-pistol', 'psycho-squad'], faceUp: ['v-corporate-exile'], gigs: [[4, 3], [6, 2]], eddies: 7 },
				{ field: [{ id: 'emergency-atlus', spent: true }], gigs: [[4, 4], [8, 7], [12, 9]] },
				cards,
				seed,
			),
		steps: (s) => [
			{ text: 'V is face-up and has Go Solo. Tap V in your Legends row and press Go Solo (5 €$). She arrives as an 8-power Unit that can attack this turn.', hint: { legends: [uidOf(s, 0, 'v-corporate-exile', 'legends') ?? -1], buttons: ['Go Solo'] }, done: (x) => inField(x, 0, 'v-corporate-exile') },
			{ text: 'Now equip Dying Night to V: tap it in your hand, press Equip (2 €$), then tap V. She becomes 10 power.', hint: { hand: [uidOf(s, 0, 'dying-night-v-s-pistol', 'hand') ?? -1], buttons: ['Equip'], units: [uidOf(s, 0, 'v-corporate-exile', 'field') ?? -1] }, done: (x) => equipped(x, 0, 'dying-night-v-s-pistol') },
			{ text: 'Attack the rival’s Gigs with V. Dying Night first lets you lower a die by up to 2: lower the rival die you won’t steal (their d4), so the Gig they keep is worth less.', hint: { units: [uidOf(s, 0, 'v-corporate-exile', 'field') ?? -1], buttons: ['Attack'], gigTarget: true }, done: attacked('v-corporate-exile') },
			{ text: 'Steal their two biggest dice — high values are worth the most Street Cred.', hint: {}, done: stole(2) },
		],
		success: stole(2),
	},
	{
		id: 'heist-viktor',
		deck: 'heist',
		title: 'Viktor’s workshop',
		goal: 'Call Viktor, take two Gear, equip Zetatech Faceplate and attack with it.',
		lesson: 'Viktor turns one Eddie into two cards from your top five. Zetatech Faceplate gave Psycho Squad +2 and, when it attacked (attacking spends a Unit), let you nudge a die — with three different values on your Gigs, you drew a card too.',
		build: (cards, seed) =>
			build(
				'heist',
				{ field: [{ id: 'psycho-squad' }], faceUp: ['v-corporate-exile', 'jackie-welles-pour-one-out-for-me'], gigs: [[4, 2], [6, 2], [8, 5]], eddies: 3, deckTop: ['delamain-cab', 'zetatech-faceplate', 'floor-it', 'kiroshi-optics', 'heywood-ripperdoc'] },
				{ gigs: [[4, 3], [6, 4]] },
				cards,
				seed,
			),
		steps: (s) => [
			{ text: 'Viktor is your only face-down Legend, so Calling a Legend (1 €$) will flip him. Press Call a Legend.', hint: { buttons: ['Call a Legend'] }, done: (x) => x.players[0].legends.every((l) => l.faceUp) },
			{ text: 'Viktor shows you the top five cards: pick both Gear (Zetatech Faceplate and Kiroshi Optics), then Confirm.', hint: {}, done: (x) => !!uidOf(x, 0, 'zetatech-faceplate', 'hand') || equipped(x, 0, 'zetatech-faceplate') },
			{ text: 'Equip Zetatech Faceplate (2 €$) to Psycho Squad: 6 + 2 = 8 power.', hint: { hand: [uidOf(s, 0, 'zetatech-faceplate', 'hand') ?? -1], buttons: ['Equip'], units: [uidOf(s, 0, 'psycho-squad', 'field') ?? -1] }, done: (x) => equipped(x, 0, 'zetatech-faceplate') },
			{ text: 'Attack their Gigs with Psycho Squad. Attacking spends it, so the Faceplate triggers: change your d6 from 2 to 3 so all three of your dice are different, and draw a card.', hint: { units: [uidOf(s, 0, 'psycho-squad', 'field') ?? -1], buttons: ['Attack'], gigTarget: true }, done: attacked('psycho-squad') },
		],
		success: (s) => equipped(s, 0, 'zetatech-faceplate') && attacked('psycho-squad')(s),
	},
	{
		id: 'heist-flathead',
		deck: 'heist',
		title: 'Flathead slips past the guards',
		goal: 'Steal a Gig even though the rival has a ready Blocker.',
		lesson: 'MT0D12 Flathead can’t be blocked while your Street Cred is lower than your rival’s. Being behind on dice turned into an unblockable attack. Careful with cards that raise your own dice before Flathead swings!',
		build: (cards, seed) =>
			build(
				'heist',
				{ field: [{ id: 'mt0d12-flathead' }, { id: 'delamain-cab' }], hand: ['afterparty-at-lizzie-s'], faceUp: ['viktor-vektor-sit-down-and-relax'], gigs: [[4, 2], [6, 3]], eddies: 2 },
				{ field: [{ id: 'corpo-security' }], gigs: [[4, 4], [6, 5], [8, 6]] },
				cards,
				seed,
			),
		steps: (s) => [
			{ text: 'Their Corpo Security is a ready Blocker, so a normal attack gets blocked. But your Street Cred (5) is lower than theirs (15): Flathead can’t be blocked right now. Attack their Gigs with MT0D12 Flathead.', hint: { units: [uidOf(s, 0, 'mt0d12-flathead', 'field') ?? -1], buttons: ['Attack'], gigTarget: true }, done: (x, st) => attacked('mt0d12-flathead')(x) || stole(1)(x, st) },
			{ text: 'The rival can’t block it. Take their best die.', hint: {}, done: stole(1) },
		],
		success: stole(1),
	},
	{
		id: 'heist-heywood',
		deck: 'heist',
		title: 'Heywood, ripperdoc',
		goal: 'Break the rival’s Satori with Heywood and draw a card.',
		lesson: 'Heywood defeats a Gear when he arrives, and if that Gear’s cost matches one of your dice you draw. Lowering your die first (with Jackie, or Afterparty) lines the numbers up. Heywood is 8 power: give him a +2 Gear next turn and he steals two Gigs.',
		build: (cards, seed) =>
			build(
				'heist',
				{ hand: ['heywood-ripperdoc', 'afterparty-at-lizzie-s'], faceUp: ['v-corporate-exile'], gigs: [[4, 3], [6, 4]], eddies: 7 },
				{ field: [{ id: 'emergency-atlus', gear: ['satori-sword-of-saburo'] }], gigs: [[4, 2], [6, 5]] },
				cards,
				seed,
			),
		steps: (s) => [
			{ text: 'Satori costs 2, but none of your dice shows a 2. Play Afterparty at Lizzie’s (1 €$) and lower your d4 from 3 to 2. (Your dice are then different values, so it draws you a card as well.)', hint: { hand: [uidOf(s, 0, 'afterparty-at-lizzie-s', 'hand') ?? -1], buttons: ['Play'] }, done: (x) => x.players[0].gigs.some((d) => d.value === 2) },
			{ text: 'Now play Heywood (6 €$). Choose to defeat Satori: its cost matches your die, so you draw.', hint: { hand: [uidOf(s, 0, 'heywood-ripperdoc', 'hand') ?? -1], buttons: ['Play'] }, done: (x) => inField(x, 0, 'heywood-ripperdoc') },
		],
		success: (s) => inField(s, 0, 'heywood-ripperdoc') && !equipped(s, 1, 'satori-sword-of-saburo') && s.log.some((l) => l.includes('matches a friendly Gig')),
	},

	// ═════ Embracing Power ═════
	{
		id: 'power-minotaur',
		deck: 'power',
		title: 'Saburo’s Minotaur',
		goal: 'Steal 2 Gigs with one attack, even though the rival has a Blocker.',
		lesson: 'Saburo face-up gives ARASAKA attackers +1, so Minotaur hits 10 and steals two. Corporate Surveillance spent their Blocker first, so it couldn’t stand in the way.',
		build: (cards, seed) =>
			build(
				'power',
				{ field: [{ id: 'minotaur' }], hand: ['corporate-surveillance'], faceUp: ['saburo-arasaka-stubborn-patriarch'], gigs: [[4, 3], [6, 4]], eddies: 2 },
				{ field: [{ id: 'secondhand-bombus' }], gigs: [[4, 2], [8, 6], [12, 8]] },
				cards,
				seed,
			),
		steps: (s) => [
			{ text: 'Their Secondhand Bombus is a ready Blocker: it would soak up Minotaur’s attack. Play Corporate Surveillance (2 €$) to spend it.', hint: { hand: [uidOf(s, 0, 'corporate-surveillance', 'hand') ?? -1], buttons: ['Play'] }, done: (x) => x.players[1].field.every((u) => u.spent) },
			{ text: 'Minotaur is 9 power — Saburo adds +1 while an ARASAKA Unit attacks. Attack their Gigs: 10 power steals two.', hint: { units: [uidOf(s, 0, 'minotaur', 'field') ?? -1], buttons: ['Attack'], gigTarget: true }, done: attacked('minotaur') },
			{ text: 'Pick their two best dice.', hint: {}, done: stole(2) },
		],
		success: stole(2),
	},
	{
		id: 'power-goro',
		deck: 'power',
		title: 'Goro loses his way',
		goal: 'Steal 2 Gigs with Goro Takemura (Losing His Way).',
		lesson: 'Goro gets +5 when he attacks if every one of your Legends is face-up. Calling your last Legend first made that true: 4 + 5, +1 from Saburo = 10 power, two Gigs.',
		build: (cards, seed) =>
			build(
				'power',
				{ field: [{ id: 'goro-takemura-losing-his-way' }], faceUp: ['saburo-arasaka-stubborn-patriarch', 'goro-takemura-hands-unclean'], gigs: [[4, 2], [6, 5]], eddies: 1 },
				{ gigs: [[4, 3], [6, 6], [10, 8]] },
				cards,
				seed,
			),
		steps: (s) => [
			{ text: 'Goro only gets his +5 if ALL your Legends are face-up, and Yorinobu is still face-down. Call a Legend (1 €$) first.', hint: { buttons: ['Call a Legend'] }, done: (x) => x.players[0].legends.every((l) => l.faceUp) },
			{ text: 'Now attack their Gigs with Goro: 4 + 5 + 1 (Saburo) = 10. Yorinobu, now face-up, draws you a card too.', hint: { units: [uidOf(s, 0, 'goro-takemura-losing-his-way', 'field') ?? -1], buttons: ['Attack'], gigTarget: true }, done: attacked('goro-takemura-losing-his-way') },
			{ text: 'Pick their two best dice.', hint: {}, done: stole(2) },
		],
		success: stole(2),
	},
	{
		id: 'power-sandevistan',
		deck: 'power',
		title: 'Sandevistan: hit and stand back up',
		goal: 'Steal 2 Gigs with MaxTac AV and end your turn with it ready to block.',
		lesson: 'MaxTac AV (8) + Sandevistan (+2) = 10: two Gigs. Normally your attacker stays spent and the rival can attack it — Sandevistan readies it at the end of your turn, so it’s safe and can even defend.',
		build: (cards, seed) =>
			build(
				'power',
				{ field: [{ id: 'maxtac-av' }], hand: ['sandevistan'], gigs: [[4, 3], [6, 4]], eddies: 3 },
				{ field: [{ id: 'chrome-fang' }], gigs: [[4, 2], [8, 7], [12, 6]] },
				cards,
				seed,
			),
		steps: (s) => [
			{ text: 'Equip Sandevistan (3 €$) to MaxTac AV: 8 + 2 = 10 power.', hint: { hand: [uidOf(s, 0, 'sandevistan', 'hand') ?? -1], buttons: ['Equip'], units: [uidOf(s, 0, 'maxtac-av', 'field') ?? -1] }, done: (x) => equipped(x, 0, 'sandevistan') },
			{ text: 'Attack their Gigs with MaxTac AV.', hint: { units: [uidOf(s, 0, 'maxtac-av', 'field') ?? -1], buttons: ['Attack'], gigTarget: true }, done: attacked('maxtac-av') },
			{ text: 'Steal their two best dice.', hint: {}, done: stole(2) },
			{ text: 'MaxTac AV is spent — their Chrome Fang could attack it next turn. End your turn and watch Sandevistan ready it.', hint: { buttons: ['End turn'] }, done: ended },
		],
		success: (s, st) => stole(2)(s, st) && ended(s) && s.players[0].field.some((u) => s.instances[u.uid].cardId === 'maxtac-av' && !u.spent),
	},
	{
		id: 'power-order',
		deck: 'power',
		title: 'Order matters: Industrial Assembly → Minotaur',
		goal: 'Defeat the rival’s Delamain Cab with Minotaur.',
		lesson: 'Minotaur only removes a Unit if your Street Cred is higher than the rival’s. Industrial Assembly pushed your d12 up by 4 first (and drew you a card for a die worth 8+), then Minotaur arrived with the lead it needed.',
		build: (cards, seed) =>
			build(
				'power',
				{ hand: ['minotaur', 'industrial-assembly'], gigs: [[4, 1], [12, 5]], eddies: 8 },
				{ field: [{ id: 'delamain-cab' }], gigs: [[6, 4], [8, 4]] },
				cards,
				seed,
			),
		steps: (s) => [
			{ text: 'Your Street Cred is 6 and theirs is 8 — Minotaur would do nothing right now. Play Industrial Assembly (1 €$) first and raise your d12 from 5 to 9.', hint: { hand: [uidOf(s, 0, 'industrial-assembly', 'hand') ?? -1], buttons: ['Play'] }, done: (x) => (streetCred(x.players[0]) ?? 0) > (streetCred(x.players[1]) ?? 0) },
			{ text: 'You’re ahead now. Play Minotaur (7 €$) and defeat Delamain Cab.', hint: { hand: [uidOf(s, 0, 'minotaur', 'hand') ?? -1], buttons: ['Play'] }, done: (x) => inField(x, 0, 'minotaur') },
		],
		success: (s) => inField(s, 0, 'minotaur') && !inField(s, 1, 'delamain-cab'),
	},
]

export const drillsFor = (deck: DeckId) => DRILLS.filter((d) => d.deck === deck)

/** The current step of a drill, or null when the drill is over. */
export function drillCoach(drill: Drill, s: GameState, start: GameState): CoachStep | null {
	if (s.pending.kind === 'choose' && s.pending.player === 0) return { key: 'drill-q', title: drill.title, body: 'The card is asking you a question — answer it in the box over the table (or tap a glowing card or die).', hint: {} }
	const steps = drill.steps(s)
	const i = steps.findIndex((st) => !st.done(s, start))
	if (i < 0) return null
	return { key: `${drill.id}-${i}`, title: `${drill.title} · step ${i + 1}/${steps.length}`, body: steps[i].text, hint: steps[i].hint }
}

// ───────── combo alerts in a coached game ─────────

interface Combo {
	key: string
	deck: DeckId
	title: string
	body: string
	ready: (s: GameState, me: PlayerId) => boolean
}
const hasInHand = (s: GameState, p: PlayerId, id: string) => s.players[p].hand.some((u) => s.instances[u].cardId === id)
const faceUp = (s: GameState, p: PlayerId, id: string) => s.players[p].legends.some((l) => l.faceUp && s.instances[l.uid].cardId === id)
const unitOnField = (s: GameState, p: PlayerId, id: string) => s.players[p].field.find((u) => s.instances[u.uid].cardId === id)

export const COMBOS: Combo[] = [
	{ key: 'c-v-dn', deck: 'heist', title: 'Combo: V + Dying Night', body: 'V is face-up and Dying Night is in your hand. Go Solo with V, equip Dying Night and attack their Gigs: 10 power steals two, and you get 2 Eddies back at the end of the turn.', ready: (s, me) => (faceUp(s, me, 'v-corporate-exile') || !!unitOnField(s, me, 'v-corporate-exile')) && hasInHand(s, me, 'dying-night-v-s-pistol') },
	{ key: 'c-heywood', deck: 'heist', title: 'Combo: Heywood + a +2 Gear', body: 'Heywood is 8 power. Zetatech Faceplate or Dying Night (+2 each) makes him 10 — a two-Gig attack.', ready: (s, me) => !!unitOnField(s, me, 'heywood-ripperdoc') && (hasInHand(s, me, 'zetatech-faceplate') || hasInHand(s, me, 'dying-night-v-s-pistol')) },
	{ key: 'c-flathead', deck: 'heist', title: 'Flathead is unblockable', body: 'Your Street Cred is lower than your rival’s, so MT0D12 Flathead can’t be blocked right now. Attack their Gigs with it before you raise any of your own dice.', ready: (s, me) => { const u = unitOnField(s, me, 'mt0d12-flathead'); const a = streetCred(s.players[me]); const b = streetCred(s.players[other(me)]); return !!u && !u.spent && b !== null && (a === null || a < b) } },
	{ key: 'c-viktor', deck: 'heist', title: 'Viktor finds Gear', body: 'Viktor is still face-down. When you Call a Legend and it’s him, he digs two cheap Gear out of your top five cards — every Gear in this deck qualifies.', ready: (s, me) => s.players[me].legends.some((l) => !l.faceUp && s.instances[l.uid].cardId === 'viktor-vektor-sit-down-and-relax') && s.players[me].field.length >= 2 },
	{ key: 'c-quick', deck: 'heist', title: 'Keep a trick ready', body: 'You hold a Quick Program (Floor It or Reboot Optics). Leave an Eddie unspent at the end of your turn so you can use it while the rival attacks.', ready: (s, me) => s.active === me && (hasInHand(s, me, 'floor-it') || hasInHand(s, me, 'reboot-optics')) },
	{ key: 'c-saburo-mino', deck: 'power', title: 'Combo: Saburo + Minotaur', body: 'Saburo is face-up, so Minotaur attacks with 10 power — enough to steal two Gigs.', ready: (s, me) => faceUp(s, me, 'saburo-arasaka-stubborn-patriarch') && (!!unitOnField(s, me, 'minotaur') || hasInHand(s, me, 'minotaur')) },
	{ key: 'c-goro', deck: 'power', title: 'Combo: flip everything for Goro', body: 'Goro (Losing His Way) gets +5 if all your Legends are face-up when he attacks. Call your last face-down Legend first, then attack: with Saburo up that’s 10 power.', ready: (s, me) => !!unitOnField(s, me, 'goro-takemura-losing-his-way') && s.players[me].legends.filter((l) => !l.faceUp).length === 1 },
	{ key: 'c-maxtac', deck: 'power', title: 'MaxTac AV + any Gear', body: 'MaxTac AV is 8 power. Any of your Gear adds +2: equip one and it attacks for 10, stealing two Gigs. Sandevistan is the best fit — it readies MaxTac at the end of the turn.', ready: (s, me) => !!unitOnField(s, me, 'maxtac-av') && ['mantis-blades', 'satori-sword-of-saburo', 'sandevistan', 'arasaka-emergency-radioport'].some((g) => hasInHand(s, me, g)) },
	{ key: 'c-surveil', deck: 'power', title: 'Clear the Blocker', body: 'The rival has a ready Blocker that costs 4 or less. Corporate Surveillance spends it so your attack on their Gigs goes through.', ready: (s, me) => hasInHand(s, me, 'corporate-surveillance') && s.players[other(me)].field.some((u) => !u.spent && (s.cards[s.instances[u.uid].cardId].keywords.includes('blocker'))) },
	{ key: 'c-mino-order', deck: 'power', title: 'Minotaur needs the lead', body: 'Minotaur only defeats a Unit if your Street Cred is higher than the rival’s. If you’re behind, play Industrial Assembly first to push one of your dice up.', ready: (s, me) => hasInHand(s, me, 'minotaur') && hasInHand(s, me, 'industrial-assembly') && (streetCred(s.players[me]) ?? 0) <= (streetCred(s.players[other(me)]) ?? 0) },
]

export function comboNote(deck: DeckId, s: GameState, me: PlayerId, seen: Set<string>): CoachStep | null {
	if (s.active !== me || s.pending.kind !== 'main' || s.pending.player !== me) return null
	for (const c of COMBOS) if (c.deck === deck && !seen.has(c.key) && c.ready(s, me)) return { key: c.key, title: c.title, body: c.body, hint: {} }
	return null
}

/** How many Gigs the given Unit would steal attacking right now (for messages). */
export const wouldSteal = (s: GameState, uid: number) => gigsToSteal(Math.max(0, unitPower(s, findUnit(s, uid)!)))
