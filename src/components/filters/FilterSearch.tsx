import { useState, useMemo, useCallback, memo } from 'react';
import type { ColumnDef } from '$lib/schema/columns';

interface Match {
	colIndex: number;
	label: string;
	matchType: 'column' | 'option';
	optionValue?: string;
}

interface Props {
	columns: ColumnDef[];
	onSelect: (colIndex: number) => void;
}

export default memo(function FilterSearch({ columns, onSelect }: Props) {
	const [query, setQuery] = useState('');
	const [open, setOpen] = useState(false);

	const matches = useMemo(() => {
		if (!query || query.length < 1) return [];
		const q = query.toLowerCase();
		const result: Match[] = [];

		for (const col of columns) {
			if (!col.filterType || col.filterType === 'multiple') continue;
			if (!col.searchable) continue;

			const display = col.display.replace(/&nbsp;/g, ' ');
			if (display.toLowerCase().includes(q)) {
				result.push({ colIndex: col.index, label: display, matchType: 'column' });
			}

			if (col.options) {
				for (const opt of col.options) {
					if (opt === '<br>' || opt.startsWith('~')) continue;
					const cleanOpt = opt.replace(/^\/\//, '');
					if (cleanOpt.toLowerCase().includes(q)) {
						result.push({ colIndex: col.index, label: display, matchType: 'option', optionValue: cleanOpt });
					}
				}
			}

			if (result.length >= 20) break;
		}

		return result;
	}, [query, columns]);

	const select = useCallback((match: Match) => {
		onSelect(match.colIndex);
		setQuery('');
		setOpen(false);
	}, [onSelect]);

	const handleKeydown = useCallback((e: React.KeyboardEvent) => {
		if (e.key === 'Escape') {
			setQuery('');
			setOpen(false);
		}
	}, []);

	return (
		<div className="relative">
			<input
				type="text"
				placeholder="Search filters..."
				className="w-full px-3 py-1.5 text-sm rounded-lg border outline-none"
				style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				onFocus={() => setOpen(true)}
				onBlur={() => setTimeout(() => setOpen(false), 200)}
				onKeyDown={handleKeydown}
			/>

			{open && matches.length > 0 && (
				<div
					className="absolute top-full left-0 right-0 mt-1 rounded-lg border shadow-lg max-h-64 overflow-y-auto z-50"
					style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}
				>
					{matches.map((match, i) => (
						<button
							key={`${match.colIndex}-${match.optionValue ?? match.matchType}-${i}`}
							className="w-full text-left px-3 py-1.5 text-sm hover:opacity-80 cursor-pointer flex items-center gap-2"
							style={{ color: 'var(--text-primary)' }}
							onMouseDown={() => select(match)}
						>
							<span className="text-xs px-1 rounded" style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}>
								{match.label}
							</span>
							{match.matchType === 'option' && (
								<span style={{ color: 'var(--text-secondary)' }}>{match.optionValue}</span>
							)}
						</button>
					))}
				</div>
			)}
		</div>
	);
});
