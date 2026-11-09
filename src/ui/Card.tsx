import { useState } from 'react'
import type { CardDef } from '../engine/types'
import { imageSrc } from '../data/cards'

const KW: Record<string, string> = { adrenaline: 'ADR', blocker: 'BLK', quick: 'QCK', goSolo: 'SOLO' }
const TYPE_ICON: Record<string, string> = { legend: '★', unit: '◆', gear: '⚙', program: '⌁' }

export function CardFace({ d, big = false }: { d: CardDef; big?: boolean }) {
	// try the main image, then each fallback, then draw the card from its numbers
	const srcs = [d.image, ...(d.images ?? [])].filter((x): x is string => !!x)
	const [tryN, setTryN] = useState(0)
	if (tryN < srcs.length)
		return <img key={srcs[tryN]} className="card-img" src={imageSrc(srcs[tryN])} alt={d.name} draggable={false} loading="lazy" referrerPolicy="no-referrer" onError={() => setTryN(tryN + 1)} />
	return (
		<div className={`card-face c-${d.color ?? 'none'} ${big ? 'big' : ''}`}>
			<div className="cf-top">
				<span className="cf-cost">{d.cost ?? '∅'}</span>
				<span className="cf-type">{TYPE_ICON[d.type]}</span>
				<span className="cf-ram">{d.ram}</span>
			</div>
			<div className="cf-name">{d.name}</div>
			{d.subtitle && <div className="cf-sub">{d.subtitle}</div>}
			<div className="cf-kw">
				{d.keywords.map((k) => (
					<span key={k}>{KW[k]}</span>
				))}
				{d.sell && <span className="sell">€$</span>}
			</div>
			{big && d.text && <div className="cf-text">{d.text}</div>}
			{d.power !== null && <div className="cf-power">{d.type === 'gear' ? `+${d.power}` : d.power}</div>}
		</div>
	)
}

export function CardBack({ label }: { label?: string }) {
	return (
		<div className="card-back">
			<span>{label ?? 'AFTERLIFE'}</span>
		</div>
	)
}
