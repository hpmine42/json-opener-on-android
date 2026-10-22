'use strict';

/* JSON Opener – Service Worker
 * - Offline cache for all app files
 * - Receive Share Target POSTs (files shared from Android)
 * - Fallback link handler if the share arrives as GET
 */

const CACHE_NAME = 'json-opener-v2';
const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './core.js',
  './sample.json',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Last payload received via Share Target — the app fetches it after load */
let lastShare = null;

self.addEventListener('message', (event) => {
  const client = event.source;
  if (!client || !client.postMessage) return;
  if (event.data && event.data.type === 'QUERY_SHARE') {
    client.postMessage({ type: 'SHARE_TARGET', data: lastShare });
  }
});

/* ----------------------------------------------------------------
 * Share Target: Android shares a file with this app.
 * The browser sends a POST (multipart/form-data) here.
 * The worker stores the data and redirects to the app;
 * the page then retrieves it via a QUERY_SHARE message.
 * -------------------------------------------------------------- */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === 'POST' && url.pathname.endsWith('/')) {
    event.respondWith(
      (async () => {
        const form = await event.request.formData();
        const entry = { title: '', text: '', url: '', files: [] };
        for (const [key, value] of form.entries()) {
          if (key === 'files') {
            if (Array.isArray(value)) {
              for (const f of value) entry.files.push(f);
            } else {
              entry.files.push(value);
            }
          } else if (key in entry) {
            entry[key] = String(value);
          }
        }
        lastShare = entry;
        const dest = new URL('./?shared=1', event.request.url);
        return Response.redirect(dest.href, 303);
      })()
    );
    return;
  }

  /* Fallback: if an app shares the file as a GET link (e.g. ?json=…),
   * intercept it and open the app with that link. */
  if (event.request.method === 'GET' && url.origin === self.location.origin) {
    if (url.searchParams.has('json') || url.searchParams.has('share')) {
      event.respondWith(
        fetch('./index.html?file=' + encodeURIComponent(url.href)).catch(() =>
          caches.match('./index.html')
        )
      );
      return;
    }
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetched = fetch(event.request)
        .then((response) => {
          if (response && response.ok && response.type === 'basic' && event.request.method === 'GET') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});
