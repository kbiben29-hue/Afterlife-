// Polyhedral dice drawn as SVG in their real silhouettes (d4 triangle … d20 icosahedron),
// with facet lines for a 3D look. `rolling` tumbles the die and flickers random faces.

import { useEffect, useState } from 'react'
import type { DieSides } from '../engine/types'

export type DieTone = 'cyan' | 'pink' | 'ghost'

const TONES: Record<DieTone, { a: string; b: string; edge: string; ink: string }> = {
	cyan: { a: '#2ef2ff', b: '#0a5d70', edge: '#b8fbff', ink: '#021014' },
	pink: { a: '#ff5c8f', b: '#6e0a2c', edge: '#ffc2d5', ink: '#1a0209' },
	ghost: { a: '#3a3a26', b: '#17170e', edge: '#6b6210', ink: '#e8e08a' },
}

// outline + facet lines in a 100×100 box, and where the number sits
const SHAPES: Record<DieSides, { outline: string; facets: string[]; ty: number; fs: number }> = {
	4: { outline: '50,6 95,88 5,88', facets: ['50,6 50,62', '50,62 95,88', '50,62 5,88'], ty: 76, fs: 26 },
	6: { outline: '12,12 88,12 88,88 12,88', facets: ['12,12 22,22', '88,12 78,22', '88,88 78,78', '12,88 22,78', '22,22 78,22 78,78 22,78 22,22'], ty: 61, fs: 38 },
	8: { outline: '50,4 94,50 50,96 6,50', facets: ['6,50 94,50', '50,4 30,50 50,96', '50,4 70,50 50,96'], ty: 60, fs: 30 },
	10: { outline: '50,4 95,44 50,96 5,44', facets: ['5,44 30,56 50,96', '95,44 70,56 50,96', '30,56 50,4 70,56', '30,56 70,56'], ty: 50, fs: 26 },
	12: { outline: '50,4 95,37 78,92 22,92 5,37', facets: ['50,22 72,40 64,68 36,68 28,40 50,22', '50,4 50,22', '95,37 72,40', '78,92 64,68', '22,92 36,68', '5,37 28,40'], ty: 56, fs: 26 },
	20: { outline: '50,3 92,27 92,73 50,97 8,73 8,27', facets: ['50,22 76,66 24,66 50,22', '50,3 50,22', '92,27 50,22', '8,27 50,22', '92,73 76,66', '8,73 24,66', '50,97 76,66', '50,97 24,66', '92,27 76,66', '8,27 24,66'], ty: 57, fs: 22 },
}

export function PolyDie({
	sides,
	value,
	tone,
	rolling = false,
	size = 48,
	label,
}: {
	sides: DieSides
	value: number
	tone: DieTone
	rolling?: boolean
	size?: number
	/** shown instead of the value (e.g. "d12" in the Fixer) */
	label?: string
}) {
	const [face, setFace] = useState(value)
	useEffect(() => {
		if (!rolling) {
			setFace(value)
			return
		}
		const t = setInterval(() => setFace(1 + Math.floor(Math.random() * sides)), 70)
		return () => clearInterval(t)
	}, [rolling, value, sides])
	const sh = SHAPES[sides]
	const c = TONES[tone]
	const gid = `g${sides}${tone}`
	const text = label ?? String(face)
	return (
		<svg className={`poly-die ${rolling ? 'rolling' : ''}`} width={size} height={size} viewBox="0 0 100 100" aria-label={`d${sides}${label ? '' : ` showing ${value}`}`}>
			<defs>
				<linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
					<stop offset="0" stopColor={c.a} />
					<stop offset="1" stopColor={c.b} />
				</linearGradient>
			</defs>
			<polygon points={sh.outline} fill={`url(#${gid})`} stroke={c.edge} strokeWidth="3" strokeLinejoin="round" />
			{sh.facets.map((f, i) => (
				<polyline key={i} points={f} fill="none" stroke={c.edge} strokeOpacity="0.45" strokeWidth="2" strokeLinejoin="round" />
			))}
			<text
				x="50"
				y={sh.ty}
				textAnchor="middle"
				fontSize={label ? sh.fs * 0.72 : text.length > 1 ? sh.fs * 0.86 : sh.fs}
				fontWeight="800"
				fill={tone === 'ghost' ? c.ink : '#ffffff'}
				stroke={tone === 'ghost' ? 'none' : c.ink}
				strokeWidth={tone === 'ghost' ? 0 : 5}
				paintOrder="stroke"
				fontFamily="'Bahnschrift','DIN Condensed','Arial Narrow',sans-serif"
			>
				{text}
			</text>
		</svg>
	)
}
