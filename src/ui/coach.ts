// Tutorial coach: looks at the position, explains the step the player is on, and points at the move
// the Street Samurai would make in their place (bot.ts), so it works with any deck and any cards.

import { chooseIntent } from '../bot/bot'
import { abilitiesOf, attackPower, isScripted } from '../engine/effects'
import { available, def, gigsToSteal, legalGigDice, nameOf, streetCred, unitPower, findUnit } from '../engine/engine'
import { other, type GameState, type PlayerId } from '../engine/types'

export interface Hint {
	hand?: number[]
	units?: number[]
	legends?: number[]
	dice?: string[]
	buttons?: string[] // prompt / tool button labels (prefix match)
	gigTarget?: boolean
}

export interface CoachStep {
	/** concept id: the long explanation is shown the first time, the short one afterwards */
	key: string
	title: string
	body: string
	hint: Hint
}

export const INTRO: { title: string; body: string }[] = [
	{
		title: 'Welcome to Night City',
		body: 'This practice game walks you through a real match against the Street Samurai. Watch this panel: it explains each step, and whatever glows yellow on the table is a good move to make next. You can still do anything you like — the coach just suggests.',
	},
	{
		title: 'How you win',
		body: 'Each player has six Gig dice (d4, d6, d8, d10, d12, d20). Every turn you move one from your Fixer area to your Gigs. Start a turn holding 7 Gigs and you win — but you only own 6, so you must steal at least one from your rival by attacking their Gigs.',
	},
	{
		title: 'Eddies pay for everything',
		body: 'Cards cost Eddies (€⁠$, the number in the top-left corner). Once a turn you can sell a card face-down as an Eddie. Your three face-down Legends can also be spent as 1 €⁠$ each. Spent cards turn sideways and come back at the start of your next turn.',
	},
	{
		title: 'The table',
		body: 'Your mat is at the bottom, laid out like the official playmat: the Fixer dice down the left, Rival Gigs and Friendly Gigs along the top, your Field of Units in the middle, Legends and Eddies along the bottom, and your Deck and Trash on the right. The rival’s mat faces you at the top. Tap any card to see it big on the left — the actions you can take with it appear underneath. The log on the right says everything that happens. You can also drag: pull a card from your hand onto the table to play it (Gear onto a Unit, or onto your Eddies to sell), and drag one of your Units onto a rival Unit or their side of the table to attack.',
	},
]

const step = (key: string, title: string, long: string, short: string, hint: Hint, seen: Set<string>): CoachStep => {
	return { key, title, body: seen.has(key) ? short : long, hint }
}

