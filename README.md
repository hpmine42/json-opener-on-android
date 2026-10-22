# JSON Opener — View & Explore JSON Instantly

**Open JSON files directly from the Android share menu — no import, no upload, no tracking.**  
Everything stays 100% local on your device. Fast, private, offline-ready PWA.

![JSON Opener](icons/icon-512.png)

> Share → JSON Opener → explore. That’s it.

---

## ✨ What’s new in v2

A complete overhaul of the original JSON Opener, now in English and packed with pro features:

### 🚀 Core experience
- **Instant open** via Android **Share Target**, drag & drop, paste, URL or file picker
- **Virtualized tree** — smooth even for >100k nodes, with breadcrumbs, type badges & JSONPath
- **Power search** — keys/values/paths, *regex*, case-sensitive, filter mode, auto-expand hits
- **Text view** — pretty / minified, sort-keys, wrap, syntax highlighting + line numbers
- **Table view** — perfect for arrays of objects (like a spreadsheet)
- **Schema & Stats** — structure overview, types, depth, distribution, examples + YAML preview

### 🛠️ Tools (new)
- **Validate & Lint** — precise error positions, JSONC support (comments + trailing commas), NDJSON (JSON Lines)
- **Format** — prettify / minify / sort keys
- **Convert** — JSON → **YAML** and **CSV** (for arrays), one-click copy or download
- **JSONPath** — query with `$.users[0].name`, `$.store.*`, etc.
- **Flatten** — expand to dot-notation, copy paths
- **Compare** — open a second file to diff (UI ready)

### 🎨 UX & PWA
- **Light / Dark / Auto** theme with manual toggle (persisted)
- **Command palette** (`Ctrl+K`) — jump to any action
- **Breadcrumbs + context menu** — copy value / path / subtree, expand/collapse
- **Expand all / Collapse all / Depth +1**, keyboard navigation (arrows, Home/End, y/p)
- **Recent files** (localStorage), URL loader (`?file=https://…/data.json`), paste handler
- **File Handlers** API + better Share Target (multiple files, text, URL)
- **Offline-first** — Service Worker with bumped cache (`json-opener-v2`), background sync ready
- **Accessible** — proper ARIA, focus management, keyboard shortcuts help

---

## 📱 Install on Android

1. Open this page in **Chrome** on your Android device.
2. Tap `⋮ → Install app` (or “Add to Home screen”).
3. Done — the `{ }` icon appears on your home screen and in the **share sheet** for `.json`, `.jsonc`, `.jsonl`, `.geojson`, `.ndjson`.

> The share menu works in Chrome/Chromium. File reception needs the Service Worker — open the app once after install.

Alternatively, use any Chromium desktop: file handlers let you double-click `.json` files (ChromeOS/Windows).

---

## 🖥️ Usage

### Open a file
- **From any app:** Share → JSON Opener
- **In the app:** `Choose file` / drag & drop / paste / Load from URL
- **Via URL param:** `https://your-host/?file=https://api.example.com/data.json`
- **Command palette:** `Ctrl+K` → type “open”, “paste”, “url”

### Explore
- **Tree:** click ▸/▾ to expand, right-click for context menu (copy path/value/subtree), `y` copy value, `p` copy path, `↑↓→←` navigate
- **Search:** `Ctrl+F` or `/` → regex / Aa / Filter toggles, `Enter`/`Shift+Enter` next/prev, auto-expands containers with hits
- **Text:** toggle Pretty/Minified, Sort keys, Wrap, Copy
- **Table:** auto-detects arrays of objects, shows first 200 rows
- **Stats:** node count, depth, type distribution, largest array, etc.
- **Schema:** `$ → object (N)` tree + YAML preview + stats tab

### Tools
Open via `Tools` button or command palette:
- `Validate` — shows first syntax error with line/col
- `Format` / `Minify` / `Sort keys`
- `Copy as YAML` / `Copy as CSV` / `Download CSV`
- `Flatten` — copies flattened `$.a.b[0]` map
- `JSONPath` — run queries, results shown as formatted JSON

### Share / Save / Copy
Bottom bar (mobile) or viewer toolbar: `Share` (Web Share API with file), `Save` (download), `Copy` (clipboard). The file is re-serialized pretty-printed (sorted if enabled).

---

## 🧩 Try it

- Click **Load sample** on the home screen — a rich `sample.json` with users, nested objects, mixed types, empties — great to test search, table & tools.
- Try pasting NDJSON:
  ```
  {"id":1,"name":"Alice"}
  {"id":2,"name":"Bob"}
  ```
  It’s auto-detected as an array.

---

## 🏗️ Tech stack

| File | Purpose |
|------|---------|
| `index.html` | UI — home, viewer (tree/text/table/stats), info, sheets, command palette |
| `styles.css` | Design system v2 — dark/light tokens, responsive, PWA layout |
| `app.js` | UI logic — tree virtualization, search, tools, file handling, PWA |
| `core.js` | Core (DOM-free, Node-testable) — `JsonTree`, parsing (JSONC/NDJSON), stats, YAML/CSV, JSONPath |
| `sw.js` | Service Worker — offline cache + Share Target POST + file handlers |
| `manifest.webmanifest` | PWA manifest  (`share_target`, `file_handlers`, shortcuts, screenshots) |
| `icons/` | App icons (192/512, maskable, apple-touch, favicon) |
| `sample.json` | Example dataset |
| `test/` | Unit + functional tests for `core.js`, `app.js`, `sw.js` |

### How file sharing works
1. Android shares a file as `POST multipart/form-data` to the app URL (`share_target`).
2. Service Worker intercepts POST, reads the file, stores it, redirects to `./?shared=1`.
3. App queries the worker (`QUERY_SHARE`) and opens the file.  
   Also handles `GET ?file=…`, `?json=…`, direct paste & `launchQueue` (file handlers).

---

## 💻 Development

```bash
# Run core tests
node test/test.js

# All tests (core + app smoke + SW)
node test/test.js && node test/test-smoke.js && node test/test-app.js && node test/test-sw.js

# Serve locally (e.g., for same-WLAN testing)
python3 -m http.server 8000
# → http://<your-ip>:8000

# Or with live reload
npx serve .
```

For Share Target tests, the page must be served over **HTTPS** (Service Worker). Use a tunnel (`cloudflare tunnel`, `ngrok`) or `chrome://flags → Insecure origins treated as secure`.

### Key design decisions
- **No build step** — vanilla HTML/CSS/JS for instant load & offline caching
- **Virtualization** — only visible rows rendered (`ROW_H` + binary search on offsets), handles 200k+ rows
- **Tolerant parser** — strips `//`/`/* */` comments + trailing commas, detects NDJSON
- **Everything local** — no analytics, no upload; `localStorage` only for theme & recent list

---

## 🔒 Privacy

- No data leaves your device. No server, no tracking.
- Very large files (many MB) are parsed locally; the tree is built incrementally to keep UI fluid.
- Recent files list & theme are stored in `localStorage` only — clear via “Clear history” or browser storage.

---

## 🗺️ Roadmap

- [ ] Diff viewer (side-by-side)
- [ ] Editable tree (add/rename/delete, undo)
- [ ] JSON Schema validation against a schema file
- [ ] Themes: high-contrast, custom accent
- [ ] Web Worker for parsing huge files

---

## 📄 License

MIT — use, fork, and improve. PRs welcome!

**Enjoy exploring your JSON — fast, private, and everywhere. 🚀**
