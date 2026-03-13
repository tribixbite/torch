# Torch

A modern flashlight search engine. Search, filter, and compare 3,177 flashlights across 28 filterable specs.

**Live:** [torch.directory](https://torch.directory)

## Features

- **28 filterable specs** — brand, lumens, runtime, battery, price, LED, throw, weight, and more
- **6 filter types** — multi-select, boolean, linear range, logarithmic range, composite groups
- **4 logic modes** — any / all / only / none per filter
- **Real-time results** — Web Worker handles all filtering off the main thread
- **URL-driven state** — every filter combination is a shareable URL
- **Offline support** — PWA with service worker caching
- **Card + table views** — with sprite thumbnails from the dataset
- **Star/pin flashlights** — persisted in localStorage
- **Dark/light/system theme**
- **Keyboard shortcuts** — `/` to search, `Escape` to clear

## Stack

- [SvelteKit](https://svelte.dev) (adapter-static, SPA mode)
- [Svelte 5](https://svelte.dev/docs/svelte/overview) runes (`$state`, `$derived`, `$effect`)
- [Tailwind CSS v4](https://tailwindcss.com) (CSS-first)
- Web Worker for filter/sort/search
- Service Worker for offline PWA

## Development

```bash
bun install
bun run dev
```

Build for production:

```bash
bun run build
bun run preview
```

> **Termux/Android note:** Uses `scripts/vite-cli.ts` to run Vite through Bun directly, bypassing Node's `process.platform === 'android'` which breaks native module resolution for lightningcss/rollup/esbuild.

## Attribution

Data and inspiration from [flashlights.parametrek.com](http://flashlights.parametrek.com) by [parametrek](http://parametrek.com). The flashlight database, sprite sheet, and filter definitions are sourced from parametrek's dataset.

## License

MIT