export function coachFor(s: GameState, me: PlayerId, seen: Set<string>): CoachStep | null {
	const pend = s.pending
	const P = s.players
	const rv = other(me)

	if (pend.kind === 'over') {
		const won = pend.winner === me
		return step(
			'over',
			won ? 'You win!' : 'The Street Samurai wins this one',
			`${won ? 'Nicely done.' : 'Good practice.'} ${pend.reason[0].toUpperCase()}${pend.reason.slice(1)}. Things to try next game: sell a card every turn, keep a Blocker ready when your Gigs are at risk, and attack spent rival Units you can beat. Press New game to play again — the tutorial can be switched off on the setup screen.`,
			'Press New game to play again.',
			{ buttons: ['New game'] },
			seen,
		)
	}
	if (pend.player !== me) {
		const msg = pend.kind === 'react' ? 'Your rival is deciding how to react.' : 'The Street Samurai is taking its turn. Watch the log on the right to see what it does.'
		return { key: 'wait', title: 'Rival’s move', body: msg, hint: {} }
	}

	switch (pend.kind) {
		case 'choose': {
			const sugg = chooseIntent(s)
			const q = pend.question
			const best = sugg && sugg.t === 'choose' ? q.options.filter((o) => sugg.picks.includes(o.id)) : []
			const src = def(s, pend.task.source)
			return step(
				'choose',
				`${src.name} asks you to choose`,
				`Card abilities now work by themselves: when one needs a decision — which die to change, which Unit to target, which cards to keep — the game stops and asks. The question pops up in a box over the table; options on the table also glow, so you can tap them there. ${best.length ? `A good pick here: ${best.map((o) => o.label).join(', ')}.` : q.min === 0 ? 'Skipping is fine here.' : ''}`,
				best.length ? `Suggested: ${best.map((o) => o.label).join(', ')}.` : 'Make your choice.',
				{ buttons: best.length === 1 && q.max === 1 ? [best[0].label] : q.max > 1 ? ['Confirm'] : [], hand: best.filter((o) => o.uid !== undefined && P[me].hand.includes(o.uid)).map((o) => o.uid!), dice: best.filter((o) => o.dieId).map((o) => o.dieId!) },
				seen,
			)
		}
		case 'chooseFirst':
			return step(
				'first',
				'Who goes first?',
				'You won the dice roll, so you choose. Going first is usually good — but the first player spends two of their Legends for the opening turn, so they have less to spend. For practice, go first.',
				'Choose who goes first.',
				{ buttons: ['I go first'] },
				seen,
			)
		case 'mulligan': {
			const cheap = P[me].hand.filter((u) => (def(s, u).cost ?? 9) <= 3).length
			return step(
				'mulligan',
				'Your opening hand',
				`These 6 cards are your starting hand. Once per game you may mulligan: shuffle them back and draw 6 new ones. A good hand has a few cheap cards (cost 1–3) you can play early. You have ${cheap} — ${cheap >= 2 ? 'that’s fine, keep it.' : 'that’s a bit slow; a mulligan is reasonable.'}`,
				cheap >= 2 ? 'Keep this hand.' : 'Consider a mulligan.',
				{ buttons: [cheap >= 2 ? 'Keep' : 'Mulligan'] },
				seen,
			)
		}
		case 'chooseGig': {
			const dice = legalGigDice(P[me])
			const small = [...dice].sort((a, b) => a.sides - b.sides)[0]
			return step(
				'gig',
				'Gain a Gig',
				`Start of your turn: you readied your cards and drew one. Now pick a die from your Fixer area — it’s rolled and moves into your Gigs. Every die counts as one Gig, whatever it rolls. The total of the numbers is your Street Cred, which some cards check. The d20 has to come last. Taking the small dice first (the d${small.sides} here) keeps the big ones for later.`,
				`Pick a die to roll — the d${small.sides} is a fine choice.`,
				{ dice: [small.id] },
				seen,
			)
		}
		case 'steal': {
			const best = [...P[rv].gigs].sort((a, b) => b.value - a.value)[0]
			return step(
				'steal',
				'Steal a Gig',
				'Your attack hit their Gigs! Pick which rival die to take. Each one counts the same towards 7 Gigs, but taking a high roll also raises your Street Cred and lowers theirs.',
				'Pick a rival die to steal.',
				{ dice: best ? [best.id] : [] },
				seen,
			)
		}
		case 'react': {
			const a = pend.attack
			const au = findUnit(s, a.attacker)
			const ap = au ? Math.max(0, unitPower(s, au)) : 0
			const blockers = P[me].field.filter((u) => !u.spent && def(s, u.uid).keywords.includes('blocker'))
			const sugg = chooseIntent(s)
			const blockWith = sugg?.t === 'block' ? sugg.blocker : undefined
			const target = a.target.kind === 'gigs' ? `your Gigs — if it lands it steals ${gigsToSteal(ap)}` : nameOf(s, a.target.uid)
			const long = `The rival’s ${nameOf(s, a.attacker)} (power ${ap}) is attacking ${target}. Before it resolves you can react: Call a Legend, play a Quick Program, or spend a ready Unit with Blocker to take the hit instead${a.target.kind === 'gigs' ? ' — a blocked attack steals nothing' : ''}. ${blockers.length ? (blockWith ? `Blocking with ${nameOf(s, blockWith)} is a good idea here.` : 'Your Blocker would lose this fight, so letting it through may be better.') : 'You have no Blocker ready, so just resolve it.'}`
			return step(
				'react',
				'You’re under attack',
				long,
				blockWith ? `Block with ${def(s, blockWith).name}, or resolve the attack.` : 'React if you can, then resolve the attack.',
				{ buttons: blockWith ? [`Block with ${def(s, blockWith).name}`] : ['Resolve attack'] },
				seen,
			)
		}
		case 'main':
			break
	}

	// ── Main phase: follow the AI's suggestion and explain it ──
	const sugg = chooseIntent(s)
	const avail = available(s, me)
	if (!sugg || sugg.t === 'endTurn') {
		const why = P[me].field.some((u) => !u.spent) ? 'Ready Units you keep back can still block or react on the rival’s turn.' : ''
		return step(
			'end',
			'End your turn',
			`Nothing else worth doing this turn${avail ? ` (you have ${avail} €⁠$ left — unspent Eddies come back next turn anyway)` : ''}. ${why} Press End turn and the Street Samurai will play.`,
			'Press End turn.',
			{ buttons: ['End turn'] },
			seen,
		)
	}
	switch (sugg.t) {
		case 'sell':
			return step(
				'sell',
				'Sell a card for Eddies',
				`Once per turn you can sell a card from your hand: it goes face-down into your Eddies area and pays 1 €⁠$ from now on, every turn. Sell something you can’t use soon — like ${nameOf(s, sugg.uid)}. Tap it in your hand, then press “Sell for 1 €⁠$”.`,
				`Sell ${def(s, sugg.uid).name}: tap it, then “Sell for 1 €⁠$”.`,
				{ hand: [sugg.uid], buttons: ['Sell for 1'] },
				seen,
			)
		case 'play': {
			const d = def(s, sugg.uid)
			if (d.type === 'gear')
				return step(
					'gear',
					'Equip Gear',
					`${nameOf(s, sugg.uid)} is Gear: it attaches to one of your Units (or a face-up Legend) and adds +${d.power ?? 0} power to it. Tap it, press Equip, then tap ${sugg.target !== undefined ? nameOf(s, sugg.target) : 'a Unit'}. If that Unit leaves play, the Gear goes with it.`,
					`Equip ${d.name}${sugg.target !== undefined ? ` to ${def(s, sugg.target).name}` : ''}.`,
					{ hand: [sugg.uid], units: sugg.target !== undefined ? [sugg.target] : [], buttons: ['Equip'] },
					seen,
				)
			return step(
				'unit',
				'Play a Unit',
				`${nameOf(s, sugg.uid)} costs ${d.cost} €⁠$ and you have ${avail}. Tap it and press Play. Units arrive with Lag: they can’t attack on the turn they’re played (unless they have Adrenaline), but they can attack from your next turn. The yellow circle shows a Unit’s power.`,
				`Play ${d.name} (${d.cost} €⁠$).`,
				{ hand: [sugg.uid], buttons: ['Play'] },
				seen,
			)
		}
		case 'goSolo':
			return step(
				'solo',
				'Go Solo',
				`${nameOf(s, sugg.uid)} has Go Solo: pay its cost and the Legend jumps into play as a Unit that can attack this turn. If it’s ever defeated it’s gone for good. Tap the Legend, then press Go Solo.`,
				`Send ${def(s, sugg.uid).name} solo.`,
				{ legends: [sugg.uid], buttons: ['Go Solo'] },
				seen,
			)
		case 'activate': {
			const ab = abilitiesOf(s, sugg.uid)[sugg.ability]
			const isLegend = P[me].legends.some((l) => l.uid === sugg.uid)
			const label = `${ab.label[0].toUpperCase()}${ab.label.slice(1)}`
			return step(
				'ability',
				'Use an ability',
				`${nameOf(s, sugg.uid)} has an ability you can use now: ${ab.label}.${ab.spend ? ' Using it spends the card (turns it sideways), so it works once per turn.' : ''} Tap ${isLegend ? 'the Legend' : 'the card'}, then press the “${label}” button.`,
				`Use ${def(s, sugg.uid).name}: ${ab.label}.`,
				{ ...(isLegend ? { legends: [sugg.uid] } : { units: [sugg.uid] }), buttons: [label] },
				seen,
			)
		}
		case 'callLegend':
			return step(
				'call',
				'Call a Legend',
				'You have an Eddie to spare. Once per turn you can pay 1 €⁠$ to Call a Legend: a random face-down Legend flips face-up, and its ability text (shown big on the left when you tap it) is now in play. You can even do this during the rival’s turn as a reaction.',
				'Call a Legend with your spare Eddie.',
				{ buttons: ['Call a Legend'] },
				seen,
			)
		case 'attack': {
			const au = findUnit(s, sugg.attacker)!
			const ap = attackPower(s, au.uid)
			if (sugg.target.kind === 'unit') {
				const tp = Math.max(0, unitPower(s, findUnit(s, sugg.target.uid)!))
				return step(
					'fight',
					'Attack a Unit',
					`Only spent (sideways) Units can be attacked. The rival’s ${nameOf(s, sugg.target.uid)} is spent and has ${tp} power; your ${nameOf(s, sugg.attacker)} has ${ap}, so it wins the fight and the rival Unit is defeated. (Equal power defeats both.) Tap your Unit, press Attack, then tap their Unit.`,
					`Attack their ${def(s, sugg.target.uid).name} with ${def(s, sugg.attacker).name}.`,
					{ units: [sugg.attacker, sugg.target.uid], buttons: ['Attack'] },
					seen,
				)
			}
			const n = Math.min(gigsToSteal(ap), P[rv].gigs.length)
			return step(
				'gigs',
				'Attack their Gigs',
				`This is how you win: attack the rival’s Gigs to steal dice. ${nameOf(s, sugg.attacker)} has ${ap} power, so it steals ${n} (1 Gig, plus 1 more for every 10 power). The rival can still block with a ready Blocker. Tap your Unit, press Attack, then tap the pink RIVAL GIGS box at the top of your mat. Attacking spends the Unit, which means the rival can attack it on their turn.`,
				`Attack their Gigs with ${def(s, sugg.attacker).name}.`,
				{ units: [sugg.attacker], buttons: ['Attack'], gigTarget: true },
				seen,
			)
		}
	}
	return null
}

