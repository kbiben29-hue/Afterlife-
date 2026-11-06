// Reads card data straight from the Netdeck.gg API that powers cyberpunktcg.com's card database and
// Deck Builder. The API is undocumented: known from a public deck URL
// (https://api.netdeck.gg/api/cyberpunk/decks/<uuid>) and the card image URLs
// (https://api.netdeck.gg/api/cards/cyberpunk/<slug>/image). The exact card-list endpoint is
// discovered at run time: candidate URLs are tried, and the site's own JavaScript is searched for
// api.netdeck.gg paths. Whatever answers with a list of cards is mapped field by field.

import { cardArray, mapCard, num, pageInfo, str, type Json } from '../src/data/netdeckMap'

export { cardArray, mapCard }

export const API = 'https://api.netdeck.gg/api'
const SITE = 'https://cyberpunktcg.com'
const UA = 'Afterlife-fan-client (personal card cache)'


async function getJson(url: string): Promise<unknown | null> {
	try {
		const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
		if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null
		return await res.json()
	} catch {
		return null
	}
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
