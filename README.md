# JSON Opener

A local **JSON studio** built with **Vue 3** and **TypeScript**. Open files from the Android share sheet, drop them on the page, or paste a payload. Nothing is uploaded.

## Stack

- Vue 3 (Composition API + `<script setup>`)
- TypeScript
- Vite
- Virtualized tree engine in `src/core.ts` (DOM-free, unit-tested)

## Features

- Android **Share → JSON Opener**
- Tree / Text / Table / Stats
- Search (regex, case-sensitive)
- Schema, YAML, CSV, JSONPath, flatten
- Dark / light studio theme
- Offline PWA

## Develop

```bash
npm install
npm test
npm run dev
```

The dev server binds to `0.0.0.0:8000`.

```bash
npm run build
npm run preview
```

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs tests and a production build on every push and pull request. Pushes to `main` also deploy `dist/` to **GitHub Pages**.

In the repo: **Settings → Pages → Source: GitHub Actions**. After the first successful deploy the app is at:

`https://hpmine42.github.io/json-opener-on-android/`


## Layout

| Path | Role |
|---|---|
| `src/core.ts` | Parse, tree, schema, convert |
| `src/App.vue` | UI |
| `src/main.ts` | Vue bootstrap + service worker |
| `public/sw.js` | Offline cache + share target |
| `public/manifest.webmanifest` | PWA manifest |
