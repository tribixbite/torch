import { memo } from 'react';
import type { ColumnDef } from '$lib/schema/columns';
import MultiFilter from './MultiFilter';
import BooleanFilter from './BooleanFilter';
import RangeFilter from './RangeFilter';
import CompositeFilter from './CompositeFilter';

interface Props {
	column: ColumnDef;
	allColumns: ColumnDef[];
}

export default memo(function FilterGroup({ column, allColumns }: Props) {
	switch (column.filterType) {
		case 'multi':
		case 'mega-multi':
			return <MultiFilter column={column} />;
		case 'boolean':
			return <BooleanFilter column={column} />;
		case 'range':
			return <RangeFilter column={column} />;
		case 'log-range':
			return <RangeFilter column={column} isLog />;
		case 'multiple':
			return <CompositeFilter column={column} allColumns={allColumns} />;
		default:
			return null;
	}
});
