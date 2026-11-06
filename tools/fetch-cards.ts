// npm run fetch-cards
//
// Copies the Cyberpunk TCG card list and card renders from the official card database
// (cyberpunktcg.com, powered by Netdeck.gg) onto THIS computer:
//   public/cards/cards.json   card stats + text the game reads
//   public/cards/img/*        card renders
//   vendor/cards/raw/*.html   the raw pages (only with --debug), for fixing the parser
// All of these are gitignored: card wording and art belong to WeirdCo / CD PROJEKT RED and are never committed.
//
// The site has no documented API, so this reads the public card pages. If the site changes
// and fields come out wrong, run with --debug and adjust parseCardPage() below.

import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CardDef, Color, Keyword } from '../src/engine/types'
import { fetchCardList, mapCard } from './netdeck'

const SITE = 'https://cyberpunktcg.com'
const IMAGE = (slug: string) => `https://api.netdeck.gg/api/cards/cyberpunk/${slug}/image`
const OUT = 'public/cards'
const RAW = 'vendor/cards/raw'
const debug = process.argv.includes('--debug')
const noImages = process.argv.includes('--no-images')
const pagesOnly = process.argv.includes('--pages')
const UA = 'Afterlife-fan-client (personal card cache)'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function get(url: string): Promise<Response> {
	for (let attempt = 1; ; attempt++) {
		const res = await fetch(url, { headers: { 'User-Agent': UA } })
		if (res.ok) return res
		if (attempt >= 3 || res.status === 404) throw new Error(`${res.status} ${url}`)
		await sleep(1000 * attempt)
	}
}

const decode = (s: string) =>
	s
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&#x27;|&#39;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&nbsp;/g, ' ')
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))

const meta = (html: string, prop: string) =>
	decode(html.match(new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]+content="([^"]*)"`, 'i'))?.[1] ?? '')

async function listSlugs(): Promise<string[]> {
	const slugs = new Set<string>()
	for (let page = 1; page <= 30; page++) {
		const html = await (await get(`${SITE}/cards?page=${page}`)).text()
		const before = slugs.size
		for (const m of html.matchAll(/href="\/cards\/([a-z0-9][a-z0-9-]*)(?:[?"])/g)) slugs.add(m[1])
		console.log(`  page ${page}: ${slugs.size - before} new cards`)
		if (slugs.size === before) break
		await sleep(300)
	}
	return [...slugs]
}

/** Find any embedded JSON object that looks like this card (Next.js payloads, JSON-LD...). */
function embeddedCard(html: string, slug: string): Record<string, unknown> | null {
	const blobs: string[] = []
	for (const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) blobs.push(m[1])
	for (const raw of blobs) {
		// Next.js app-router chunks are JS strings: self.__next_f.push([1,"..."])
		const texts = [...raw.matchAll(/self\.__next_f\.push\(\[\d+,\s*"((?:[^"\\]|\\.)*)"\]\)/g)].map((m) => {
			try {
				return JSON.parse(`"${m[1]}"`) as string
			} catch {
				return ''
			}
		})
		texts.push(raw)
		for (const t of texts) {
			let i = t.indexOf(`"${slug}"`)
			while (i >= 0) {
				// walk outwards to the enclosing {...}
				for (let start = t.lastIndexOf('{', i); start >= 0 && i - start < 4000; start = t.lastIndexOf('{', start - 1)) {
					let depth = 0
					for (let j = start; j < t.length && j - start < 20000; j++) {
						if (t[j] === '{') depth++
						else if (t[j] === '}' && --depth === 0) {
							try {
								const obj = JSON.parse(t.slice(start, j + 1))
								if (obj && typeof obj === 'object' && ('cost' in obj || 'type' in obj || 'card_type' in obj)) return obj
							} catch {
								/* keep looking */
							}
							break
						}
					}
				}
				i = t.indexOf(`"${slug}"`, i + 1)
			}
		}
	}
	return null
}

const COLOR_WORDS: Color[] = ['red', 'green', 'blue', 'yellow']
const TYPES = ['legend', 'unit', 'gear', 'program'] as const

function keywordsFrom(text: string): Keyword[] {
	const k: Keyword[] = []
	if (/\bquick\b/i.test(text)) k.push('quick')
	if (/\bblocker\b/i.test(text)) k.push('blocker')
	if (/\badrenaline\b/i.test(text)) k.push('adrenaline')
	if (/\bgo[\s_-]*solo\b/i.test(text)) k.push('goSolo')
	return k
}

function num(v: unknown): number | null {
	if (v === null || v === undefined || v === '' || v === '—') return null
	const n = Number(v)
	return Number.isFinite(n) ? n : null
}

