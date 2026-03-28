import { memo } from 'react';
import type { LogicMode } from '$lib/schema/filter-schema';

interface Props {
	modes: string[];
	current: LogicMode;
	onChange: (mode: LogicMode) => void;
}

export default memo(function LogicModeButton({ modes, current, onChange }: Props) {
	if (modes.length <= 1) return null;

	function cycle() {
		const idx = modes.indexOf(current);
		const next = modes[(idx + 1) % modes.length] as LogicMode;
		onChange(next);
	}

	return (
		<button
			className="px-2 py-0.5 text-xs font-mono rounded border cursor-pointer select-none transition-colors"
			style={{ background: 'var(--bg-elevated)', color: 'var(--accent)', borderColor: 'var(--accent)' }}
			onClick={cycle}
			title={`Click to cycle filter mode: ${modes.join(' → ')}`}
		>
			{current}
		</button>
	);
});
