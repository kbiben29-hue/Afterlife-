// Loads the card pool, in order of preference:
//  1. public/cards/cards.json — downloaded onto this computer by `npm run fetch-cards` (launcher / dev).
//  2. Live from the official card database (Netdeck.gg API) — used by the play site and the desktop
//     apps. Card data is fetched by each player's own browser/app and cached on that device; card
//     pictures load straight from the official site. Nothing from the card database is stored in
//     this repo or on the play site.
//  3. The generic placeholder pool.

import type { CardDef } from '../engine/types'
import { CARD_LIST_URL, cardArray, cardImageUrl, mapCard, pageInfo, type Json } from './netdeckMap'
import { PLACEHOLDER_CARDS } from './placeholder'

export interface CardPool {
	cards: Record<string, CardDef>
	source: 'database' | 'online' | 'placeholder'
	note?: string
}

const CACHE = 'afterlife.cards.v1'
const MAX_AGE = 3 * 24 * 3600 * 1000

type TauriWindow = { __TAURI__?: { core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } } }

/** In the desktop app the request goes through the app itself (no browser CORS limits). */
async function getJson(url: string): Promise<unknown> {
	const tauri = (window as unknown as TauriWindow).__TAURI__
	if (tauri) return JSON.parse(String(await tauri.core.invoke('cards_fetch_text', { url })))
	const res = await fetch(url, { headers: { Accept: 'application/json' } })
	if (!res.ok) throw new Error(`${res.status}`)
	return res.json()
}

async function fetchLive(): Promise<Record<string, CardDef>> {
	const first = await getJson(CARD_LIST_URL)
	const raw: Json[] = cardArray(first)
	const { total, limit } = pageInfo(first)
	const key = (c: Json) => String(c.id ?? c.slug ?? c.name)
	while (raw.length > 0 && total !== undefined && raw.length < total) {
		const more = cardArray(await getJson(`${CARD_LIST_URL}?offset=${raw.length}&limit=${limit ?? 60}`)).filter(
			(c) => !raw.some((r) => key(r) === key(c)),
		)
		if (more.length === 0) break
		raw.push(...more)
	}
	const cards: Record<string, CardDef> = {}
	for (const r of raw) {
		const c = mapCard(r)
		c.image = cardImageUrl(c.id)
		cards[c.id] = c
	}
	return cards
}

function readCache(): { at: number; cards: Record<string, CardDef> } | null {
	try {
		const raw = localStorage.getItem(CACHE)
		return raw ? JSON.parse(raw) : null
	} catch {
		return null
	}
}

export async function loadCards(): Promise<CardPool> {
	// 1. local download
	try {
		const res = await fetch(`${import.meta.env.BASE_URL}cards/cards.json`, { cache: 'no-cache' })
		if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) {
			const cards = (await res.json()) as Record<string, CardDef>
			if (Object.keys(cards).length > 0) return { cards, source: 'database' }
		}
	} catch {
		/* not downloaded on this computer */
	}
	// 2. live, with a cache on this device
	const cached = readCache()
	if (cached && Date.now() - cached.at < MAX_AGE) return { cards: cached.cards, source: 'online' }
	try {
		const cards = await fetchLive()
		if (Object.keys(cards).length > 0) {
			try {
				localStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), cards }))
			} catch {
				/* storage full: fine, fetch again next time */
			}
			return { cards, source: 'online' }
		}
	} catch (e) {
		if (cached) return { cards: cached.cards, source: 'online', note: 'offline — using the cards saved on this device' }
		return { cards: PLACEHOLDER_CARDS, source: 'placeholder', note: `couldn't reach the card database (${(e as Error).message || 'blocked'})` }
	}
	return { cards: PLACEHOLDER_CARDS, source: 'placeholder' }
}

/** Absolute URLs (live images) are used as-is; local paths are relative to the site. */
export const imageSrc = (image: string) => (/^https?:/.test(image) ? image : `${import.meta.env.BASE_URL}${image}`)
