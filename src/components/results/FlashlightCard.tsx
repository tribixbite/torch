import { useState, useMemo, useCallback, memo } from 'react';
import type { ColumnDef, FlashlightDB } from '$lib/schema/columns';
import { smartFixed } from '$lib/schema/si-prefix';
import { useUrlState } from '$lib/state/url-state';
import { useStarred } from '$lib/state/starred';
import SpriteImage from './SpriteImage';

interface Props {
	index: number;
	db: FlashlightDB;
	columns: ColumnDef[];
}

/** Columns excluded from detail display (shown in header or special sections) */
const avoidIds = new Set(['model', 'brand', 'info', 'purchase', 'price']);

/** Validate URL uses a safe protocol */
function isSafeUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:';
	} catch {
		return false;
	}
}

function extractDomain(url: string): string {
	try {
		const parsed = new URL(url);
		return parsed.hostname.replace(/^www\./, '');
	} catch {
		return '';
	}
}

export default memo(function FlashlightCard({ index, db, columns }: Props) {
	// Granular selector: stable string of active filter column indices
	// Only re-renders when the set of active filter columns changes (not on value changes)
	const activeFilterKeys = useUrlState((s) => [...s.filters.keys()].join(','));
	const activeFilterSet = useMemo(() => new Set(activeFilterKeys ? activeFilterKeys.split(',').map(Number) : []), [activeFilterKeys]);
	const toggle = useStarred((s) => s.toggle);
	const isStarred = useStarred((s) => s.starred.has(index));
	const [expanded, setExpanded] = useState(false);

	const data = db.data[index];

	// Column indices — computed once from the db header
	const colIndices = useMemo(() => ({
		model: db.head.indexOf('model'),
		brand: db.head.indexOf('brand'),
		pic: db.head.indexOf('_pic'),
		info: db.head.indexOf('info'),
		price: db.head.indexOf('price'),
		purchase: db.head.indexOf('purchase'),
		reviews: db.head.indexOf('_reviews'),
	}), [db.head]);

	const model = colIndices.model >= 0 ? String(data[colIndices.model] ?? '') : '';
	const brand = colIndices.brand >= 0 ? String(data[colIndices.brand] ?? '') : '';

	// _pic can be [col, row] sprite coords OR a direct image URL string
	const picRaw = colIndices.pic >= 0 ? data[colIndices.pic] : null;
	const picIsSprite = picRaw != null && typeof picRaw === 'object' && Array.isArray(picRaw) && picRaw.length === 2;
	const picCoords: [number, number] = picIsSprite ? [Number((picRaw as number[])[0]), Number((picRaw as number[])[1])] : [0, 0];
	const picUrl = !picIsSprite && typeof picRaw === 'string' && picRaw ? picRaw : '';

	/** Should this column's detail row be visible? */
	const shouldShowDetail = useCallback((col: ColumnDef): boolean => {
		if (col.cvis === 'never') return false;
		if (avoidIds.has(col.id)) return false;
		if (col.cvis === 'always') return true;
		if (expanded) return true;
		if (activeFilterSet.has(col.index)) return true;
		const linkCol = columns.find((c) => c.id === col.link);
		if (linkCol && activeFilterSet.has(linkCol.index)) return true;
		return false;
	}, [expanded, activeFilterSet, columns]);

	/** Format a data value for display */
	const formatValue = useCallback((col: ColumnDef, value: unknown): string => {
		if (value === '' || value === null || value === undefined) return '?';
		if (Array.isArray(value)) {
			if (value.length === 0) return '?';
			if (col.filterType === 'boolean') {
				const filtered = value.filter((x) => typeof x !== 'string' || (!x.startsWith('~') && !x.startsWith('//')));
				return filtered.length > 0 ? filtered.join('  ') : 'none';
			}
			const filtered = value.filter((x) => typeof x !== 'string' || !x.startsWith('//'));
			return filtered.length > 0 ? filtered.join('  ') : '?';
		}
		return String(value);
	}, []);

	/** Format with unit template (may produce HTML for links) */
	const formatWithUnit = useCallback((col: ColumnDef, value: unknown): string => {
		const display = formatValue(col, value);
		if (display === '?') return '?';

		if (col.unit === '{link}') {
			if (Array.isArray(value)) {
				return (value as string[])
					.filter((u) => u && isSafeUrl(u))
					.map((u) => {
						const domain = extractDomain(u);
						return `<a href="${u}" target="_blank" rel="noopener" class="underline" style="color: var(--accent);">${domain}</a>`;
					})
					.join(', ');
			}
			const url = String(value);
			if (!isSafeUrl(url)) return extractDomain(url) || '?';
			const domain = extractDomain(url);
			return `<a href="${url}" target="_blank" rel="noopener" class="underline" style="color: var(--accent);">${domain}</a>`;
		}

		// Handle {si} prefix units — apply SI notation to each numeric value
		if (col.unit.startsWith('{si}')) {
			const suffix = col.unit.slice(4); // e.g. 'lm', 'h', 'cd', 'Wh'
			if (Array.isArray(value)) {
				return (value as (string | number)[])
					.filter((x) => typeof x !== 'string' || !x.startsWith('//'))
					.map((x) => typeof x === 'number' ? smartFixed(x, '{si}') + suffix : String(x))
					.join('  ');
			}
			if (typeof value === 'number') return smartFixed(value, '{si}') + suffix;
			return display + suffix;
		}

		// Normal unit template: "{} m", "${}", etc.
		if (col.unit.includes('{}')) return col.unit.replace('{}', display);

		// No unit or unrecognized template — return raw display value
		return display;
	}, [formatValue]);

	const price = useMemo(() => {
		if (colIndices.price < 0) return '';
		const amount = data[colIndices.price];
		if (!amount && amount !== 0) return '';
		const num = Number(amount);
		const formatted = num % 1 !== 0 ? num.toFixed(2) : String(num);
		return columns[colIndices.price].unit.replace('{}', formatted);
	}, [data, colIndices.price, columns]);

	const purchaseLinks = useMemo(() => {
		if (colIndices.purchase < 0 || !data[colIndices.purchase]) return '';
		const urls = Array.isArray(data[colIndices.purchase]) ? data[colIndices.purchase] as string[] : [String(data[colIndices.purchase])];
		return urls
			.filter((u) => u && isSafeUrl(u))
			.map((u) => `<a href="${u}" target="_blank" rel="noopener" class="underline" style="color: var(--accent);">${extractDomain(u)}</a>`)
			.join(', ');
	}, [data, colIndices.purchase]);

	const infoLinks = useMemo(() => {
		if (colIndices.info < 0 || !data[colIndices.info]) return '';
		const urls = Array.isArray(data[colIndices.info]) ? data[colIndices.info] as string[] : [String(data[colIndices.info])];
		return urls
			.filter((u) => u && isSafeUrl(u))
			.map((u) => `<a href="${u}" target="_blank" rel="noopener" class="underline text-xs" style="color: var(--accent);">${extractDomain(u)}</a>`)
			.join(', ');
	}, [data, colIndices.info]);

	const reviewCount = colIndices.reviews >= 0 && data[colIndices.reviews] ? Number(data[colIndices.reviews]) : 0;

	return (
		<div className="result-item-wrap">
			<div className="card-row">
				{/* Sprite thumbnail */}
				<div className="card-thumb">
					<SpriteImage col={picCoords[0]} row={picCoords[1]} spriteUrl={db.sprite} imageUrl={picUrl} />
				</div>

				{/* Content */}
				<div className="card-body">
					{/* Header row */}
					<div className="card-header">
						<button className="card-expand" onClick={() => setExpanded(!expanded)} title="Toggle details">±</button>
						<span className="card-model">{model}</span>
						<span className="card-brand">by {brand}</span>
						{infoLinks && (
							<span className="card-info" dangerouslySetInnerHTML={{ __html: `(${infoLinks})` }} />
						)}
						<span className="card-spacer" />
						<button
							className={`card-star ${isStarred ? 'starred' : ''}`}
							onClick={() => toggle(index)}
							title={isStarred ? 'Remove from favorites' : 'Add to favorites'}
						>
							{isStarred ? '★' : '☆'}
						</button>
						{price && <span className="card-price">{price}</span>}
					</div>

					{/* Detail rows */}
					<div className="card-details">
						{columns.map((col) =>
							shouldShowDetail(col) ? (
								<span key={col.index} className="card-detail">
									<span className="detail-label" dangerouslySetInnerHTML={{ __html: col.display + ':' }} />
									<span dangerouslySetInnerHTML={{ __html: formatWithUnit(col, data[col.index]) }} />
								</span>
							) : null
						)}
					</div>

					{/* Purchase links */}
					{(purchaseLinks || reviewCount > 0) && (
						<div className="card-purchase">
							{purchaseLinks && <span dangerouslySetInnerHTML={{ __html: purchaseLinks }} />}
							{reviewCount > 0 && (
								<span className="card-reviews">({reviewCount} review{reviewCount > 1 ? 's' : ''})</span>
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
});
