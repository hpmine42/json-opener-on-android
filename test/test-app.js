'use strict';

/* Functional tests for app.js with a DOM stub:
 * load sample → viewer → expand/collapse → search → raw → schema. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP_SRC = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const HTML_SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const SAMPLE = fs.readFileSync(path.join(__dirname, '..', 'sample.json'), 'utf8');

const ids = new Set();
for (const m of HTML_SRC.matchAll(/id="([^"]+)"/g)) ids.add(m[1]);

let passed = 0;
function ok(cond, name, extra) {
  if (!cond) throw new Error('FAILED: ' + name + (extra ? ' – ' + extra : ''));
  passed++;
  console.log('  ✓ ' + name);
}

/* ---------- Harness ---------- */
const pages = ['page-home', 'page-viewer', 'page-info'].map((id) => {
  const p = { id, active: false, classList: null };
  p.classList = {
    add: () => { p.active = true; },
    remove: () => { p.active = false; },
    toggle: () => { p.active = !p.active; },
    contains: (c) => c === 'active' && p.active
  };
  return p;
});
function pageOf(id) { return pages.find((p) => p.id === id); }

const elements = new Map();
function makeEl(id) {
  const el = {
    id,
    hidden: false,
    textContent: '',
    value: '',
    innerHTML: '',
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    style: {},
    appendChild() {},
    remove() {},
    click() {},
    focus() {},
    select() {},
    scrollTop: 0,
    clientWidth: 360,
    clientHeight: 600,
    offsetWidth: 180,
    offsetHeight: 160,
    tagName: 'DIV',
    _listeners: {},
    addEventListener(t, fn) { (el._listeners[t] = el._listeners[t] || []).push(fn); },
    closest() { return null; },
    setAttribute() {}
  };
  return el;
}
function getEl(id) {
  if (id.indexOf('page-') === 0) return pageOf(id);
  if (!elements.has(id)) elements.set(id, makeEl(id));
  return elements.get(id);
}
function fire(el, type, event) {
  for (const fn of el._listeners[type] || []) fn(event || {});
}
function fireDoc(type, event) {
  for (const fn of docListeners[type] || []) fn(event || {});
}

const docListeners = {};
const documentStub = {
  getElementById: (id) => {
    if (!ids.has(id)) {
      console.error('✗ unknown id: ' + id);
      process.exitCode = 1;
    }
    return getEl(id);
  },
  querySelectorAll: (sel) => {
    if (sel === '.page') return pages;
    if (sel === '[data-close-sheet]') return ['sheet-schema-close'].map((id) => getEl(id));
    if (sel === '.sheet') return ['menu-sheet', 'sheet-schema', 'sheet-paste'].map((id) => getEl(id));
    if (sel === '#bottom-bar .bb-btn') return ['bb-raw', 'bb-share', 'bb-save', 'bb-copy', 'bb-open'].map((id) => getEl(id));
    return [];
  },
  querySelector: (sel) => {
    if (sel === 'meta[name="theme-color"]') return { setAttribute() {} };
    if (sel === '.error-actions') return getEl('error-box');
    return null;
  },
  documentElement: { setAttribute() {} },
  createElement: (tag) => makeEl('dyn-' + tag),
  body: { appendChild() {}, removeChild() {} },
  addEventListener: (t, fn) => { (docListeners[t] = docListeners[t] || []).push(fn); },
  hidden: false,
  activeElement: { tagName: 'BODY' }
};

const sandbox = {
  document: documentStub,
  navigator: {
    serviceWorker: {
      addEventListener() {},
      register: async () => ({ active: null }),
      getRegistration: async () => undefined,
      controller: null
    },
    clipboard: { writeText: async () => {}, readText: async () => '' }
  },
  location: { search: '', href: 'http://127.0.0.1:8787/', origin: 'http://127.0.0.1:8787' },
  URLSearchParams,
  console,
  setTimeout,
  clearTimeout,
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  fetch: async () => ({ ok: true, text: async () => SAMPLE }),
  Blob: function () {},
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  File: function () {},
  FileReader: function () { this.readAsText = () => {}; },
  JsonCore: require('../core.js'),
  scrollTo() {},
  innerWidth: 390,
  innerHeight: 800,
  matchMedia: () => ({ matches: false }),
  localStorage: (() => {
    const mem = {};
    return {
      getItem: (k) => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: (k) => { delete mem[k]; }
    };
  })(),
  addEventListener: (t, fn) => { (winListeners[t] = winListeners[t] || []).push(fn); }
};
const winListeners = {};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

