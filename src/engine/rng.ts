// Deterministic RNG (mulberry32). The seed lives in GameState.rng so every game can be replayed.

export function next(seed: number): [number, number] {
	let t = (seed + 0x6d2b79f5) | 0
	t = Math.imul(t ^ (t >>> 15), t | 1)
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
	const out = ((t ^ (t >>> 14)) >>> 0) / 4294967296
	return [out, (seed + 0x6d2b79f5) | 0]
}

/** Mutable helper over a state's seed. */
export class Rng {
	constructor(public seed: number) {}
	float(): number {
		const [v, s] = next(this.seed)
		this.seed = s
		return v
	}
	int(n: number): number {
		return Math.floor(this.float() * n)
	}
	roll(sides: number): number {
		return this.int(sides) + 1
	}
	shuffle<T>(arr: T[]): T[] {
		const a = arr.slice()
		for (let i = a.length - 1; i > 0; i--) {
			const j = this.int(i + 1)
			;[a[i], a[j]] = [a[j], a[i]]
		}
		return a
	}
}
