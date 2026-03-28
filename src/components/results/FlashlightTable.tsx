import { memo, useMemo } from 'react';
import type { ColumnDef, FlashlightDB } from '$lib/schema/columns';
import { useStarred } from '$lib/state/starred';
import SpriteImage from './SpriteImage';

interface Props {
	index: number;
	db: FlashlightDB;
	columns: ColumnDef[];
}

function formatArray(val: unknown): string {
	if (Array.isArray(val)) return val.filter((x) => typeof x !== 'string' || !x.startsWith('//')).join(', ');
	return val != null && val !== '' ? String(val) : '?';
}

export default memo(function FlashlightTable({ index, db, columns }: Props) {
	const toggle = useStarred((s) => s.toggle);
	const isStarred = useStarred((s) => s.starred.has(index));

	const data = db.data[index];

	const colIndices = useMemo(() => ({
		model: db.head.indexOf('model'),
		brand: db.head.indexOf('brand'),
		pic: db.head.indexOf('_pic'),
		price: db.head.indexOf('price'),
		lumens: db.head.indexOf('lumens'),
		weight: db.head.indexOf('weight'),
		battery: db.head.indexOf('battery'),
	}), [db.head]);

	const pic = colIndices.pic >= 0 ? data[colIndices.pic] as [number, number] : [0, 0] as [number, number];

	return (
		<div
			className="result-item flex items-center gap-2 px-2 py-1 border-b text-xs"
			style={{ borderColor: 'var(--border)' }}
		>
			<SpriteImage col={pic[0]} row={pic[1]} spriteUrl={db.sprite} size={40} />
			<span className="w-[120px] truncate font-medium" style={{ color: 'var(--text-primary)' }}>
				{String(data[colIndices.model] ?? '')}
			</span>
			<span className="w-[100px] truncate" style={{ color: 'var(--text-secondary)' }}>
				{String(data[colIndices.brand] ?? '')}
			</span>
			<span className="w-[80px] truncate" style={{ color: 'var(--text-secondary)' }}>
				{colIndices.lumens >= 0 ? formatArray(data[colIndices.lumens]) : ''}
			</span>
			<span className="w-[80px] truncate" style={{ color: 'var(--text-secondary)' }}>
				{colIndices.weight >= 0 ? (data[colIndices.weight] ? data[colIndices.weight] + 'g' : '?') : ''}
			</span>
			<span className="w-[100px] truncate" style={{ color: 'var(--text-secondary)' }}>
				{colIndices.battery >= 0 ? formatArray(data[colIndices.battery]) : ''}
			</span>
			<span className="w-[60px] text-right" style={{ color: 'var(--text-primary)' }}>
				{colIndices.price >= 0 && data[colIndices.price] ? '$' + data[colIndices.price] : ''}
			</span>
			<button
				className="ml-auto cursor-pointer select-none"
				style={{ color: isStarred ? 'var(--star)' : 'var(--text-muted)' }}
				onClick={() => toggle(index)}
			>
				{isStarred ? '★' : '☆'}
			</button>
		</div>
	);
});
