<script lang="ts">
	import { onMount } from 'svelte';

	interface CaseRow {
		variation_asin: string;
		parent_asin: string;
		title: string;
		color_or_pattern: string | null;
		weight_g: number;
		weight_raw: string | null;
		price_usd: number | null;
		stars: number | null;
		review_count: number | null;
		thumbnail_url: string;
		amazon_url: string;
		source: string;
		fetched_at: string;
	}

	interface CasesPayload {
		generatedAt: string;
		count: number;
		cases: CaseRow[];
	}

	let payload: CasesPayload | null = $state(null);
	let loadError: string | null = $state(null);

	let maxWeight = $state(50);
	let minStars = $state(4.0);
	let minReviews = $state(0);
	let includeUnrated = $state(true);
	let search = $state('');
	let sortKey: 'weight' | 'stars' | 'price' | 'reviews' = $state('weight');

	onMount(async () => {
		try {
			const res = await fetch('/cases.json', { cache: 'no-store' });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			payload = await res.json();
		} catch (e) {
			loadError = (e as Error).message;
		}
	});

	const filtered = $derived.by(() => {
		if (!payload) return [] as CaseRow[];
		const q = search.trim().toLowerCase();
		const out = payload.cases.filter((c) => {
			if (c.weight_g > maxWeight) return false;
			const hasStars = c.stars != null && c.stars > 0;
			if (hasStars && c.stars! < minStars) return false;
			if (!hasStars && !includeUnrated) return false;
			if ((c.review_count ?? 0) < minReviews) return false;
			if (q !== '') {
				const blob = `${c.title} ${c.color_or_pattern ?? ''}`.toLowerCase();
				if (!blob.includes(q)) return false;
			}
			return true;
		});
		out.sort((a, b) => {
			switch (sortKey) {
				case 'stars':
					return (b.stars ?? 0) - (a.stars ?? 0);
				case 'price':
					return (a.price_usd ?? Infinity) - (b.price_usd ?? Infinity);
				case 'reviews':
					return (b.review_count ?? 0) - (a.review_count ?? 0);
				case 'weight':
				default:
					return a.weight_g - b.weight_g;
			}
		});
		return out;
	});

	function fmtPrice(p: number | null): string {
		if (p == null) return '—';
		return `$${p.toFixed(2)}`;
	}
	function fmtReviews(n: number | null): string {
		if (n == null) return '—';
		if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
		return String(n);
	}
	function fmtStars(s: number | null): string {
		if (s == null) return '—';
		return s.toFixed(1);
	}
</script>

<svelte:head>
	<title>Pixel 8 Pro Case Browser</title>
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
</svelte:head>

