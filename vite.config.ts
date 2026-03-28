import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
	plugins: [tailwindcss(), react()],
	resolve: {
		alias: {
			'$lib': resolve(__dirname, 'src/lib')
		}
	},
	build: {
		outDir: 'build',
		target: 'esnext'
	}
});
