# JSON Opener

A local **JSON studio** for Android and the web. Open files from the share sheet, drop them on the page, or paste a payload. Nothing is uploaded.

## What’s new

The interface is rebuilt as a quieter workspace:

- **Home** — one drop surface, paste and URL intake, recent files
- **Viewer** — Tree / Text / Table / Stats as a single control
- **Coral on ink** dark theme, warm paper light theme
- Search docks at the top of the workspace
- SVG chrome instead of emoji clutter
- Same engine underneath: virtualized tree, JSONC/NDJSON, YAML/CSV, JSONPath, schema

## Features

- Android **Share → JSON Opener**
- Virtualized tree with copy path / value
- Search (regex, case, filter)
- Pretty / minified text, table for arrays of objects
- Schema, stats, validate, format, flatten
- Recent files, dark/light, installable PWA, offline

## Install on Android

1. Open the page in **Chrome**.
2. `⋮ → Install app`.
3. Share a `.json` file and pick **JSON Opener**.

## Development

```bash
npm test
python3 -m http.server 8000
```

All parsing and viewing happens in the browser. No server, no tracking.
