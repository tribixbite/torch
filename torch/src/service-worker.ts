/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const CACHE = `cache-${version}`;
const ASSETS = [
	...build, // app shell (JS/CSS)
	...files  // static files (JSON, sprites, manifest)
];

// Install: pre-cache all assets
self.addEventListener('install', (event: ExtendableEvent) => {
	event.waitUntil(
		caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => {
			(self as unknown as ServiceWorkerGlobalScope).skipWaiting();
		})
	);
});

// Activate: clean up old caches
self.addEventListener('activate', (event: ExtendableEvent) => {
	event.waitUntil(
		caches.keys().then((keys) =>
			Promise.all(
				keys
					.filter((key) => key !== CACHE)
					.map((key) => caches.delete(key))
			)
		).then(() => {
			(self as unknown as ServiceWorkerGlobalScope).clients.claim();
		})
	);
});

// Fetch: stale-while-revalidate for JSON data, cache-first for everything else
self.addEventListener('fetch', (event: FetchEvent) => {
	if (event.request.method !== 'GET') return;

	const url = new URL(event.request.url);

	// Stale-while-revalidate for the JSON data file
	if (url.pathname.endsWith('.json') && url.pathname.includes('flashlights')) {
		event.respondWith(
			caches.open(CACHE).then(async (cache) => {
				const cached = await cache.match(event.request);
				const networkPromise = fetch(event.request).then((response) => {
					if (response.ok) {
						cache.put(event.request, response.clone());
					}
					return response;
				}).catch(() => null);

				return cached ?? (await networkPromise) ?? new Response('Offline', { status: 503 });
			})
		);
		return;
	}

	// Cache-first for app shell and static assets
	if (ASSETS.includes(url.pathname)) {
		event.respondWith(
			caches.match(event.request).then((cached) => {
				return cached ?? fetch(event.request);
			})
		);
		return;
	}

	// Network-first for everything else
	event.respondWith(
		fetch(event.request).catch(() => {
			return caches.match(event.request).then((cached) => {
				return cached ?? new Response('Offline', { status: 503 });
			});
		})
	);
});
