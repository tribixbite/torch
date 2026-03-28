import { usePreferences, type Theme } from '$lib/state/preferences';

const themes: { value: Theme; label: string; icon: string }[] = [
	{ value: 'light', label: 'Light', icon: '☀' },
	{ value: 'dark', label: 'Dark', icon: '☾' },
	{ value: 'system', label: 'System', icon: '◐' },
];

export default function ThemeToggle() {
	const theme = usePreferences((s) => s.theme);
	const setTheme = usePreferences((s) => s.setTheme);

	return (
		<div className="flex rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
			{themes.map((t) => (
				<button
					key={t.value}
					className="px-2 py-1 text-xs cursor-pointer select-none transition-colors"
					style={{
						background: theme === t.value ? 'var(--accent)' : 'var(--bg-tertiary)',
						color: theme === t.value ? 'var(--bg-primary)' : 'var(--text-secondary)',
					}}
					onClick={() => setTheme(t.value)}
					title={t.label}
				>
					{t.icon}
				</button>
			))}
		</div>
	);
}