function parseCardPage(slug: string, html: string): { card: CardDef; missing: string[] } {
	const missing: string[] = []
	const j = embeddedCard(html, slug) ?? {}
	const pick = (...keys: string[]) => {
		for (const k of keys) if (k in j && j[k] !== null && j[k] !== undefined) return j[k]
		return undefined
	}
	const title = meta(html, 'og:title') || decode(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? slug)
	const desc = meta(html, 'description') || meta(html, 'og:description')
	const bodyText = decode(html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ')

	const fullName = String(pick('name', 'title') ?? title.split('|')[0]).trim()
	const [name, subtitle] = fullName.split(/\s+[—–-]\s+|:\s+/, 2)
	const typeStr = String(pick('type', 'card_type', 'cardType') ?? '').toLowerCase() || (TYPES.find((t) => new RegExp(`\\b${t}\\b`, 'i').test(desc)) ?? TYPES.find((t) => new RegExp(`\\b${t.toUpperCase()}\\b`).test(bodyText)) ?? '')
	const type = TYPES.find((t) => typeStr.includes(t))
	if (!type) missing.push('type')
	const colorStr = String(pick('color', 'colour', 'colors') ?? '').toLowerCase() || desc.toLowerCase()
	const color = COLOR_WORDS.find((c) => colorStr.includes(c)) ?? null
	if (!color) missing.push('color')
	const field = (label: string) => num(bodyText.match(new RegExp(`\\b${label}\\b\\s*:?\\s*(\\d+)`, 'i'))?.[1])
	const cost = num(pick('cost', 'eddies', 'eddie_cost')) ?? field('Cost')
	const power = num(pick('power')) ?? field('Power')
	const ram = num(pick('ram', 'ram_value', 'ramValue')) ?? field('RAM') ?? 0
	const text = String(pick('text', 'rules_text', 'rulesText', 'ability', 'effect') ?? (desc.match(/[“"](.+)[”"]/)?.[1] ?? '')).trim()
	if (!text && type !== 'unit') missing.push('text')
	const sellRaw = pick('sell', 'sell_tag', 'sellTag', 'has_sell_tag', 'sellable')
	const sell = sellRaw !== undefined ? Boolean(sellRaw) : /\bsell\b/i.test(JSON.stringify(j)) || type !== 'legend'
	if (sellRaw === undefined) missing.push('sell (guessed)')
	const tagsRaw = pick('tags', 'subtypes', 'traits')
	const tags = Array.isArray(tagsRaw) ? tagsRaw.map((t) => String(typeof t === 'object' && t ? ((t as { name?: string }).name ?? '') : t)) : []
	return {
		card: {
			id: slug,
			name: name.trim(),
			subtitle: subtitle?.trim() || undefined,
			type: type ?? 'unit',
			color,
			cost: type === 'legend' && cost === null ? null : (cost ?? 0),
			power,
			ram,
			sell,
			keywords: keywordsFrom(`${text} ${JSON.stringify(pick('keywords') ?? '')}`),
			text,
			tags,
		},
		missing,
	}
}

async function main() {
	await mkdir(join(OUT, 'img'), { recursive: true })
	if (debug) await mkdir(RAW, { recursive: true })
	const cards: Record<string, CardDef> = {}
	const report: string[] = []

	// 1) The Netdeck.gg API behind the card database / Deck Builder: everything in one go.
	if (!pagesOnly) {
		console.log('Looking for the card database API …')
		const api = await fetchCardList(console.log)
		if (api) {
			await mkdir('vendor/cards', { recursive: true })
			await writeFile('vendor/cards/api-raw.json', JSON.stringify(api, null, '\t'))
			for (const raw of api.raw) {
				const c = mapCard(raw)
				cards[c.id] = c
				const gaps = [!c.color && c.type !== 'legend' && 'color', c.type === 'unit' && c.power === null && 'power'].filter(Boolean)
				if (gaps.length) report.push(`${c.id}: ${gaps.join(', ')}`)
			}
			console.log(`Got ${Object.keys(cards).length} cards from ${api.endpoint} (raw copy in vendor/cards/api-raw.json)`)
		} else console.log('  no API endpoint answered — reading the card pages instead')
	}

	// 2) Fallback: read every public card page.
	if (Object.keys(cards).length === 0) {
		console.log('Reading the card list from cyberpunktcg.com …')
		const slugs = await listSlugs()
		if (slugs.length === 0) throw new Error('No cards found — the site layout may have changed (try --debug).')
		let n = 0
		const queue = [...slugs]
		await Promise.all(
			Array.from({ length: 4 }, async () => {
				for (let slug = queue.shift(); slug; slug = queue.shift()) {
					try {
						const html = await (await get(`${SITE}/cards/${slug}`)).text()
						if (debug) await writeFile(join(RAW, `${slug}.html`), html)
						const { card, missing } = parseCardPage(slug, html)
						cards[slug] = card
						if (missing.length) report.push(`${slug}: ${missing.join(', ')}`)
					} catch (e) {
						report.push(`${slug}: FAILED ${(e as Error).message}`)
					}
					if (++n % 10 === 0) console.log(`  ${n}/${slugs.length}`)
					await sleep(150)
				}
			}),
		)
	}

	// 3) Card renders.
	if (!noImages) {
		console.log('Downloading card images …')
		let n = 0
		const queue = Object.values(cards)
		await Promise.all(
			Array.from({ length: 4 }, async () => {
				for (let card = queue.shift(); card; card = queue.shift()) {
					try {
						const existing = ['webp', 'png', 'jpg'].map((e) => join(OUT, 'img', `${card.id}.${e}`)).find(existsSync)
						if (existing) card.image = existing.replace(/^public\//, '')
						else {
							const res = await get(IMAGE(card.id))
							const type = res.headers.get('content-type') ?? ''
							const ext = /png/.test(type) ? 'png' : /jpe?g/.test(type) ? 'jpg' : 'webp'
							await writeFile(join(OUT, 'img', `${card.id}.${ext}`), Buffer.from(await res.arrayBuffer()))
							card.image = `cards/img/${card.id}.${ext}`
							await sleep(100)
						}
					} catch (e) {
						report.push(`${card.id}: no image (${(e as Error).message})`)
					}
					if (++n % 25 === 0) console.log(`  ${n}/${Object.keys(cards).length}`)
				}
			}),
		)
	}

	await writeFile(join(OUT, 'cards.json'), JSON.stringify(cards, null, '\t'))
	await writeFile(join(OUT, 'report.txt'), report.join('\n'))
	const byType = Object.values(cards).reduce<Record<string, number>>((a, c) => ((a[c.type] = (a[c.type] ?? 0) + 1), a), {})
	console.log(`Saved ${Object.keys(cards).length} cards to ${OUT}/cards.json`, byType)
	if (report.length) console.log(`${report.length} cards have gaps — see ${OUT}/report.txt`)
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