<div class="page">
	<header class="hdr">
		<h1>Pixel 8 Pro cases</h1>
		<p class="sub">
			{#if payload}
				{filtered.length} / {payload.count} variations · generated {new Date(
					payload.generatedAt
				).toLocaleString()}
			{:else if loadError}
				<span class="err">load failed: {loadError}</span>
			{:else}
				loading…
			{/if}
		</p>
	</header>

	<section class="filters">
		<label>
			<span>Max weight</span>
			<input type="range" min="5" max="80" step="1" bind:value={maxWeight} />
			<output>{maxWeight}g</output>
		</label>
		<label>
			<span>Min stars</span>
			<input type="range" min="3" max="5" step="0.1" bind:value={minStars} />
			<output>{minStars.toFixed(1)}★</output>
		</label>
		<label>
			<span>Min reviews</span>
			<input type="range" min="0" max="2000" step="50" bind:value={minReviews} />
			<output>{minReviews}</output>
		</label>
		<label class="checkbox">
			<input type="checkbox" bind:checked={includeUnrated} />
			<span>Include unrated</span>
		</label>
		<label class="search">
			<span>Search</span>
			<input type="text" placeholder="color, pattern, brand…" bind:value={search} />
		</label>
		<label class="sort">
			<span>Sort</span>
			<select bind:value={sortKey}>
				<option value="weight">Weight ↑</option>
				<option value="stars">Stars ↓</option>
				<option value="price">Price ↑</option>
				<option value="reviews">Reviews ↓</option>
			</select>
		</label>
	</section>

	<section class="grid">
		{#each filtered as c (c.variation_asin)}
			<a class="card" href={c.amazon_url} target="_blank" rel="noopener">
				<div class="thumb">
					<img src={c.thumbnail_url} alt={c.color_or_pattern ?? c.title} loading="lazy" />
				</div>
				<div class="meta">
					<div class="row1">
						<span class="weight">{c.weight_g.toFixed(1)}g</span>
						<span class="stars">★ {fmtStars(c.stars)}</span>
						<span class="reviews">({fmtReviews(c.review_count)})</span>
						<span class="price">{fmtPrice(c.price_usd)}</span>
					</div>
					<div class="color">{c.color_or_pattern ?? '—'}</div>
					<div class="title" title={c.title}>{c.title}</div>
				</div>
			</a>
		{/each}
		{#if payload && filtered.length === 0}
			<p class="empty">No matches. Loosen the filters.</p>
		{/if}
	</section>
</div>

<style>
	.page {
		min-height: 100vh;
		background: var(--bg-primary);
		color: var(--text-primary);
		padding: 1rem;
		max-width: 1400px;
		margin: 0 auto;
	}
	.hdr {
		margin-bottom: 1rem;
	}
	.hdr h1 {
		margin: 0 0 0.25rem;
		font-size: 1.5rem;
		font-weight: 600;
	}
	.sub {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.85rem;
	}
	.err {
		color: var(--danger);
	}

	.filters {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 0.75rem;
		padding: 0.75rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: 8px;
		margin-bottom: 1rem;
		position: sticky;
		top: 0;
		z-index: 10;
		backdrop-filter: blur(8px);
	}
	.filters label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.75rem;
		color: var(--text-secondary);
	}
	.filters label span {
		display: flex;
		justify-content: space-between;
	}
	.filters output {
		font-variant-numeric: tabular-nums;
		color: var(--text-primary);
	}
	.filters input[type='range'] {
		width: 100%;
		accent-color: var(--accent);
	}
	.filters .checkbox {
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
	}
	.filters .checkbox input {
		accent-color: var(--accent);
		width: 1rem;
		height: 1rem;
	}
	.filters input[type='text'],
	.filters select {
		background: var(--bg-tertiary);
		border: 1px solid var(--border);
		color: var(--text-primary);
		padding: 0.4rem 0.5rem;
		border-radius: 4px;
		font-size: 0.85rem;
	}
	.filters input[type='text']:focus,
	.filters select:focus {
		outline: 2px solid var(--ring);
		border-color: var(--accent);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 0.75rem;
	}
	.card {
		display: flex;
		flex-direction: column;
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
		text-decoration: none;
		color: inherit;
		transition:
			transform 0.15s,
			border-color 0.15s;
	}
	.card:hover {
		transform: translateY(-2px);
		border-color: var(--accent);
	}
	.thumb {
		aspect-ratio: 1;
		background: #fff;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.thumb img {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
	}
	.meta {
		padding: 0.6rem;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.8rem;
	}
	.row1 {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
		font-variant-numeric: tabular-nums;
	}
	.weight {
		color: var(--accent);
		font-weight: 600;
	}
	.stars {
		color: var(--star);
	}
	.reviews {
		color: var(--text-muted);
		font-size: 0.7rem;
	}
	.price {
		margin-left: auto;
		color: var(--deal-green);
		font-weight: 600;
	}
	.color {
		color: var(--text-secondary);
		font-size: 0.75rem;
	}
	.title {
		color: var(--text-primary);
		font-size: 0.78rem;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		line-height: 1.25;
	}
	.empty {
		grid-column: 1 / -1;
		text-align: center;
		color: var(--text-muted);
		padding: 2rem;
	}

	@media (max-width: 600px) {
		.grid {
			grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
			gap: 0.5rem;
		}
		.meta {
			padding: 0.4rem;
			font-size: 0.7rem;
		}
		.filters {
			grid-template-columns: 1fr 1fr;
		}
	}
</style>
