'use strict';

/* Service Worker tests: loads sw.js in a Node VM with mocked
 * ServiceWorkerGlobalScope and runs through: install/activate, Share-POST, QUERY_SHARE,
 * GET fallback, normal GET cache. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SW_SRC = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const ORIGIN = 'http://127.0.0.1:8787';

let passed = 0;
function ok(cond, name) {
  if (!cond) throw new Error('FAILED: ' + name);
  passed++;
  console.log('  ✓ ' + name);
}

/* ---------- Mocks ---------- */
function createHarness() {
  const listeners = {};
  const cacheStore = new Map();

  const cacheMock = {
    addAll: async (urls) => {
      cacheMock._added = (cacheMock._added || []).concat(urls);
    },
    put: async (req, res) => {
      cacheStore.set(String(typeof req === 'string' ? req : req.url), res);
    },
    match: async (req) => cacheStore.get(String(typeof req === 'string' ? req : req.url)) || undefined,
    keys: async () => [],
    delete: async () => true
  };

  const fetchCalls = [];
  const selfMock = {
    location: { origin: ORIGIN, href: ORIGIN + '/sw.js' },
    addEventListener: (type, fn) => {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
    postMessage: () => {}
  };

  const sandbox = {
    self: selfMock,
    caches: {
      open: async () => cacheMock,
      match: async (req) => cacheMock.match(req),
      keys: async () => [],
      delete: async () => true
    },
    fetch: async (input) => {
      fetchCalls.push(typeof input === 'string' ? input : input.url);
      const res = new Response('<html>index</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
      Object.defineProperty(res, 'type', { value: 'basic' });
      return res;
    },
    Response,
    Request,
    URL,
    URLSearchParams,
    console,
    setTimeout,
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(SW_SRC, sandbox, { filename: 'sw.js' });
  return { listeners, cacheMock, cacheStore, fetchCalls, sandbox };
}

function fire(harness, type, event) {
  for (const fn of harness.listeners[type] || []) fn(event);
}

function fireInstall(harness) {
  let wait;
  fire(harness, 'install', { waitUntil: (p) => { wait = p; } });
  return wait;
}

function fireActivate(harness) {
  let wait;
  fire(harness, 'activate', { waitUntil: (p) => { wait = p; } });
  return wait;
}

function fireFetch(harness, request) {
  let captured = null;
  const event = {
    request,
    respondWith: (p) => { captured = p; }
  };
  fire(harness, 'fetch', event);
  if (!captured) throw new Error('respondWith not called for ' + request.url);
  return Promise.resolve(captured);
}

/* ---------- Tests ---------- */

(async () => {
  console.log('Service Worker – install/activate');
  const h = createHarness();
  await fireInstall(h);
  ok(h.cacheMock._added.length === 11, 'all core assets cached (' + h.cacheMock._added.length + ')');
  ok(h.cacheMock._added.indexOf('./core.js') !== -1, 'core.js in offline cache');
  ok(h.cacheMock._added.indexOf('./sample.json') !== -1, 'sample.json in offline cache');
  await fireActivate(h);
  ok(true, 'activate without error');

  console.log('Service Worker – Share POST (multipart/form-data with file)');
  const fd = new FormData();
  fd.append('title', 'My file');
  fd.append('text', '');
  fd.append('url', '');
  fd.append('files', new File([JSON.stringify({ a: 1, b: [true, null] })], 'shared.json', { type: 'application/json' }));
  const postReq = new Request(ORIGIN + '/', { method: 'POST', body: fd });
  const postRes = await fireFetch(h, postReq);
  ok(postRes.status === 303, '303 redirect (' + postRes.status + ')');
  ok((postRes.headers.get('location') || '').indexOf('shared=1') !== -1, 'Location → ?shared=1');

  console.log('Service Worker – QUERY_SHARE returns file');
  let received = null;
  fire(h, 'message', {
    data: { type: 'QUERY_SHARE' },
    source: { postMessage: (msg) => { received = msg; } }
  });
  await new Promise((r) => setImmediate(r));
  ok(received && received.type === 'SHARE_TARGET', 'response SHARE_TARGET');
  ok(received.data.files && received.data.files.length === 1, 'file present');
  const f = received.data.files[0];
  ok(f.name === 'shared.json', 'file name correct: ' + f.name);
  ok(f.type === 'application/json', 'MIME type correct: ' + f.type);
  const content = await f.text();
  ok(content === JSON.stringify({ a: 1, b: [true, null] }), 'file content correct');
  ok(received.data.title === 'My file', 'title preserved');

  console.log('Service Worker – Share POST without file (text)');
  const h2 = createHarness();
  const fd2 = new FormData();
  fd2.append('text', '{"only":"text"}');
  const postReq2 = new Request(ORIGIN + '/', { method: 'POST', body: fd2 });
  await fireFetch(h2, postReq2);
  let received2 = null;
  fire(h2, 'message', { data: { type: 'QUERY_SHARE' }, source: { postMessage: (m) => { received2 = m; } } });
  await new Promise((r) => setImmediate(r));
  ok(received2.data.text === '{"only":"text"}', 'text share preserved');
  ok(received2.data.files.length === 0, 'no file');

  console.log('Service Worker – GET fallback for shared links');
  const h3 = createHarness();
  const linkReq = new Request(ORIGIN + '/?json=' + encodeURIComponent('https://example.com/x.json'), { method: 'GET' });
  const linkRes = await fireFetch(h3, linkReq);
  const linkText = await linkRes.text();
  ok(linkText.indexOf('index') !== -1, 'returns index.html');
  ok(h3.fetchCalls.some((u) => u.indexOf('file=') !== -1 && u.indexOf('example.com') !== -1), 'URL forwarded with file=');
  const shareReq = new Request(ORIGIN + '/?share=1', { method: 'GET' });
  await fireFetch(h3, shareReq);
  ok(true, '?share=1 also handled');

  console.log('Service Worker – normal GET with cache');
  const h4 = createHarness();
  const getReq = new Request(ORIGIN + '/styles.css', { method: 'GET' });
  const getRes = await fireFetch(h4, getReq);
  ok((await getRes.text()).indexOf('index') !== -1, 'response from network');
  ok(h4.fetchCalls.some((u) => u.endsWith('/styles.css')), 'styles.css fetched');
  ok(h4.cacheStore.has(ORIGIN + '/styles.css'), 'styles.css cached');

  console.log('Service Worker – POST only on app path');
  const h5 = createHarness();
  const foreign = new Request(ORIGIN + '/foreign', { method: 'POST', body: 'x' });
  const foreignRes = await fireFetch(h5, foreign);
  ok(foreignRes.status !== 303, 'no share redirect on foreign path (' + foreignRes.status + ')');
  let received5 = null;
  fire(h5, 'message', { data: { type: 'QUERY_SHARE' }, source: { postMessage: (m) => { received5 = m; } } });
  await new Promise((r) => setImmediate(r));
  ok(received5.data === null, 'lastShare stays empty');

  console.log('\nAll ' + passed + ' Service Worker tests passed.');
})().catch((err) => { console.error(err); process.exit(1); });
