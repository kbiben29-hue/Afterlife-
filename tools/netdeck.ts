// Reads card data straight from the Netdeck.gg API that powers cyberpunktcg.com's card database and
// Deck Builder. The API is undocumented: known from a public deck URL
// (https://api.netdeck.gg/api/cyberpunk/decks/<uuid>) and the card image URLs
// (https://api.netdeck.gg/api/cards/cyberpunk/<slug>/image). The exact card-list endpoint is
// discovered at run time: candidate URLs are tried, and the site's own JavaScript is searched for
// api.netdeck.gg paths. Whatever answers with a list of cards is mapped field by field.

import type { CardDef, Color, Keyword } from '../src/engine/types'

export const API = 'https://api.netdeck.gg/api'
const SITE = 'https://cyberpunktcg.com'
const UA = 'Afterlife-fan-client (personal card cache)'

type Json = Record<string, unknown>

async function getJson(url: string): Promise<unknown | null> {
	try {
		const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
		if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null
		return await res.json()
	} catch {
		return null
	}
}

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

function pageInfo(body: unknown): { total?: number; limit?: number } {
	const b = (body && typeof body === 'object' ? body : {}) as Json
	const meta = { ...b, ...((b.meta as Json) ?? {}), ...((b.pagination as Json) ?? {}) }
	const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : undefined)
	return { total: num(meta.total ?? meta.count ?? meta.total_count), limit: num(meta.limit ?? meta.per_page ?? meta.page_size) }
}

/** Candidate endpoints, plus any api.netdeck.gg card paths found in the site's scripts. */
async function candidates(): Promise<string[]> {
	const out = [
		`${API}/cyberpunk/cards`,
		`${API}/cards/cyberpunk`,
		`${API}/cyberpunk/cards?limit=1000`,
		`${API}/cards/cyberpunk?limit=1000`,
		`${API}/cyberpunk/cards?per_page=1000`,
		`${API}/cards?game=cyberpunk&limit=1000`,
	]
	try {
		for (const page of ['/decks', '/cards']) {
			const html = await (await fetch(SITE + page, { headers: { 'User-Agent': UA } })).text()
			const scripts = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((m) => new URL(m[1], SITE).toString())
			for (const src of [...new Set(scripts)].slice(0, 40)) {
				const js = await (await fetch(src, { headers: { 'User-Agent': UA } })).text()
				for (const m of js.matchAll(/https:\/\/api\.netdeck\.gg\/api\/[A-Za-z0-9_\-/{}$.?=&]*card[A-Za-z0-9_\-/?=&]*/g))
					if (!/[{}$]/.test(m[0]) && !m[0].endsWith('/image')) out.push(m[0])
				for (const m of js.matchAll(/["'`](\/api\/[A-Za-z0-9_\-/]*cards?[A-Za-z0-9_\-/?=&]*)["'`]/g)) out.push(`https://api.netdeck.gg${m[1]}`)
			}
		}
	} catch {
		/* discovery is best effort */
	}
	return [...new Set(out)]
}

/** Returns raw card objects from the first endpoint that answers, following pagination. */
export async function fetchCardList(log: (s: string) => void): Promise<{ endpoint: string; raw: Json[] } | null> {
	for (const url of await candidates()) {
		const body = await getJson(url)
		const first = cardArray(body)
		if (first.length === 0) continue
		log(`  ${url} → ${first.length} cards`)
		const raw = [...first]
		const { total, limit } = pageInfo(body)
		const sep = url.includes('?') ? '&' : '?'
		const key = (c: Json) => String(c.id ?? c.slug ?? c.name)
		// Netdeck pages with offset/limit ({ items, total, limit, offset }); fall back to page=N.
		for (let i = 2; i <= 60 && (total === undefined || raw.length < total); i++) {
			const next = limit ? `${url}${sep}offset=${raw.length}&limit=${limit}` : `${url}${sep}page=${i}`
			const fresh = cardArray(await getJson(next)).filter((c) => !raw.some((r) => key(r) === key(c)))
			if (fresh.length === 0) break
			raw.push(...fresh)
			log(`  … ${raw.length}${total ? `/${total}` : ''}`)
		}
		if (total && raw.length < total) log(`  warning: only got ${raw.length} of ${total} cards`)
		return { endpoint: url, raw }
	}
	return null
}

// ───────── mapping a raw API card to our CardDef ─────────

const str = (v: unknown): string => {
	if (v === null || v === undefined) return ''
	if (typeof v === 'string') return v
	if (typeof v === 'number') return String(v)
	if (Array.isArray(v)) return v.map(str).join(' ')
	if (typeof v === 'object') return str((v as Json).name ?? (v as Json).value ?? (v as Json).slug ?? '')
	return ''
}
const num = (v: unknown): number | null => {
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

/** Download a deck from the Deck Builder: accepts a deck URL or bare id. Returns "N Name" lines. */
export async function fetchDeckList(urlOrId: string): Promise<string> {
	const id = urlOrId.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]
	if (!id) throw new Error('No deck id found in that link')
	const body = (await getJson(`${API}/cyberpunk/decks/${id}`)) as Json | null
	if (!body) throw new Error('Deck not found (is it public?)')
	const deck = ((body.data as Json) ?? body) as Json
	const lines: string[] = [`# ${str(deck.name ?? deck.title ?? id)}`]
	const walk = (v: unknown) => {
		if (Array.isArray(v))
			for (const e of v) {
				if (!e || typeof e !== 'object') continue
				const o = e as Json
				const card = ((o.card as Json) ?? o) as Json
				const name = str(card.name)
				const qty = num(o.quantity ?? o.qty ?? o.count ?? o.amount) ?? 1
				if (name) lines.push(`${qty} ${name}${card.subtitle ? ` — ${str(card.subtitle)}` : ''}`)
				else walk(Object.values(o))
			}
		else if (v && typeof v === 'object') for (const k of ['legends', 'cards', 'main', 'main_deck', 'deck', 'entries', 'items']) if (k in (v as Json)) walk((v as Json)[k])
	}
	walk(deck)
	if (lines.length === 1) throw new Error('Deck downloaded but no cards recognised — save it with --debug and send it to Claude')
	return lines.join('\n')
}
