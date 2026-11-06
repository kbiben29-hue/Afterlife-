// Connections between two players' browsers.
//
// Real games use WebRTC through PeerJS (a free public broker only introduces the two browsers; the
// game data then goes directly between them). PeerJS is loaded from a CDN on demand, so it adds
// nothing to the app unless online play is used.
// For testing, `?net=local` swaps in a BroadcastChannel between tabs of the same browser.

export interface Conn {
	send(msg: unknown): void
	onMessage(cb: (msg: unknown) => void): void
	onClose(cb: () => void): void
	close(): void
}

export interface Host {
	id: string
	onConnection(cb: (c: Conn) => void): void
	onError(cb: (e: string) => void): void
	destroy(): void
}

const PEERJS_URL = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js'
const ID_PREFIX = 'afterlife-'

const useLocal = () => typeof location !== 'undefined' && new URLSearchParams(location.search).get('net') === 'local'

// ───────── PeerJS ─────────

type PeerJsConn = {
	open: boolean
	send(d: unknown): void
	on(ev: 'open' | 'close' | 'error', cb: (e?: unknown) => void): void
	on(ev: 'data', cb: (d: unknown) => void): void
	close(): void
}
type PeerJsPeer = {
	id: string
	on(ev: 'open', cb: (id: string) => void): void
	on(ev: 'connection', cb: (c: PeerJsConn) => void): void
	on(ev: 'error', cb: (e: { type?: string; message?: string }) => void): void
	on(ev: 'disconnected', cb: () => void): void
	connect(id: string, opts?: Record<string, unknown>): PeerJsConn
	reconnect(): void
	destroy(): void
}
type PeerCtor = new (id?: string, opts?: Record<string, unknown>) => PeerJsPeer

let peerLib: Promise<PeerCtor> | null = null
function loadPeerJs(): Promise<PeerCtor> {
	const w = window as unknown as { Peer?: PeerCtor }
	if (w.Peer) return Promise.resolve(w.Peer)
	peerLib ??= new Promise((resolve, reject) => {
		const s = document.createElement('script')
		s.src = PEERJS_URL
		s.async = true
		s.onload = () => (w.Peer ? resolve(w.Peer) : reject(new Error('PeerJS did not load')))
		s.onerror = () => {
			peerLib = null
			reject(new Error('Could not load the online-play library (check your internet connection)'))
		}
		document.head.appendChild(s)
	})
	return peerLib
}

function wrapPeerConn(c: PeerJsConn): Conn {
	const msgs: ((m: unknown) => void)[] = []
	const closes: (() => void)[] = []
	c.on('data', (d) => msgs.forEach((f) => f(d)))
	c.on('close', () => closes.forEach((f) => f()))
	c.on('error', () => closes.forEach((f) => f()))
	return {
		send: (m) => {
			if (c.open) c.send(m)
		},
		onMessage: (f) => msgs.push(f),
		onClose: (f) => closes.push(f),
		close: () => c.close(),
	}
}

const errText = (e: { type?: string; message?: string }) =>
	e.type === 'peer-unavailable'
		? 'Your friend’s game isn’t open right now. Ask them to open Afterlife and resume the online game.'
		: e.type === 'unavailable-id'
			? 'This game code is already open in another tab or window.'
			: e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error'
				? 'Can’t reach the connection service. Check your internet connection and try again.'
				: (e.message ?? 'Connection problem')

// ───────── local test transport (BroadcastChannel) ─────────

function localHost(id: string): Host {
	const ch = new BroadcastChannel(`afterlife-${id}`)
	const conns: ((c: Conn) => void)[] = []
	ch.onmessage = (e) => {
		const { kind, from } = e.data as { kind: string; from: string }
		if (kind !== 'connect') return
		const pc = new BroadcastChannel(`afterlife-${id}-${from}`)
		const msgs: ((m: unknown) => void)[] = []
		pc.onmessage = (ev) => {
			const d = ev.data as { side: string; m: unknown }
			if (d.side === 'guest') msgs.forEach((f) => f(d.m))
		}
		const conn: Conn = {
			send: (m) => pc.postMessage({ side: 'host', m }),
			onMessage: (f) => msgs.push(f),
			onClose: () => {},
			close: () => pc.close(),
		}
		conns.forEach((f) => f(conn))
		pc.postMessage({ side: 'host', m: { type: '__accepted' } })
	}
	return { id, onConnection: (f) => conns.push(f), onError: () => {}, destroy: () => ch.close() }
}

function localJoin(id: string): Promise<Conn> {
	return new Promise((resolve) => {
		const from = Math.random().toString(36).slice(2)
		const pc = new BroadcastChannel(`afterlife-${id}-${from}`)
		const msgs: ((m: unknown) => void)[] = []
		let accepted = false
		pc.onmessage = (ev) => {
			const d = ev.data as { side: string; m: { type?: string } }
			if (d.side !== 'host') return
			if (d.m?.type === '__accepted') {
				if (!accepted) {
					accepted = true
					resolve(conn)
				}
				return
			}
			msgs.forEach((f) => f(d.m))
		}
		const conn: Conn = {
			send: (m) => pc.postMessage({ side: 'guest', m }),
			onMessage: (f) => msgs.push(f),
			onClose: () => {},
			close: () => pc.close(),
		}
		new BroadcastChannel(`afterlife-${id}`).postMessage({ kind: 'connect', from })
	})
}

// ───────── public API ─────────

export function newGameCode(): string {
	const a = 'abcdefghjkmnpqrstuvwxyz23456789'
	let s = ''
	for (let i = 0; i < 8; i++) s += a[Math.floor(Math.random() * a.length)]
	return s
}

/** Open a game for a friend to join. `code` is stable for the whole game, so the link keeps working after a refresh. */
export async function hostGame(code: string): Promise<Host> {
	if (useLocal()) return localHost(code)
	const Peer = await loadPeerJs()
	return new Promise((resolve, reject) => {
		const peer = new Peer(ID_PREFIX + code, { debug: 0 })
		const conns: ((c: Conn) => void)[] = []
		const errs: ((e: string) => void)[] = []
		let opened = false
		peer.on('open', () => {
			opened = true
			resolve({
				id: code,
				onConnection: (f) => conns.push(f),
				onError: (f) => errs.push(f),
				destroy: () => peer.destroy(),
			})
		})
		peer.on('connection', (c) => {
			c.on('open', () => {
				const w = wrapPeerConn(c)
				conns.forEach((f) => f(w))
			})
		})
		peer.on('disconnected', () => peer.reconnect())
		peer.on('error', (e) => {
			if (!opened) reject(new Error(errText(e)))
			else errs.forEach((f) => f(errText(e)))
		})
	})
}

/** Connect to a friend's game. */
export async function joinGame(code: string): Promise<Conn> {
	if (useLocal()) return localJoin(code)
	const Peer = await loadPeerJs()
	return new Promise((resolve, reject) => {
		const peer = new Peer(undefined, { debug: 0 })
		const timer = window.setTimeout(() => reject(new Error('Couldn’t connect. Your friend’s game may be closed, or a network blocks direct connections.')), 20000)
		peer.on('open', () => {
			const c = peer.connect(ID_PREFIX + code, { reliable: true })
			c.on('open', () => {
				window.clearTimeout(timer)
				resolve(wrapPeerConn(c))
			})
		})
		peer.on('error', (e) => {
			window.clearTimeout(timer)
			reject(new Error(errText(e)))
		})
	})
}
