// Offline checks for the API mapper with made-up response shapes (the real API is undocumented).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cardArray, fetchCardList, mapCard } from './netdeck'

test('finds the card list in common response shapes', () => {
	const c = { name: 'Test Unit', slug: 'test-unit', type: 'UNIT' }
	assert.equal(cardArray([c]).length, 1)
	assert.equal(cardArray({ data: [c] }).length, 1)
	assert.equal(cardArray({ data: { cards: [c] } }).length, 1)
	assert.equal(cardArray({ nope: 1 }).length, 0)
})

test('maps flat and nested card fields', () => {
	const a = mapCard({ slug: 'floor-it', name: 'Floor It', type: 'PROGRAM', color: 'Blue', cost: 1, ram: 1, text: '{Quick} Give a rival Unit -1 power this turn. Draw 1.', sell_tag: true, tags: [{ name: 'Quickhack' }] })
	assert.deepEqual([a.id, a.type, a.color, a.cost, a.ram, a.sell, a.keywords, a.tags], ['floor-it', 'program', 'blue', 1, 1, true, ['quick'], ['Quickhack']])
	const b = mapCard({ name: 'Somebody — Some Title', card_type: { name: 'Legend' }, attributes: { colour: { name: 'Yellow' }, ram: '2', cost: null } })
	assert.deepEqual([b.id, b.name, b.subtitle, b.type, b.color, b.ram, b.cost], ['somebody-some-title', 'Somebody', 'Some Title', 'legend', 'yellow', 2, null])
})

test('follows pagination on the first endpoint that answers', async () => {
	const real = globalThis.fetch
	const pages: Record<string, unknown> = {
		'https://api.netdeck.gg/api/cyberpunk/cards': { data: [{ id: 1, name: 'A', type: 'unit' }], meta: { total: 2 } },
		'https://api.netdeck.gg/api/cyberpunk/cards?page=2': { data: [{ id: 2, name: 'B', type: 'unit' }] },
	}
	globalThis.fetch = (async (url: string) => {
		const body = pages[String(url)]
		return new Response(body ? JSON.stringify(body) : '<html></html>', { status: body ? 200 : 404, headers: { 'content-type': body ? 'application/json' : 'text/html' } })
	}) as typeof fetch
	try {
		const r = await fetchCardList(() => {})
		assert.equal(r?.raw.length, 2)
	} finally {
		globalThis.fetch = real
	}
})

test('maps a real Netdeck card (V — Streetkid, Nov 2026 shape)', () => {
	const v = mapCard({
		id: '81a8dec7', name: 'V', subname: 'Streetkid', slug: 'v-streetkid',
		rules_text: '{Call} Trash 3. Then, add 1 BRAINDANCE Program from your trash to your hand.\n{Go Solo} (Pay this Legend\'s cost to play it as a ready Unit.)',
		set: { code: 'welcometonightcityretail', name: 'Welcome to Night City — Retail' },
		color: 'Red', card_type: 'Legend', is_eddiable: true, classifications: ['Merc'], keywords: [], cost: 5, power: 6, ram: 2,
	})
	assert.deepEqual(
		[v.id, v.name, v.subtitle, v.type, v.color, v.cost, v.power, v.ram, v.sell, v.keywords, v.tags],
		['v-streetkid', 'V', 'Streetkid', 'legend', 'red', 5, 6, 2, true, ['goSolo'], ['Merc']],
	)
	const g = mapCard({ name: 'Shield', slug: 'shield', card_type: 'Gear', color: 'Green', cost: 2, ram: 1, rules_text: 'The equipped Unit gains {Blocker}.' })
	assert.deepEqual(g.keywords, [])
})

test('pages through offset/limit responses', async () => {
	const real = globalThis.fetch
	const all = Array.from({ length: 152 }, (_, i) => ({ id: `c${i}`, name: `Card ${i}`, card_type: 'Unit' }))
	globalThis.fetch = (async (u: string) => {
		const url = new URL(String(u))
		if (url.pathname !== '/api/cyberpunk/cards') return new Response('', { status: 404 })
		const offset = Number(url.searchParams.get('offset') ?? 0)
		const limit = Number(url.searchParams.get('limit') ?? 60)
		return new Response(JSON.stringify({ items: all.slice(offset, offset + limit), total: 152, limit, offset }), { headers: { 'content-type': 'application/json' } })
	}) as typeof fetch
	try {
		const r = await fetchCardList(() => {})
		assert.equal(r?.raw.length, 152)
	} finally {
		globalThis.fetch = real
	}
})
