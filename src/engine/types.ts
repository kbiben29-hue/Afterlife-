// Core types for the Afterlife rules engine. Pure data: no DOM, no clocks, no Math.random.

export type Color = 'red' | 'green' | 'blue' | 'yellow'
export const COLORS: Color[] = ['red', 'green', 'blue', 'yellow']

export type CardType = 'legend' | 'unit' | 'gear' | 'program'

/** Keywords the engine enforces itself. Everything else on a card is shown as text. */
export type Keyword = 'adrenaline' | 'blocker' | 'quick' | 'goSolo'

export interface CardDef {
	id: string
	name: string
	subtitle?: string
	type: CardType
	color: Color | null
	/** null = Null cost (a Legend that can never be played to the field) */
	cost: number | null
	/** Units: printed power. Gear: power it adds to the equipped card. */
	power: number | null
	ram: number
	/** Has a Sell tag (can be sold for an Eddie; face-up Legends need one to be spent) */
	sell: boolean
	keywords: Keyword[]
	text: string
	tags: string[]
	/** local image path, only when the card database has been fetched */
	image?: string
	placeholder?: boolean
}

export type PlayerId = 0 | 1
export const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0)

export type DieSides = 4 | 6 | 8 | 10 | 12 | 20
export const DIE_SIDES: DieSides[] = [4, 6, 8, 10, 12, 20]

export interface Die {
	id: string // e.g. "0-d12": owner index + size, stable for the whole game
	sides: DieSides
	value: number
}

export interface CardInstance {
	uid: number
	cardId: string
	owner: PlayerId
}

export interface LegendSlot {
	uid: number
	faceUp: boolean
	spent: boolean
	/** first player's two leftmost Legends stay spent through their first Ready step */
	skipNextReady: boolean
	gear: number[]
}

export interface FieldUnit {
	uid: number
	spent: boolean
	lag: boolean
	/** Adrenaline granted for this turn, or a Legend played with Go Solo */
	attackDespiteLag: boolean
	goSolo: boolean
	gear: number[]
	powerThisTurn: number
	powerPermanent: number
	/** stole a Gig this turn (Delamain Cab) */
	stoleThisTurn?: boolean
	/** Eddies to ready at the end of this turn (Dying Night on V) */
	eotEddies?: number
}

export interface EddieSlot {
	uid: number
	spent: boolean
}

export interface PlayerState {
	name: string
	deck: number[] // top of deck = index 0
	hand: number[]
	trash: number[]
	removed: number[]
	eddies: EddieSlot[]
	legends: LegendSlot[]
	field: FieldUnit[]
	fixer: Die[]
	gigs: Die[]
	soldThisTurn: boolean
	calledThisTurn: boolean
	mulliganed: boolean
	turnsTaken: number
	/** face-down Legends this player has looked at (Kiroshi Optics, T-Bug, Radioport) */
	knownLegends?: number[]
	/** once-per-turn ability flags, cleared at the start of each turn */
	usedThisTurn?: string[]
	/** Chrome Fang: until this player's next turn, rival Units can't steal friendly Gigs worth more than their power */
	stealShield?: boolean
	/** Reboot Optics: the next fight this turn against a rival Unit won't defeat our Unit */
	fightShield?: number
}

export type AttackTarget = { kind: 'unit'; uid: number } | { kind: 'gigs' }

export interface AttackState {
	attacker: number
	target: AttackTarget
	/** set when a Blocker redirected a direct attack: no Gigs are stolen */
	redirected: boolean
}

/** A question an effect asks a player (choose a target, a die, cards…). */
export interface ChoiceOption {
	id: string
	label: string
	uid?: number
	dieId?: string
	/** how good this pick is for the chooser (the computer player uses it) */
	score?: number
}
export interface Question {
	prompt: string
	options: ChoiceOption[]
	min: number
	max: number
	/** cards the chooser may see while deciding (e.g. the face-down Legends they just looked at) */
	reveal?: number[]
}
/** A triggered or played effect waiting to resolve. */
export interface Task {
	key: string // effect id: `${cardId}:${trigger}`
	source: number // card uid
	owner: PlayerId
	data?: Record<string, unknown>
	answers: string[][]
}

export type Pending =
	| { kind: 'chooseFirst'; player: PlayerId; rolls: [number, number] }
	| { kind: 'mulligan'; player: PlayerId }
	| { kind: 'chooseGig'; player: PlayerId }
	| { kind: 'main'; player: PlayerId }
	| { kind: 'react'; player: PlayerId; attack: AttackState }
	| { kind: 'steal'; player: PlayerId; remaining: number; /** Chrome Fang */ maxValue?: number }
	| { kind: 'choose'; player: PlayerId; question: Question; task: Task }
	| { kind: 'over'; winner: PlayerId; reason: string }

export interface GameState {
	version: 1
	rng: number
	cards: Record<string, CardDef>
	instances: Record<number, CardInstance>
	players: [PlayerState, PlayerState]
	active: PlayerId
	firstPlayer: PlayerId | null
	turn: number // total turns started
	overtime: boolean
	/** consecutive turns that started with both Fixer areas empty (overtime trigger, CR 1.11.1) */
	emptyFixerTurns: number
	pending: Pending
	log: string[]
	/** effects waiting to resolve, in order */
	queue?: Task[]
	/** where play continues once the queue is empty */
	after?: Pending | null
	/** the Unit currently attacking (for "while attacking" effects) */
	attacking?: number | null
}

export type ManualOp =
	| { op: 'defeat'; uid: number }
	| { op: 'toHand'; uid: number }
	| { op: 'discard'; uid: number }
	| { op: 'power'; uid: number; delta: number; permanent?: boolean }
	| { op: 'toggleSpent'; uid: number }
	| { op: 'adrenaline'; uid: number }
	| { op: 'draw' }
	| { op: 'trashTop' }
	| { op: 'moveDie'; dieId: string }
	| { op: 'reroll'; dieId: string }
	| { op: 'setDie'; dieId: string; value: number }
	| { op: 'flipLegend'; uid: number }

export type Intent =
	| { t: 'chooseFirst'; player: PlayerId; first: PlayerId }
	| { t: 'mulligan'; player: PlayerId; redraw: boolean }
	| { t: 'chooseGig'; player: PlayerId; dieId: string }
	| { t: 'sell'; player: PlayerId; uid: number }
	| { t: 'callLegend'; player: PlayerId }
	| { t: 'play'; player: PlayerId; uid: number; target?: number }
	| { t: 'goSolo'; player: PlayerId; uid: number }
	| { t: 'attack'; player: PlayerId; attacker: number; target: AttackTarget }
	| { t: 'block'; player: PlayerId; blocker: number }
	| { t: 'pass'; player: PlayerId }
	| { t: 'steal'; player: PlayerId; dieId: string }
	| { t: 'endTurn'; player: PlayerId }
	| { t: 'concede'; player: PlayerId }
	| { t: 'manual'; player: PlayerId; m: ManualOp }
	| { t: 'choose'; player: PlayerId; picks: string[] }

export interface DeckList {
	legends: string[] // exactly 3 card ids
	main: string[] // 40–50 card ids
}
