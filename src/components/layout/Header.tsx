import { useRef, useState, useEffect, useCallback } from 'react';
import { usePreferences } from '$lib/state/preferences';
import { useUrlState } from '$lib/state/url-state';
import ThemeToggle from './ThemeToggle';

export default function Header() {
	const searchRef = useRef<HTMLInputElement>(null);
	const [showHelp, setShowHelp] = useState(false);
	const searchQuery = useUrlState((s) => s.searchQuery);
	const setSearchQuery = useUrlState((s) => s.setSearchQuery);
	const toggleSidebar = usePreferences((s) => s.toggleSidebar);
	const sidebarOpen = usePreferences((s) => s.sidebarOpen);
	const setSidebarOpen = usePreferences((s) => s.setSidebarOpen);

	const handleKeydown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'Escape') {
			setSearchQuery('');
			searchRef.current?.blur();
		}
	}, [setSearchQuery]);

	// Global keyboard shortcuts
	useEffect(() => {
		function handleGlobalKeydown(e: KeyboardEvent) {
			const isInput = document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA';

			if (e.key === '/' && !e.ctrlKey && !e.metaKey && !isInput) {
				e.preventDefault();
				searchRef.current?.focus();
			}
			if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
				e.preventDefault();
				searchRef.current?.focus();
			}
			if (e.key === '?' && !e.ctrlKey && !e.metaKey && !isInput) {
				setShowHelp((prev) => !prev);
			}
			if (e.key === 'Escape') {
				if (showHelp) { setShowHelp(false); return; }
				if (sidebarOpen) { setSidebarOpen(false); }
			}
		}
		window.addEventListener('keydown', handleGlobalKeydown);
		return () => window.removeEventListener('keydown', handleGlobalKeydown);
	}, [showHelp, sidebarOpen, setSidebarOpen]);

	return (
		<>
			<header
				className="sticky top-0 z-30 flex items-center gap-3 px-3 py-2 border-b"
				style={{ background: 'var(--bg-primary)', borderColor: 'var(--border)' }}
			>
				{/* Mobile menu toggle */}
				<button
					className="md:hidden text-lg cursor-pointer select-none"
					style={{ color: 'var(--text-primary)' }}
					onClick={toggleSidebar}
					title="Toggle filters"
				>
					☰
				</button>

				{/* Logo */}
				<h1 className="text-lg font-bold whitespace-nowrap" style={{ color: 'var(--accent)' }}>
					Torch
				</h1>

				{/* Global text search */}
				<div className="flex-1 max-w-md">
					<input
						ref={searchRef}
						type="text"
						placeholder="Search flashlights... (/)"
						className="w-full px-3 py-1.5 text-sm rounded-lg border outline-none"
						style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						onKeyDown={handleKeydown}
					/>
				</div>

				{/* Help button */}
				<button
					className="text-sm cursor-pointer select-none opacity-60 hover:opacity-100 transition-opacity"
					style={{ color: 'var(--text-secondary)' }}
					onClick={() => setShowHelp((p) => !p)}
					title="Keyboard shortcuts (?)"
				>
					?
				</button>

				{/* Theme toggle */}
				<ThemeToggle />
			</header>

			{/* Help dialog */}
			{showHelp && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center"
					style={{ background: 'rgba(0,0,0,0.6)' }}
					onClick={() => setShowHelp(false)}
				>
					<div
						className="rounded-lg shadow-xl p-5 max-w-sm w-full mx-4"
						style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
						onClick={(e) => e.stopPropagation()}
					>
						<div className="flex justify-between items-center mb-3">
							<h3 className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Keyboard Shortcuts</h3>
							<button className="cursor-pointer" style={{ color: 'var(--text-muted)' }} onClick={() => setShowHelp(false)}>✕</button>
						</div>
						<div className="space-y-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
							<div className="flex justify-between">
								<span>
									<kbd className="px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}>/</kbd>
									{' or '}
									<kbd className="px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}>Ctrl+K</kbd>
								</span>
								<span>Focus search</span>
							</div>
							<div className="flex justify-between">
								<span><kbd className="px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}>Esc</kbd></span>
								<span>Clear / close</span>
							</div>
							<div className="flex justify-between">
								<span><kbd className="px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}>?</kbd></span>
								<span>Toggle this help</span>
							</div>
						</div>
						<div className="mt-4 pt-3 text-xs" style={{ color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>
							Inspired by{' '}
							<a href="http://flashlights.parametrek.com" target="_blank" rel="noopener" className="underline" style={{ color: 'var(--accent)' }}>
								parametrek
							</a>
						</div>
					</div>
				</div>
			)}
		</>
	);
}
