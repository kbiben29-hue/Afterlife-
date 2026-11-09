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

export const STARTER_FIXTURE: Record<string, CardDef> = Object.fromEntries(
	[
		C('v-corporate-exile', 'V', 'legend', 'blue', 5, 8, { tags: ['Corpo', 'Merc'], kw: ['goSolo'] }),
		C('jackie-welles-pour-one-out-for-me', 'Jackie Welles', 'legend', 'blue', null, null, { tags: ['Merc'] }),
		C('viktor-vektor-sit-down-and-relax', 'Viktor Vektor', 'legend', 'yellow', null, null, { tags: ['Ripperdoc'], ram: 2 }),
		C('secondhand-bombus', 'Secondhand Bombus', 'unit', 'yellow', 2, 0, { tags: ['Drone', 'Zetatech'], kw: ['blocker'], sell: false }),
		C('dexter-deshawn-one-last-chance', 'Dexter DeShawn', 'unit', 'yellow', 3, 4, { tags: ['Fixer'] }),
		C('offduty-malfini', 'Offduty Malfini', 'unit', 'yellow', 4, 5, { tags: ['Ganger', 'Voodoo Boys'] }),
		C('t-bug-amateur-philosopher', 'T-Bug', 'unit', 'yellow', 4, 4, { tags: ['Merc', 'Netrunner'] }),
		C('heywood-ripperdoc', 'Heywood Ripperdoc', 'unit', 'yellow', 6, 8, { tags: ['Ripperdoc'] }),
		C('evelyn-parker-scheming-siren', 'Evelyn Parker', 'unit', 'blue', 2, 0, { tags: ['Doll'], ram: 3 }),
		C('delamain-cab', 'Delamain Cab', 'unit', 'blue', 4, 4, { tags: ['Vehicle'] }),
		C('psycho-squad', 'Psycho Squad', 'unit', 'blue', 4, 6, { tags: ['NCPD'] }),
		C('mt0d12-flathead', 'MT0D12 Flathead', 'unit', 'blue', 5, 7, { tags: ['Drone', 'Militech'], ram: 3, sell: true }),
		C('kiroshi-optics', 'Kiroshi Optics', 'gear', 'yellow', 1, 1, { tags: ['Cyberware'] }),
		C('mandibular-upgrade', 'Mandibular Upgrade', 'gear', 'yellow', 1, 0, { tags: ['Cyberware'], ram: 2 }),
		C('zetatech-faceplate', 'Zetatech Faceplate', 'gear', 'yellow', 2, 2, { tags: ['Cyberware', 'Zetatech'] }),
		C('tetratronic-rippler', 'Tetratronic Rippler', 'gear', 'blue', 1, 1, { tags: ['Cyberware'], ram: 2 }),
		C('dying-night-v-s-pistol', 'Dying Night', 'gear', 'blue', 2, 2, { tags: ['Merc', 'Weapon'] }),
		C('afterparty-at-lizzie-s', "Afterparty at Lizzie's", 'program', 'yellow', 1, null, { tags: ['Braindance', 'Mox'] }),
		C('floor-it', 'Floor It', 'program', 'blue', 1, null, { tags: ['Merc', 'Quickhack'], kw: ['quick'] }),
		C('reboot-optics', 'Reboot Optics', 'program', 'blue', 2, null, { tags: ['Quickhack'], ram: 2, kw: ['quick'] }),

		C('goro-takemura-hands-unclean', 'Goro Takemura', 'legend', 'green', 5, 7, { tags: ['Arasaka', 'Corpo'], kw: ['goSolo', 'blocker'] }),
		C('saburo-arasaka-stubborn-patriarch', 'Saburo Arasaka', 'legend', 'green', null, null, { tags: ['Arasaka', 'Corpo'] }),
		C('yorinobu-arasaka-embracing-destruction', 'Yorinobu Arasaka', 'legend', 'red', null, null, { tags: ['Arasaka', 'Corpo'] }),
		C('ruthless-lowlife', 'Ruthless Lowlife', 'unit', 'red', 2, 4, { tags: ['Ganger', 'Maelstrom'] }),
		C('swordwise-huscle', 'Swordwise Huscle', 'unit', 'red', 3, 3, { tags: ['Merc'] }),
		C('chrome-fang', 'Chrome Fang', 'unit', 'red', 5, 6, { tags: ['Ganger', 'Netrunner', 'Tyger Claws'] }),
		C('minotaur', 'Minotaur', 'unit', 'red', 7, 9, { tags: ['Arasaka', 'Drone', 'Militech'] }),
		C('corpo-security', 'Corpo Security', 'unit', 'green', 2, 2, { tags: ['Corpo'], kw: ['blocker'] }),
		C('emergency-atlus', 'Emergency Atlus', 'unit', 'green', 3, 4, { tags: ['Trauma Team', 'Vehicle', 'Zetatech'] }),
		C('field-operator', 'Field Operator', 'unit', 'green', 3, 2, { tags: ['Arasaka', 'Corpo', 'Techie'] }),
		C('goro-takemura-losing-his-way', 'Goro Takemura', 'unit', 'green', 4, 4, { tags: ['Arasaka', 'Corpo'], ram: 3 }),
		C('maxtac-av', 'MaxTac AV', 'unit', 'green', 5, 8, { tags: ['NCPD', 'Vehicle'] }),
		C('mantis-blades', 'Mantis Blades', 'gear', 'red', 1, 2, { tags: ['Cyberware'] }),
		C('arasaka-emergency-radioport', 'Arasaka Emergency Radioport', 'gear', 'red', 2, 2, { tags: ['Arasaka', 'Cyberware'], ram: 2 }),
		C('satori-sword-of-saburo', 'Satori', 'gear', 'red', 2, 2, { tags: ['Arasaka', 'Weapon'] }),
		C('sandevistan', 'Sandevistan', 'gear', 'green', 3, 2, { tags: ['Cyberware'], ram: 3 }),
		C('industrial-assembly', 'Industrial Assembly', 'program', 'red', 1, null, { tags: ['Arasaka', 'Braindance'] }),
		C('over-the-edge', 'Over the Edge', 'program', 'red', 3, null, { tags: ['Merc'], ram: 2 }),
		C('shattered-memories', 'Shattered Memories', 'program', 'red', 4, null, { tags: ['Braindance'], ram: 2 }),
		C('corporate-surveillance', 'Corporate Surveillance', 'program', 'green', 2, null, { tags: ['Corpo'] }),
	].map((c) => [c.id, c]),
)
