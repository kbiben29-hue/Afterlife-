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
