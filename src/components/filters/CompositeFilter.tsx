import { memo, useMemo } from 'react';
import type { ColumnDef } from '$lib/schema/columns';
import FilterGroup from './FilterGroup';

interface Props {
	column: ColumnDef;
	allColumns: ColumnDef[];
}

export default memo(function CompositeFilter({ column, allColumns }: Props) {
	const subColumns = useMemo(
		() => (column.subColumns ?? []).map((idx) => allColumns[idx]).filter(Boolean),
		[column.subColumns, allColumns]
	);

	return (
		<div className="space-y-3">
			{subColumns.map((subCol) => (
				<div key={subCol.index}>
					<div
						className="text-xs font-medium mb-1"
						style={{ color: 'var(--text-secondary)' }}
						dangerouslySetInnerHTML={{ __html: subCol.display }}
					/>
					<FilterGroup column={subCol} allColumns={allColumns} />
				</div>
			))}
		</div>
	);
});
