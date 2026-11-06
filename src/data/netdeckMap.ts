// Maps Netdeck.gg API responses (the backend of cyberpunktcg.com's card database) to CardDef.
// Shared by tools/fetch-cards.ts (Node) and the app's live card loader (src/data/cards.ts).

import type { CardDef, Color, Keyword } from '../engine/types'

export type Json = Record<string, unknown>
export const NETDECK_API = 'https://api.netdeck.gg/api'
export const CARD_LIST_URL = `${NETDECK_API}/cards/cyberpunk`
export const cardImageUrl = (slug: string) => `${NETDECK_API}/cards/cyberpunk/${encodeURIComponent(slug)}/image`

/** Pull an array of card-like objects out of whatever shape the response has. */
export function cardArray(body: unknown): Json[] {
	const looksLikeCard = (o: unknown) => !!o && typeof o === 'object' && 'name' in (o as Json) && ['slug', 'type', 'card_type', 'cost'].some((k) => k in (o as Json))
	if (Array.isArray(body)) return body.filter(looksLikeCard) as Json[]
	if (body && typeof body === 'object') {
		for (const k of ['items', 'data', 'cards', 'results', 'docs', 'rows']) {
			const v = (body as Json)[k]
			if (Array.isArray(v) && v.some(looksLikeCard)) return v.filter(looksLikeCard) as Json[]
			if (v && typeof v === 'object') {
				const inner = cardArray(v)
				if (inner.length) return inner
			}
		}
	}
	return []
}

export function pageInfo(body: unknown): { total?: number; limit?: number } {
	const b = (body && typeof body === 'object' ? body : {}) as Json
	const meta = { ...b, ...((b.meta as Json) ?? {}), ...((b.pagination as Json) ?? {}) }
	const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : undefined)
	return { total: num(meta.total ?? meta.count ?? meta.total_count), limit: num(meta.limit ?? meta.per_page ?? meta.page_size) }
}

// ───────── mapping a raw API card to our CardDef ─────────

export const str = (v: unknown): string => {
	if (v === null || v === undefined) return ''
	if (typeof v === 'string') return v
	if (typeof v === 'number') return String(v)
	if (Array.isArray(v)) return v.map(str).join(' ')
	if (typeof v === 'object') return str((v as Json).name ?? (v as Json).value ?? (v as Json).slug ?? '')
	return ''
}
export const num = (v: unknown): number | null => {
	if (v === null || v === undefined || v === '') return null
	const n = Number(typeof v === 'object' ? ((v as Json).value ?? NaN) : v)
	return Number.isFinite(n) ? n : null
}
const slugify = (s: string) =>
	s
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')

/** Look through a card object (and one level of nesting, e.g. attributes/stats) for the first key that exists. */
function field(c: Json, ...keys: string[]): unknown {
	const pools = [c, ...Object.values(c).filter((v): v is Json => !!v && typeof v === 'object' && !Array.isArray(v))]
	for (const pool of pools) for (const k of keys) if (k in pool && pool[k] !== null && pool[k] !== undefined) return pool[k]
	return undefined
}

export function mapCard(c: Json): CardDef {
	const fullName = str(field(c, 'name', 'title'))
	const subtitleRaw = str(field(c, 'subtitle', 'sub_title', 'epithet', 'subname'))
	const [n, sub] = subtitleRaw ? [fullName, subtitleRaw] : fullName.split(/\s+[—–-]\s+|:\s+/, 2)
	const typeStr = str(field(c, 'type', 'card_type', 'cardType', 'category')).toLowerCase()
	const type = (['legend', 'unit', 'gear', 'program'] as const).find((t) => typeStr.includes(t)) ?? 'unit'
	const colorStr = str(field(c, 'color', 'colour', 'colors', 'faction_color')).toLowerCase()
	const color = (['red', 'green', 'blue', 'yellow'] as Color[]).find((x) => colorStr.includes(x)) ?? null
	const text = str(field(c, 'rules_text', 'official_rules_text_en', 'text', 'rulesText', 'ability', 'abilities', 'effect', 'description'))
	// A keyword the card itself has is printed at the start of a line, e.g. "{Go Solo} (reminder…)".
	// Words later in a sentence ("give a Unit {Blocker}") grant it to something else, so they don't count.
	const own = [...text.matchAll(/^\s*\{([^}]+)\}/gm)].map((m) => m[1]).join(' ') + ' ' + str(field(c, 'keywords', 'keyword'))
	const keywords: Keyword[] = []
	if (/\bquick\b/i.test(own)) keywords.push('quick')
	if (/\bblocker\b/i.test(own)) keywords.push('blocker')
	if (/\badrenaline\b/i.test(own)) keywords.push('adrenaline')
	if (/\bgo[\s_-]*solo\b/i.test(own)) keywords.push('goSolo')
	const sellRaw = field(c, 'is_eddiable', 'sell', 'sell_tag', 'sellTag', 'has_sell_tag', 'sellable', 'can_sell')
	const cost = num(field(c, 'cost', 'eddies', 'eddie_cost', 'cost_value'))
	const tagsRaw = field(c, 'classifications', 'tags', 'subtypes', 'traits')
	return {
		id: str(field(c, 'slug')) || slugify(fullName),
		name: n.trim(),
		subtitle: sub?.trim() || undefined,
		type,
		color,
		cost: type === 'legend' && cost === null ? null : (cost ?? 0),
		power: num(field(c, 'power', 'pow')),
		ram: num(field(c, 'ram', 'ram_value', 'ramValue')) ?? 0,
		sell: sellRaw === undefined ? type !== 'legend' : Boolean(sellRaw),
		keywords,
		text,
		tags: Array.isArray(tagsRaw) ? tagsRaw.map(str).filter(Boolean) : [],
	}
}

