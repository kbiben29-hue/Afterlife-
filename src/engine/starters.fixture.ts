// Test-only stand-ins for the starter-deck cards: game numbers only (no card text, no art), so the
// scripted abilities in effects.ts can be tested without the card database.

import type { CardDef, CardType, Color, Keyword } from './types'

const C = (
	id: string,
	name: string,
	type: CardType,
	color: Color,
	cost: number | null,
	power: number | null,
	opts: { ram?: number; kw?: Keyword[]; tags?: string[]; sell?: boolean } = {},
): CardDef => ({
	id,
	name,
	type,
	color,
	cost,
	power,
	ram: opts.ram ?? (type === 'legend' ? 2 : 1),
	sell: opts.sell ?? type !== 'unit', // the database's "eddiable" flag: Units mostly can't be sold
	keywords: opts.kw ?? [],
	text: '',
	tags: opts.tags ?? [],
})
const A = ['Arasaka']

export const STARTER_FIXTURE: Record<string, CardDef> = Object.fromEntries(
	[
		C('v-corporate-exile', 'V', 'legend', 'blue', 5, 8, { kw: ['goSolo'] }),
		C('jackie-welles-pour-one-out-for-me', 'Jackie Welles', 'legend', 'blue', null, null),
		C('viktor-vektor-sit-down-and-relax', 'Viktor Vektor', 'legend', 'yellow', null, null, { ram: 2 }),
		C('secondhand-bombus', 'Secondhand Bombus', 'unit', 'yellow', 2, 0, { kw: ['blocker'], sell: false }),
		C('dexter-deshawn-one-last-chance', 'Dexter DeShawn', 'unit', 'yellow', 3, 4),
		C('offduty-malfini', 'Offduty Malfini', 'unit', 'yellow', 4, 5),
		C('t-bug-amateur-philosopher', 'T-Bug', 'unit', 'yellow', 4, 4),
		C('heywood-ripperdoc', 'Heywood Ripperdoc', 'unit', 'yellow', 6, 8),
		C('evelyn-parker-scheming-siren', 'Evelyn Parker', 'unit', 'blue', 2, 0, { ram: 3 }),
		C('delamain-cab', 'Delamain Cab', 'unit', 'blue', 4, 4),
		C('psycho-squad', 'Psycho Squad', 'unit', 'blue', 4, 6),
		C('mt0d12-flathead', 'MT0D12 Flathead', 'unit', 'blue', 5, 7, { ram: 3, sell: true }),
		C('kiroshi-optics', 'Kiroshi Optics', 'gear', 'yellow', 1, 1),
		C('mandibular-upgrade', 'Mandibular Upgrade', 'gear', 'yellow', 1, 0, { ram: 2 }),
		C('zetatech-faceplate', 'Zetatech Faceplate', 'gear', 'yellow', 2, 2),
		C('tetratronic-rippler', 'Tetratronic Rippler', 'gear', 'blue', 1, 1, { ram: 2 }),
		C('dying-night-v-s-pistol', 'Dying Night', 'gear', 'blue', 2, 2),
		C('afterparty-at-lizzie-s', "Afterparty at Lizzie's", 'program', 'yellow', 1, null),
		C('floor-it', 'Floor It', 'program', 'blue', 1, null, { kw: ['quick'] }),
		C('reboot-optics', 'Reboot Optics', 'program', 'blue', 2, null, { ram: 2, kw: ['quick'] }),

		C('goro-takemura-hands-unclean', 'Goro Takemura', 'legend', 'green', 5, 7, { kw: ['goSolo', 'blocker'], tags: A }),
		C('saburo-arasaka-stubborn-patriarch', 'Saburo Arasaka', 'legend', 'green', null, null, { tags: A }),
		C('yorinobu-arasaka-embracing-destruction', 'Yorinobu Arasaka', 'legend', 'red', null, null, { tags: A }),
		C('ruthless-lowlife', 'Ruthless Lowlife', 'unit', 'red', 2, 4),
		C('swordwise-huscle', 'Swordwise Huscle', 'unit', 'red', 3, 3),
		C('chrome-fang', 'Chrome Fang', 'unit', 'red', 5, 6),
		C('minotaur', 'Minotaur', 'unit', 'red', 7, 9, { tags: A }),
		C('corpo-security', 'Corpo Security', 'unit', 'green', 2, 2, { kw: ['blocker'] }),
		C('emergency-atlus', 'Emergency Atlus', 'unit', 'green', 3, 4),
		C('field-operator', 'Field Operator', 'unit', 'green', 3, 2, { tags: A }),
		C('goro-takemura-losing-his-way', 'Goro Takemura', 'unit', 'green', 4, 4, { ram: 3, tags: A }),
		C('maxtac-av', 'MaxTac AV', 'unit', 'green', 5, 8),
		C('mantis-blades', 'Mantis Blades', 'gear', 'red', 1, 2),
		C('arasaka-emergency-radioport', 'Arasaka Emergency Radioport', 'gear', 'red', 2, 2, { ram: 2, tags: A }),
		C('satori-sword-of-saburo', 'Satori', 'gear', 'red', 2, 2, { tags: A }),
		C('sandevistan', 'Sandevistan', 'gear', 'green', 3, 2, { ram: 3 }),
		C('industrial-assembly', 'Industrial Assembly', 'program', 'red', 1, null, { tags: A }),
		C('over-the-edge', 'Over the Edge', 'program', 'red', 3, null, { ram: 2 }),
		C('shattered-memories', 'Shattered Memories', 'program', 'red', 4, null, { ram: 2 }),
		C('corporate-surveillance', 'Corporate Surveillance', 'program', 'green', 2, null),
	].map((c) => [c.id, c]),
)
