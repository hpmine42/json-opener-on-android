'use strict';

/* JSON Opener — Service Worker
 * - Offline cache for all app assets
 * - Handles Web Share Target POST (file received from Android)
 * - Supports File Handlers + protocol handlers
 * - Graceful fallback & cache-busting
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

// Last received share payload — app retrieves it after loading via QUERY_SHARE
let lastShare = null;
let lastShareAt = 0;

self.addEventListener('message', (event) => {
  const client = event.source;
  if (!client || !client.postMessage) return;
  const data = event.data;
  if (!data) return;
  if (data.type === 'QUERY_SHARE') {
    client.postMessage({ type: 'SHARE_TARGET', data: lastShare, at: lastShareAt });
    // Optionally clear after delivery? Keep for multi-client.
  } else if (data.type === 'CLEAR_SHARE') {
    lastShare = null;
    lastShareAt = 0;
  } else if (data.type === 'PING') {
    client.postMessage({ type: 'PONG' });
  }
});

/* Share Target: Android shares a file via POST multipart/form-data.
 * We capture it, store in memory, and redirect to the app.
 * The app then pulls it via postMessage QUERY_SHARE.
 */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Handle Share Target POST (must be app root)
  if (event.request.method === 'POST' && isAppRoot(url)) {
    event.respondWith(
      (async () => {
        try {
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
            } else {
              // capture extra fields
              entry[key] = String(value);
            }
          }
          lastShare = entry;
          lastShareAt = Date.now();
          // Notify all clients if any listening (optional — not all SW envs have matchAll)
          try {
            if (self.clients && typeof self.clients.matchAll === 'function') {
              const clients = await self.clients.matchAll({ type: 'window' });
              for (const c of clients) c.postMessage({ type: 'SHARE_TARGET', data: lastShare, at: lastShareAt });
            }
          } catch (e) { /* ignore */ }

          const dest = new URL('./?shared=1', event.request.url);
          return Response.redirect(dest.href, 303);
        } catch (err) {
          return new Response('Share handling failed: ' + err.message, { status: 500 });
        }
      })()
    );
    return;
  }

  // Fallback: if an app shares a file as GET link (e.g. ?json=...), redirect to app with file param
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

  // Standard cache strategy: cache-first with network fallback, then update cache
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.ok && response.type === 'basic' && event.request.method === 'GET') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);

      // For navigations, prefer network first to get fresh HTML but fallback to cache
      if (event.request.mode === 'navigate') {
        return networkFetch.catch(() => cached || caches.match('./index.html'));
      }
      return cached || networkFetch;
    })
  );
});

function isAppRoot(url) {
  // Accept both "/" and "/index.html" and any trailing slash variations
  const path = url.pathname;
  return path.endsWith('/') || path.endsWith('/index.html') || path === new URL('./', self.location.href).pathname;
}
