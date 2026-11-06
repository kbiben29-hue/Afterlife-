// Placeholder card pool used when the card database hasn't been fetched.
// Every card is generic: a colour, numbers and keyword icons, with no names or text from the real game.

import type { CardDef, Color, Keyword } from '../engine/types'

const C: Record<Color, string> = { red: 'R', green: 'G', blue: 'B', yellow: 'Y' }

function card(color: Color, kind: 'L' | 'U' | 'G' | 'P', n: number, extra: Partial<CardDef>): CardDef {
	const type = ({ L: 'legend', U: 'unit', G: 'gear', P: 'program' } as const)[kind]
	const id = `ph-${C[color]}${kind}${String(n).padStart(2, '0')}`
	return {
		id,
		name: `${C[color]}-${kind}${String(n).padStart(2, '0')}`,
		type,
		color,
		cost: 0,
		power: null,
		ram: 1,
		sell: type !== 'legend',
		keywords: [],
		text: '',
		tags: [],
		placeholder: true,
		...extra,
	}
}

function colorPool(color: Color): CardDef[] {
	const kw = (...k: Keyword[]) => k
	return [
		card(color, 'L', 1, { cost: null, ram: 2, sell: true, text: 'Placeholder Legend.' }),
		card(color, 'L', 2, { cost: null, ram: 2, sell: true, text: 'Placeholder Legend.' }),
		card(color, 'L', 3, { cost: 6, power: 6, ram: 2, sell: false, keywords: kw('goSolo'), text: 'Go Solo.' }),
		card(color, 'U', 1, { cost: 1, power: 2, ram: 1 }),
		card(color, 'U', 2, { cost: 2, power: 3, ram: 1 }),
		card(color, 'U', 3, { cost: 2, power: 1, ram: 1, keywords: kw('blocker') }),
		card(color, 'U', 4, { cost: 3, power: 4, ram: 1 }),
		card(color, 'U', 5, { cost: 3, power: 3, ram: 2, keywords: kw('adrenaline') }),
		card(color, 'U', 6, { cost: 4, power: 5, ram: 2 }),
		card(color, 'U', 7, { cost: 4, power: 4, ram: 2, keywords: kw('blocker') }),
		card(color, 'U', 8, { cost: 5, power: 7, ram: 2 }),
		card(color, 'U', 9, { cost: 6, power: 9, ram: 3 }),
		card(color, 'U', 10, { cost: 7, power: 11, ram: 3 }),
		card(color, 'G', 1, { cost: 1, power: 1, ram: 1, text: 'Equip: +1 power.' }),
		card(color, 'G', 2, { cost: 2, power: 2, ram: 2, text: 'Equip: +2 power.' }),
		card(color, 'P', 1, { cost: 1, ram: 1, keywords: kw('quick'), text: 'Quick. Placeholder effect (apply by hand).' }),
		card(color, 'P', 2, { cost: 2, ram: 2, text: 'Placeholder effect (apply by hand).' }),
	]
}

export const PLACEHOLDER_CARDS: Record<string, CardDef> = Object.fromEntries(
	(['red', 'green', 'blue', 'yellow'] as Color[]).flatMap(colorPool).map((d) => [d.id, d]),
)
