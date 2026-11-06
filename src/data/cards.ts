// Loads the card pool: the locally fetched database if present, otherwise the placeholder cards.

import type { CardDef } from '../engine/types'
import { PLACEHOLDER_CARDS } from './placeholder'

export interface CardPool {
	cards: Record<string, CardDef>
	source: 'database' | 'placeholder'
}

export async function loadCards(): Promise<CardPool> {
	try {
		const res = await fetch(`${import.meta.env.BASE_URL}cards/cards.json`, { cache: 'no-cache' })
		if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) {
			const cards = (await res.json()) as Record<string, CardDef>
			if (Object.keys(cards).length > 0) return { cards, source: 'database' }
		}
	} catch {
		/* not fetched yet */
	}
	return { cards: PLACEHOLDER_CARDS, source: 'placeholder' }
}