/** One-off notes triggered by things that just happened (shown once each). */
export function eventNote(prev: GameState | undefined, s: GameState, me: PlayerId, seen: Set<string>): CoachStep | null {
	if (!prev) return null
	const newLines = s.log.slice(prev.log.length)
	const ran = newLines.find((l) => l.startsWith(`${s.players[me].name} runs `))
	const ranUid = ran ? prev.players[me].hand.find((u) => !s.players[me].hand.includes(u) && def(s, u).type === 'program') : undefined
	if (!seen.has('program') && ranUid !== undefined && !isScripted(def(s, ranUid).id))
		return {
			key: 'program',
			title: 'Programs: apply the text yourself',
			body: 'Programs are one-shot effects. The game enforces the core rules, but most card text isn’t automated yet — read the card and apply it with the tools on the left: tap a Unit for +1/−1 power, Defeat, Return to hand…, or use Draw a card / Trash top of deck.',
			hint: {},
		}
	if (!seen.has('cred') && streetCred(s.players[me]) !== null && s.players[me].gigs.length >= 3)
		return {
			key: 'cred',
			title: 'Street Cred',
			body: `The numbers on your Gig dice add up to your Street Cred (now ${streetCred(s.players[me])}). It doesn’t win the game by itself, but some cards only work if your Street Cred is high enough, or higher than your rival’s.`,
			hint: {},
		}
	return null
}
