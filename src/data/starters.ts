// The two "Welcome to Night City" starter decks, by Netdeck card slug. Every card in them has a
// scripted ability in src/engine/effects.ts, so these decks play themselves and power the lessons.

import type { DeckList } from '../engine/types'

export interface StarterDeck {
	id: 'heist' | 'power'
	name: string
	colors: string
	legends: string[]
	main: [string, number][]
}

export const STARTERS: StarterDeck[] = [
	{
		id: 'heist',
		name: 'The Heist',
		colors: 'Yellow / Blue',
		legends: ['v-corporate-exile', 'jackie-welles-pour-one-out-for-me', 'viktor-vektor-sit-down-and-relax'],
		main: [
			['secondhand-bombus', 2],
			['dexter-deshawn-one-last-chance', 2],
			['offduty-malfini', 2],
			['t-bug-amateur-philosopher', 2],
			['heywood-ripperdoc', 2],
			['evelyn-parker-scheming-siren', 3],
			['delamain-cab', 3],
			['psycho-squad', 2],
			['mt0d12-flathead', 2],
			['kiroshi-optics', 3],
			['mandibular-upgrade', 3],
			['zetatech-faceplate', 3],
			['tetratronic-rippler', 2],
			['dying-night-v-s-pistol', 2],
			['afterparty-at-lizzie-s', 2],
			['floor-it', 3],
			['reboot-optics', 2],
		],
	},
	{
		id: 'power',
		name: 'Embracing Power',
		colors: 'Red / Green',
		legends: ['goro-takemura-hands-unclean', 'saburo-arasaka-stubborn-patriarch', 'yorinobu-arasaka-embracing-destruction'],
		main: [
			['ruthless-lowlife', 3],
			['swordwise-huscle', 2],
			['chrome-fang', 2],
			['minotaur', 2],
			['corpo-security', 3],
			['emergency-atlus', 2],
			['field-operator', 2],
			['goro-takemura-losing-his-way', 2],
			['maxtac-av', 2],
			['mantis-blades', 3],
			['arasaka-emergency-radioport', 2],
			['satori-sword-of-saburo', 3],
			['sandevistan', 3],
			['industrial-assembly', 2],
			['over-the-edge', 2],
			['shattered-memories', 2],
			['corporate-surveillance', 3],
		],
	},
]

export function starterDeck(id: StarterDeck['id']): DeckList {
	const d = STARTERS.find((x) => x.id === id)!
	return { legends: [...d.legends], main: d.main.flatMap(([slug, n]) => Array(n).fill(slug)) }
}

/** Card slugs the starter decks need that are missing from a card pool. */
export function missingStarterCards(pool: Record<string, unknown>): string[] {
	const all = STARTERS.flatMap((d) => [...d.legends, ...d.main.map(([s]) => s)])
	return all.filter((s) => !pool[s])
}