(async () => {
  vm.runInContext(APP_SRC, sandbox, { filename: 'app.js' });
  for (const fn of winListeners.DOMContentLoaded || []) fn();
  console.log('App initialized');

  console.log('Load sample');
  fire(getEl('btn-sample'), 'click', {});
  await new Promise((r) => setTimeout(r, 100));
  ok(pageOf('page-viewer').active, 'viewer is active');
  ok(getEl('file-name').textContent === 'sample.json', 'file name = sample.json', getEl('file-name').textContent);
  ok(getEl('file-meta').textContent.indexOf('items') !== -1, 'meta includes item count', getEl('file-meta').textContent);
  const treeHtml = getEl('tree').innerHTML;
  ok(treeHtml.indexOf('&quot;app&quot;') !== -1 || treeHtml.indexOf('"app"') !== -1, 'key "app" rendered');
  ok(treeHtml.indexOf('JSON Opener') !== -1, 'value "JSON Opener" rendered');
  ok(getEl('tree').hidden === false && getEl('raw').hidden === true, 'tree visible, raw hidden');
  ok(getEl('view-table').hidden === false, 'table tab available for sample users array');
  ok(getEl('stats-bar').hidden === false, 'stats bar shown');
  ok(getEl('stats-bar').innerHTML.indexOf('obj') !== -1, 'stats include objects');

  console.log('Tree expand / collapse');
  const toggleIds = [...treeHtml.matchAll(/data-toggle="(c\d+)"/g)].map((m) => m[1]);
  ok(toggleIds.length >= 3, 'several container rows present (' + toggleIds.length + ')');
  const before = getEl('tree').innerHTML.length;
  const fakeToggleTarget = { closest: (sel) => (sel === '[data-toggle]' ? { dataset: { toggle: toggleIds[1] } } : null) };
  fire(getEl('tree'), 'click', { target: fakeToggleTarget });
  ok(getEl('tree').innerHTML.length > before, 'expand grows the tree (' + before + ' → ' + getEl('tree').innerHTML.length + ')');
  const expanded = getEl('tree').innerHTML;
  ok(expanded.indexOf('▾') !== -1, 'expanded row shows ▾');

  console.log('Search');
  fire(getEl('btn-search'), 'click', {});
  const inputEl = getEl('search-input');
  inputEl.value = 'Anna';
  fire(inputEl, 'input', { target: { value: 'Anna' } });
  await new Promise((r) => setTimeout(r, 300));
  const countText = getEl('search-count').textContent;
  ok(/^\d+\/\d+$/.test(countText), 'hit count shown (' + countText + ')');
  ok(getEl('tree').innerHTML.indexOf('match') !== -1, 'matching row highlighted');
  fire(getEl('search-close'), 'click', {});
  ok(getEl('search-box').hidden, 'search closed');

  console.log('Raw');
  fire(getEl('bb-raw'), 'click', {});
  ok(getEl('tree').hidden === true && getEl('raw').hidden === false, 'raw visible');
  ok(getEl('raw').innerHTML.indexOf('t-key') !== -1, 'raw highlighted');
  ok(getEl('bb-raw').textContent === 'Tree', 'button shows "Tree"');
  fire(getEl('bb-raw'), 'click', {});
  ok(getEl('tree').hidden === false, 'back to tree view');

  console.log('Table');
  fire(getEl('view-table'), 'click', {});
  ok(getEl('table-wrap').hidden === false, 'table visible');
  ok(getEl('table-view').innerHTML.indexOf('<th>') !== -1, 'table has headers');
  ok(getEl('table-view').innerHTML.indexOf('Anna') !== -1, 'table includes user name');
  fire(getEl('view-tree'), 'click', {});
  ok(getEl('tree').hidden === false, 'back to tree from table');

  console.log('Schema');
  fire(getEl('btn-schema'), 'click', {});
  ok(getEl('sheet-schema').hidden === false, 'schema sheet open');
  ok(getEl('schema-output').textContent.indexOf('$') === 0, 'schema starts at $');
  ok(getEl('schema-output').textContent.indexOf('→') !== -1, 'schema includes types');
  fireDoc('keydown', { key: 'Escape' });
  ok(getEl('sheet-schema').hidden === true, 'Escape closes schema');

  console.log('Menu');
  fire(getEl('btn-menu'), 'click', {});
  ok(getEl('menu-sheet').hidden === false, 'menu open');
  fire(getEl('menu-info'), 'click', {});
  ok(pageOf('page-info').active, 'info page active');
  ok(getEl('menu-sheet').hidden === true, 'menu closed after choice');
  fire(getEl('btn-back'), 'click', {});
  ok(pageOf('page-home').active, 'back to home');
  ok(getEl('recent-wrap').hidden === false, 'recent files shown after opening sample');

  console.log('\nAll ' + passed + ' functional tests passed.');
})().catch((err) => { console.error(err); process.exit(1); });
