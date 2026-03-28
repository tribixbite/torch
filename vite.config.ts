import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
	plugins: [
		tailwindcss(),
		react(),
		VitePWA({
			registerType: 'autoUpdate',
			workbox: {
				// Stale-while-revalidate for JSON data (updated frequently)
				runtimeCaching: [
					{
						urlPattern: /flashlights\.now\.json$/,
						handler: 'StaleWhileRevalidate',
						options: {
							cacheName: 'torch-data',
							expiration: { maxEntries: 1 },
						},
					},
				],
				// Pre-cache app shell + static assets
				globPatterns: ['**/*.{js,css,html,svg,png,webp,json}'],
				// Skip the large JSON from precache (handled by runtime caching above)
				globIgnores: ['**/flashlights.now.json', '**/*.sprites.*'],
			},
			manifest: false, // Use existing static/manifest.json
		}),
	],
	resolve: {
		alias: {
			'$lib': resolve(__dirname, 'src/lib')
		}
	},
	// static/ holds flashlights.now.json, favicons, manifest, OG images, CNAME
	publicDir: 'static',
	build: {
		outDir: 'build',
		target: 'esnext'
	}
});
