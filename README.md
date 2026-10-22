# JSON Opener

A small Progressive Web App that opens JSON files directly from the **Android share sheet** — no import, no upload. Everything stays on the device.

Works as a standalone app on Android (Chrome) and in any desktop browser.

## Features

- **Share → JSON Opener** — share a file from another app, pick JSON Opener, the contents appear immediately
- **Tree view** with expand/collapse (virtualized — large files stay smooth)
- **Table view** for arrays of objects
- **Search** across keys and values (`Ctrl+F` / `/`), auto-expands hits
- **Raw JSON** with syntax highlighting, pretty or minified
- **Copy path / value / JSON** — long-press or right-click a node
- **Schema & stats** — types, paths, depth, counts
- **Recent files** — reopen what you viewed last
- **Paste JSON** from the clipboard
- **Dark & light theme**
- **Share, save, copy** the file
- **Installable** on the home screen (Chrome/Android)
- **Offline** (service worker)
- **File Handling API** — open `.json` files with the installed app

## Install on Android

1. Open the page in **Chrome** on the device.
2. `⋮ → Install app` (or “Add to Home screen”).
3. Done — the `{ }` icon appears on the home screen, and the app shows up in the share sheet for `.json` files.

> Note: the share sheet (Web Share Target) works in Chrome and Chromium-based browsers. Receiving files needs the service worker — open the app once after installing.

## How file receiving works

1. Android shares the file as `POST multipart/form-data` to the app URL (`share_target` in the manifest).
2. The service worker intercepts the POST, reads the file, and redirects to `./?shared=1`.
3. The app asks the worker for the last shared file (`QUERY_SHARE`) and opens it.

GET links (`?json=…`) and shared text/URLs are handled as well.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd+F` or `/` | Search |
| `T` / `R` / `L` | Tree / Raw / Table |
| `E` / `C` | Expand all / Collapse all |
| `↑` `↓` `←` `→` | Navigate the tree |
| `Ctrl/Cmd+V` | Paste JSON (home screen) |
| `?` | Help |
| `Esc` | Close panels |

## Project layout

| File | Role |
|---|---|
| `index.html` | UI (home, viewer, help) |
| `styles.css` | Dark/light theme, PWA layout |
| `app.js` | UI logic, virtualization, search, actions |
| `core.js` | Core logic without DOM (testable in Node) |
| `sw.js` | Service worker: offline cache + share target |
| `manifest.webmanifest` | PWA manifest with `share_target` and `file_handlers` |
| `icons/` | App icons (192/512, maskable, apple-touch) |
| `sample.json` | Sample file |
| `test/` | Unit and functional tests |

## Development

```bash
# Core, UI, service worker, and smoke tests
node test/test.js
node test/test-app.js
node test/test-sw.js
node test/test-smoke.js

# Or all at once
npm test

# Local preview (e.g. with an Android device on the same Wi-Fi)
python3 -m http.server 8000
# → http://<machine-ip>:8000
```

For share-target tests on a device the page must be reachable over **HTTPS** (service worker). Locally, `npx serve` behind an HTTPS tunnel (Cloudflare Tunnel, ngrok) or the Chrome flag `chrome://flags → Insecure origins treated as secure` works.

## Privacy

The app **never** uploads data — everything happens locally in the browser. Very large files are parsed on open; the tree stays smooth thanks to virtualization.
