'use strict';

/* JSON Opener – UI logic */
(function () {
  const $ = (id) => document.getElementById(id);
  const {
    JsonTree, schemaLines, escapeHtml, countNodes,
    collectStats, findTable, errorContext, isProbablyUrl
  } = window.JsonCore;

  const ROW_H = 21;
  const CHAR_W = 8.1;
  const RECENT_KEY = 'json-opener-recents';
  const THEME_KEY = 'json-opener-theme';
  const RECENT_MAX = 8;
  const RECENT_MAX_BYTES = 120000;

  const state = {
    data: null,
    fileName: 'file.json',
    fileSize: 0,
    pretty: '',
    view: 'tree',
    tree: null,
    lastHandledKey: '',
    lastHandledAt: 0,
    deferredPrompt: null,
    minified: false,
    ctxRow: -1
  };

  /* -------------------------------------------------------------
   * Utilities
   * ----------------------------------------------------------- */
  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 2200);
  }

  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, val) {
    try { localStorage.setItem(key, val); } catch (e) { /* quota / private mode */ }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        return true;
      } catch (e2) {
        return false;
      }
    }
  }

  function downloadFile(name, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function showLoading(show) {
    $('loading').hidden = !show;
  }

  function cellDisplay(v) {
    if (v === undefined) return '';
    if (v === null) return 'null';
    if (typeof v === 'object') return Array.isArray(v) ? '[…]' : '{…}';
    return String(v);
  }

  function cellCopy(v) {
    if (v === undefined) return '';
    if (v === null) return 'null';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  /* -------------------------------------------------------------
   * Theme
   * ----------------------------------------------------------- */
  function currentTheme() {
    const saved = storageGet(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
    try {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
    } catch (e) { /* ignore */ }
    return 'dark';
  }

  function applyTheme(theme) {
    const t = theme === 'light' ? 'light' : 'dark';
    if (document.documentElement && document.documentElement.setAttribute) {
      document.documentElement.setAttribute('data-theme', t);
    }
    const meta = document.querySelector && document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'light' ? '#eef2f7' : '#0b1220');
  }

  function toggleTheme() {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    storageSet(THEME_KEY, next);
    applyTheme(next);
  }

  /* -------------------------------------------------------------
   * Page navigation
   * ----------------------------------------------------------- */
  function setPage(page) {
    document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
    $('page-' + page).classList.add('active');
    $('btn-back').hidden = page === 'home';
    $('bottom-bar').hidden = page !== 'viewer';
    if (page === 'viewer') updateViewButtons();
  }

  function showHome() {
    setPage('home');
    $('btn-search').hidden = true;
    $('btn-menu').hidden = false;
    renderRecents();
  }

  function showViewer() {
    setPage('viewer');
    $('btn-search').hidden = false;
    $('btn-menu').hidden = false;
    if (state.view === 'raw' || !state.tree) {
      setView(state.view === 'table' ? 'table' : 'raw');
    } else if (state.view === 'table') {
      setView('table');
    } else {
      state.tree.el = $('tree');
      buildOffsets(state.tree);
      renderTree();
      setView('tree');
    }
    if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
  }

  function showInfo() {
    setPage('info');
    $('btn-search').hidden = true;
    $('btn-menu').hidden = false;
  }

  /* -------------------------------------------------------------
   * Recents
   * ----------------------------------------------------------- */
  function loadRecents() {
    try { return JSON.parse(storageGet(RECENT_KEY) || '[]') || []; }
    catch (e) { return []; }
  }

  function saveRecent(name, text, size) {
    if (!text || text.length > RECENT_MAX_BYTES) return;
    const list = loadRecents().filter((r) => r.name !== name || r.text !== text);
    list.unshift({ name: name, text: text, size: size || text.length, ts: Date.now() });
    storageSet(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  }

  function timeAgo(ts) {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 45) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60);
    if (h < 24) return h + 'h ago';
    const d = Math.round(h / 24);
    return d + 'd ago';
  }

  function renderRecents() {
    const wrap = $('recent-wrap');
    const listEl = $('recent-list');
    if (!wrap || !listEl) return;
    const list = loadRecents();
    if (!list.length) { wrap.hidden = true; listEl.innerHTML = ''; return; }
    wrap.hidden = false;
    listEl.innerHTML = list.map((r, i) =>
      '<button class="recent-item" data-recent="' + i + '">' +
        '<span class="recent-glyph">{ }</span>' +
        '<span><span class="recent-name">' + escapeHtml(r.name || 'file.json') + '</span>' +
        '<span class="recent-meta">' + fmtBytes(r.size || 0) + ' · ' + timeAgo(r.ts || 0) + '</span></span>' +
      '</button>'
    ).join('');
  }

  /* -------------------------------------------------------------
   * Open files
   * ----------------------------------------------------------- */
  async function readFileText(file) {
    if (typeof file.text === 'function') return file.text();
    if (typeof file.getText === 'function') return file.getText();
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsText(file);
    });
  }

  async function openFile(file) {
    if (!file) return;
    const name = file.name || 'file.json';
    try {
      showLoading(true);
      const text = await readFileText(file);
      loadData(text, name, file.size);
    } catch (err) {
      showError('Could not read file', String(err && err.message || err));
    } finally {
      showLoading(false);
    }
  }

  function loadData(text, name, size) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      showParseError(err, text, name);
      return;
    }
    state.data = data;
    state.fileName = name;
    state.fileSize = size || text.length;
    state.pretty = JSON.stringify(data, null, 2);
    state.minified = false;
    state.view = 'tree';

    const budget = { n: 200001 };
    const nodes = countNodes(data, budget);
    const entries = budget.n <= 0 ? '>200,000' : String(nodes - 1);
    $('file-name').textContent = name;
    $('file-meta').textContent = `${fmtBytes(state.fileSize)} · ${entries} items`;

    renderStats(data);
    const table = findTable(data);
    if ($('view-table')) $('view-table').hidden = !table;

    buildTree(data);
    renderRaw();
    if (table) renderTable();
    showViewer();
    $('error-box').hidden = true;
    saveRecent(name, text, state.fileSize);
    if (state.fileSize > 20 * 1024 * 1024) {
      toast('Very large file — this may take a moment');
    }
  }

  function renderStats(data) {
    const bar = $('stats-bar');
    if (!bar || !collectStats) return;
    const s = collectStats(data);
    bar.hidden = false;
    bar.innerHTML =
      chip('depth ' + s.maxDepth) +
      chip(s.objects + ' obj') +
      chip(s.arrays + ' arr') +
      chip(s.strings + ' str') +
      chip(s.numbers + ' num') +
      chip(s.booleans + ' bool') +
      (s.nulls ? chip(s.nulls + ' null') : '');
    function chip(t) { return '<span class="stat-chip">' + t + '</span>'; }
  }

  function showParseError(err, text, name) {
    state.data = null;
    const ctx = errorContext ? errorContext(text, err.message) : { line: 0, col: 0, snippet: '' };
    const loc = ctx.line ? ` (line ${ctx.line}, column ${ctx.col})` : '';
    $('error-title').textContent = 'Invalid JSON';
    $('error-msg').textContent = 'This file is not valid JSON: ' + err.message + loc;
    const sn = $('error-snippet');
    if (sn) {
      if (ctx.snippet) {
        sn.hidden = false;
        sn.textContent = ctx.snippet;
      } else {
        sn.hidden = true;
      }
    }
    $('error-box').hidden = false;
    let btn = $('btn-view-as-text');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'btn-view-as-text';
      btn.className = 'btn ghost';
      btn.textContent = 'View as text anyway';
      btn.addEventListener('click', () => {
        state.data = null;
        state.fileName = name;
        state.fileSize = text.length;
        state.pretty = text;
        state.view = 'raw';
        $('file-name').textContent = name;
        $('file-meta').textContent = fmtBytes(text.length) + ' · Text';
        $('tree').hidden = true;
        $('raw').hidden = false;
        if ($('table-wrap')) $('table-wrap').hidden = true;
        if ($('stats-bar')) $('stats-bar').hidden = true;
        if ($('view-table')) $('view-table').hidden = true;
        renderRaw();
        showViewer();
      });
      const actions = document.querySelector && document.querySelector('.error-actions');
      (actions || $('error-box')).appendChild(btn);
    }
    showHome();
  }

  function showError(title, msg) {
    state.data = null;
    const t = $('error-title');
    t.textContent = title;
    $('error-msg').textContent = msg;
    const sn = $('error-snippet');
    if (sn) sn.hidden = true;
    $('error-box').hidden = false;
    showHome();
  }

  async function loadURL(url) {
    showLoading(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      loadData(text, url.split('/').pop() || 'file.json', text.length);
    } catch (err) {
      showError('Could not load link', String(err.message || err));
    } finally {
      showLoading(false);
    }
  }

  /* -------------------------------------------------------------
   * Tree view (virtualized)
   * ----------------------------------------------------------- */
  function buildTree(data) {
    const tree = new JsonTree(data);
    tree.el = $('tree');
    tree.offsets = null;
    tree.heights = null;
    tree.cpl = 0;
    tree.totalH = 0;
    tree.matchSet = new Set();
    tree.matchList = [];
    tree.matchIdx = -1;
    tree.curIdx = -1;
    state.tree = tree;
    $('raw').hidden = true;
    $('tree').hidden = false;
    if ($('table-wrap')) $('table-wrap').hidden = true;
    buildOffsets(tree);
  }

  function buildOffsets(tree) {
    const el = tree.el;
    const cpl = Math.max(20, Math.floor(((el.clientWidth || 360) - 36) / CHAR_W));
    tree.cpl = cpl;
    const n = tree.rows.length;
    const heights = new Array(n);
    const offsets = new Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const lines = rowLines(tree.rows[i], cpl);
      heights[i] = lines;
      offsets[i] = acc;
      acc += lines * ROW_H;
    }
    tree.heights = heights;
    tree.offsets = offsets;
    tree.totalH = acc;
  }

  function rowLines(r, cpl) {
    let chars;
    if (r.type === 'open') {
      chars = 20 + (r.key ? r.key.length + 2 : 0) + 4 + labelLen(r) + 2;
    } else if (r.type === 'close') {
      chars = 21;
    } else {
      chars = 20 + (r.key ? r.key.length + 2 : 0) + valueDispLen(r);
    }
    return Math.max(1, Math.ceil(chars / cpl));
  }

  function labelLen(r) {
    const n = r.count;
    const word = r.kind === 'object' ? (n === 1 ? 3 : 4) : (n === 1 ? 4 : 5);
    return String(n).length + 1 + word;
  }

  function valueDispLen(r) {
    if (r.emptyKind) return 3;
    const v = r.value;
    if (v === null) return 4;
    const t = typeof v;
    if (t === 'string') return Math.min(v.length, 400) + 3;
    return String(v).length;
  }

  function renderTree() {
    const tree = state.tree;
    if (!tree) return;
    const el = tree.el;
    const total = tree.rows.length;
    if (!total) { el.innerHTML = ''; return; }
    if (!tree.offsets) buildOffsets(tree);

    const scrollTop = el.scrollTop;
    const viewH = el.clientHeight || 600;
    let lo = 0, hi = total;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tree.offsets[mid] < scrollTop) lo = mid + 1; else hi = mid;
    }
    let start = Math.max(0, lo - 24);
    let end = lo;
    while (end < total && tree.offsets[end] < scrollTop + viewH) end++;
    end = Math.min(total, end + 24);

    let html = '<div style="height:' + tree.offsets[start] + 'px"></div>';
    for (let i = start; i < end; i++) {
      html += rowHTML(tree.rows[i], i, tree);
    }
    const lastEnd = tree.offsets[end - 1] + tree.heights[end - 1] * ROW_H;
    html += '<div style="height:' + Math.max(0, tree.totalH - lastEnd) + 'px"></div>';
    el.innerHTML = html;
    updatePathBar();
  }

  function rowHTML(r, i, tree) {
    const pad = r.depth >= 0 ? r.depth * 18 : 0;
    let cls = 'node-line';
    if (tree.matchSet && tree.matchSet.size && tree.matchSet.has(i)) cls += ' match';
    if (tree.curIdx === i) cls += ' focused';
    const style = 'padding-left:' + (pad + 6) + 'px';
    const keyHTML = r.key
      ? '<span class="t-key">' + escapeHtml(r.key) + '</span><span class="t-colon">: </span>'
      : '';

    if (r.type === 'open') {
      const open = tree.open.has(r.id);
      const label = r.preview || (r.count === 1
        ? (r.kind === 'object' ? '1 key' : '1 item')
        : r.count + (r.kind === 'object' ? ' keys' : ' items'));
      return '<div class="' + cls + '" style="' + style + '" data-i="' + i + '" data-toggle="' + r.id + '" role="button" aria-expanded="' + open + '">' +
        '<span class="twisty">' + (open ? '▾' : '▸') + '</span>' +
        keyHTML +
        '<span class="t-brace">' + (r.kind === 'object' ? '{' : '[') + '</span>' +
        '<span class="t-ellipsis"> ' + label + '</span>' +
        '<span class="t-brace">' + (r.kind === 'object' ? '}' : ']') + '</span></div>';
    }
    if (r.type === 'close') {
      return '<div class="' + cls + '" style="' + style + '" data-i="' + i + '">' +
        '<span class="twisty empty"></span>' +
        '<span class="t-brace">' + (r.kind === 'object' ? '}' : ']') + '</span></div>';
    }
    return '<div class="' + cls + '" style="' + style + '" data-i="' + i + '" data-copy="1" title="Tap to copy">' +
      '<span class="twisty empty"></span>' +
      keyHTML +
      scalarHTML(r) + '</div>';
  }

  function scalarHTML(r) {
    const v = r.value;
    if (r.emptyKind) {
      return '<span class="t-brace">' + (r.emptyKind === 'object' ? '{ }' : '[ ]') + '</span>';
    }
    if (v === null) return '<span class="t-null">null</span>';
    const t = typeof v;
    if (t === 'boolean') return '<span class="t-bool">' + v + '</span>';
    if (t === 'number') return '<span class="t-num">' + v + '</span>';
    const shown = escapeHtml(v.length > 400 ? v.slice(0, 400) + '\u2026' : v);
    if (isProbablyUrl && isProbablyUrl(v)) {
      return '<a class="t-link t-str" href="' + escapeHtml(v) + '" target="_blank" rel="noopener">"' + shown + '"</a>';
    }
    return '<span class="t-str">"' + shown + '"</span>';
  }

  function toggleNode(id) {
    const tree = state.tree;
    if (!tree) return;
    tree.toggle(id);
    buildOffsets(tree);
    renderTree();
  }

  function scrollToRow(tree, i) {
    tree.curIdx = i;
    tree.el.scrollTop = Math.max(0, tree.offsets[i] - tree.el.clientHeight / 3);
    renderTree();
  }

  function updatePathBar() {
    const bar = $('path-bar');
    if (!bar) return;
    const tree = state.tree;
    const row = tree && tree.rows[tree.curIdx];
    if (!row || !row.path) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.textContent = row.path;
  }

  function expandAll() {
    const tree = state.tree;
    if (!tree) { toast('No file loaded'); return; }
    tree.expandAll(25000);
    buildOffsets(tree);
    renderTree();
    toast('Expanded');
  }

  function collapseAll() {
    const tree = state.tree;
    if (!tree) { toast('No file loaded'); return; }
    tree.collapseAll();
    buildOffsets(tree);
    renderTree();
    toast('Collapsed');
  }

  /* -------------------------------------------------------------
   * Raw view
   * ----------------------------------------------------------- */
  const TOKEN_RE = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

  function highlightJSON(text) {
    let out = '';
    let last = 0;
    TOKEN_RE.lastIndex = 0;
    let m;
    while ((m = TOKEN_RE.exec(text))) {
      out += escapeHtml(text.slice(last, m.index));
      if (m[1] !== undefined) {
        if (m[2] !== undefined) {
          out += '<span class="t-key">' + escapeHtml(m[1]) + '</span><span class="t-colon">:</span>';
        } else {
          out += '<span class="t-str">' + escapeHtml(m[1]) + '</span>';
        }
      } else if (m[3] !== undefined) {
        const cls = m[3] === 'null' ? 't-null' : 't-bool';
        out += '<span class="' + cls + '">' + m[3] + '</span>';
      } else {
        out += '<span class="t-num">' + m[0] + '</span>';
      }
      last = m.index + m[0].length;
    }
    out += escapeHtml(text.slice(last));
    return out;
  }

  function rawText() {
    if (state.minified && state.data !== null && state.data !== undefined) {
      try { return JSON.stringify(state.data); } catch (e) { return state.pretty; }
    }
    return state.pretty || '';
  }

  function renderRaw() {
    $('raw').innerHTML = state.pretty ? highlightJSON(rawText()) : '';
  }

  function setView(view) {
    if (view === 'table' && $('view-table') && $('view-table').hidden) view = 'tree';
    state.view = view;
    $('tree').hidden = view !== 'tree';
    $('raw').hidden = view !== 'raw';
    if ($('table-wrap')) $('table-wrap').hidden = view !== 'table';
    if ($('btn-pretty')) $('btn-pretty').hidden = view !== 'raw';
    if ($('btn-expand')) $('btn-expand').hidden = view !== 'tree';
    if ($('btn-collapse')) $('btn-collapse').hidden = view !== 'tree';
    ['tree', 'raw', 'table'].forEach((v) => {
      const el = $('view-' + v);
      if (!el) return;
      const on = view === v;
      if (on) el.classList.add('active');
      else el.classList.remove('active');
      if (typeof el.setAttribute === 'function') el.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (view === 'raw') renderRaw();
    if (view === 'table') renderTable();
    updateViewButtons();
  }

  function updateViewButtons() {
    const rawBtn = $('bb-raw');
    if (state.view === 'tree') {
      rawBtn.textContent = 'Raw';
      rawBtn.dataset.icon = '{ }';
    } else {
      rawBtn.textContent = 'Tree';
      rawBtn.dataset.icon = '☰';
    }
    document.querySelectorAll('#bottom-bar .bb-btn').forEach((b) => b.classList.remove('active'));
  }

  /* -------------------------------------------------------------
   * Table view
   * ----------------------------------------------------------- */
  function renderTable() {
    const wrap = $('table-wrap');
    const table = $('table-view');
    const cap = $('table-caption');
    if (!wrap || !table) return;
    const found = findTable && findTable(state.data);
    if (!found) {
      if (cap) cap.textContent = 'No tabular array found in this document.';
      table.innerHTML = '';
      return;
    }
    const t = found.table;
    if (cap) cap.textContent = found.path + '  ·  ' + t.rows.length + ' rows × ' + t.columns.length + ' columns  ·  tap a cell to copy';
    let html = '<thead><tr><th class="row-num">#</th>';
    for (let c = 0; c < t.columns.length; c++) html += '<th>' + escapeHtml(t.columns[c]) + '</th>';
    html += '</tr></thead><tbody>';
    const max = Math.min(t.rows.length, 2000);
    for (let i = 0; i < max; i++) {
      html += '<tr><td class="row-num">' + i + '</td>';
      for (let c = 0; c < t.columns.length; c++) {
        const v = t.rows[i][t.columns[c]];
        html += '<td data-r="' + i + '" data-c="' + c + '">' + escapeHtml(cellDisplay(v)) + '</td>';
      }
      html += '</tr>';
    }
    html += '</tbody>';
    table.innerHTML = html;
    table._data = t;
  }

  /* -------------------------------------------------------------
   * Search
   * ----------------------------------------------------------- */
  function openSearch() {
    const box = $('search-box');
    box.hidden = false;
    const input = $('search-input');
    input.value = '';
    input.focus();
    runSearch('');
  }

  function closeSearch() {
    $('search-box').hidden = true;
    if (state.tree) {
      state.tree.matchSet = new Set();
      state.tree.matchList = [];
      state.tree.matchIdx = -1;
      renderTree();
    }
  }

  function runSearch(needle) {
    const tree = state.tree;
    if (!tree) return;
    const res = tree.matches(needle);
    tree.matchSet = res.set;
    tree.matchList = res.list;
    tree.matchIdx = res.list.length ? 0 : -1;
    $('search-count').textContent = res.list.length ? '1/' + res.list.length : 'No matches';
    if (tree.matchIdx >= 0) jumpToMatch(tree, 0);
    else renderTree();
  }

  function jumpToMatch(tree, rel) {
    const n = tree.matchList.length;
    if (!n) return;
    tree.matchIdx = (tree.matchIdx + rel + n) % n;
    let idx = tree.matchList[tree.matchIdx];
    let row = tree.rows[idx];

    if (row.type === 'open' && !tree.open.has(row.id)) {
      const id = row.id;
      toggleNode(id);
      const res = tree.matches($('search-input').value);
      tree.matchSet = res.set;
      tree.matchList = res.list;
      tree.matchIdx = -1;
      const openIdx = tree.rows.findIndex((r) => r.type === 'open' && r.id === id);
      if (openIdx >= 0) {
        const ranges = tree.ranges();
        const rng = ranges.get(id);
        const closeIdx = rng ? rng.ci : openIdx;
        let target = openIdx;
        for (const m of tree.matchList) {
          if (m > openIdx && m <= closeIdx) { target = m; break; }
        }
        idx = target;
        tree.matchIdx = tree.matchList.indexOf(idx);
        if (tree.matchIdx < 0) tree.matchIdx = 0;
      }
    }
    scrollToRow(tree, idx);
    $('search-count').textContent = (tree.matchIdx + 1) + '/' + tree.matchList.length;
  }

  /* -------------------------------------------------------------
   * Schema
   * ----------------------------------------------------------- */
  function openSchema() {
    if (!state.data) return;
    const out = [];
    schemaLines(state.data, '$', out, 0);
    $('schema-output').textContent = out.join('\n');
    openSheet('sheet-schema');
  }

  /* -------------------------------------------------------------
   * Context menu
   * ----------------------------------------------------------- */
  function hideCtx() {
    const m = $('ctx-menu');
    if (m) m.hidden = true;
    state.ctxRow = -1;
  }

  function openCtx(i, x, y) {
    const tree = state.tree;
    if (!tree || !tree.rows[i]) return;
    state.ctxRow = i;
    tree.curIdx = i;
    const menu = $('ctx-menu');
    if (!menu) return;
    const row = tree.rows[i];
    const expandBtn = $('ctx-expand');
    if (expandBtn) expandBtn.hidden = row.type !== 'open';
    menu.hidden = false;
    const pad = 8;
    const w = menu.offsetWidth || 180;
    const h = menu.offsetHeight || 160;
    const vw = window.innerWidth || 360;
    const vh = window.innerHeight || 640;
    menu.style.left = Math.max(pad, Math.min(x, vw - w - pad)) + 'px';
    menu.style.top = Math.max(pad, Math.min(y, vh - h - pad)) + 'px';
    renderTree();
  }

  function rowCopyValue(row) {
    if (!row) return '';
    if (row.type === 'value') {
      if (row.emptyKind) return row.emptyKind === 'object' ? '{}' : '[]';
      if (row.value === null) return 'null';
      return typeof row.value === 'string' ? row.value : String(row.value);
    }
    if (row.id && state.tree) {
      const val = state.tree.valueOf(row.id);
      try { return JSON.stringify(val, null, 2); } catch (e) { return ''; }
    }
    return '';
  }

  function rowCopyJson(row) {
    if (!row) return '';
    if (row.type === 'value') {
      if (row.emptyKind) return row.emptyKind === 'object' ? '{}' : '[]';
      try { return JSON.stringify(row.value, null, 2); } catch (e) { return String(row.value); }
    }
    if (row.id && state.tree) {
      const val = state.tree.valueOf(row.id);
      try { return JSON.stringify(val, null, 2); } catch (e) { return ''; }
    }
    return '';
  }

  async function ctxAction(kind) {
    const tree = state.tree;
    const row = tree && tree.rows[state.ctxRow];
    hideCtx();
    if (!row) return;
    if (kind === 'value') {
      const ok = await copyText(rowCopyValue(row));
      toast(ok ? 'Copied value' : 'Copy failed');
    } else if (kind === 'path') {
      const ok = await copyText(row.path || '$');
      toast(ok ? 'Copied ' + (row.path || '$') : 'Copy failed');
    } else if (kind === 'json') {
      const ok = await copyText(rowCopyJson(row));
      toast(ok ? 'Copied JSON' : 'Copy failed');
    } else if (kind === 'expand' && row.type === 'open' && !tree.open.has(row.id)) {
      toggleNode(row.id);
    }
  }

  /* -------------------------------------------------------------
   * Actions: share / save / copy
   * ----------------------------------------------------------- */
  async function shareFile() {
    if (!state.pretty) { toast('No file loaded'); return; }
    const file = new File([state.pretty], state.fileName || 'file.json', { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: state.fileName });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    downloadFile(state.fileName || 'file.json', state.pretty, 'application/json');
    toast('File saved');
  }

  function saveFile() {
    if (!state.pretty) { toast('No file loaded'); return; }
    downloadFile(state.fileName || 'file.json', state.pretty, 'application/json');
    toast('File saved');
  }

  async function copyAll() {
    if (!state.pretty) { toast('No file loaded'); return; }
    const ok = await copyText(rawText());
    toast(ok ? 'Copied' : 'Copy failed');
  }

  /* -------------------------------------------------------------
   * Sheets
   * ----------------------------------------------------------- */
  function openSheet(id) {
    const sheet = $(id);
    sheet.hidden = false;
  }

  function closeSheets() {
    document.querySelectorAll('.sheet').forEach((s) => { s.hidden = true; });
    hideCtx();
  }

  function closeMenu() {
    $('menu-sheet').hidden = true;
  }

  function openPaste() {
    closeSheets();
    const ta = $('paste-input');
    if (ta) ta.value = '';
    openSheet('sheet-paste');
    if (ta && ta.focus) setTimeout(() => ta.focus(), 50);
    /* Try clipboard read — ignore if permission is denied */
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then((t) => {
        if (t && ta && !ta.value) ta.value = t;
      }).catch(() => {});
    }
  }

  function submitPaste() {
    const ta = $('paste-input');
    const text = (ta && ta.value || '').trim();
    closeSheets();
    if (!text) { toast('Nothing to paste'); return; }
    loadData(text, 'pasted.json', text.length);
  }

  /* -------------------------------------------------------------
   * Install (PWA)
   * ----------------------------------------------------------- */
  function updateInstallUI() {
    const show = !!state.deferredPrompt;
    $('btn-install').hidden = !show;
    $('menu-install').hidden = !show;
  }

  async function promptInstall() {
    if (!state.deferredPrompt) return;
    const prompt = state.deferredPrompt;
    state.deferredPrompt = null;
    updateInstallUI();
    try {
      prompt.prompt();
      await prompt.userChoice;
    } catch (e) { /* dismissed */ }
  }

  /* -------------------------------------------------------------
   * Share Target (file shared from Android)
   * ----------------------------------------------------------- */
  function shareKey(entry) {
    const f = entry.files && entry.files[0];
    if (f) return (f.name || '') + ':' + (f.size || 0);
    return 'text:' + String(entry.text || entry.url || '').slice(0, 64);
  }

  async function handleShared(entry) {
    if (!entry) return;
    const key = shareKey(entry);
    if (key === state.lastHandledKey && Date.now() - state.lastHandledAt < 5000) return;
    state.lastHandledKey = key;
    state.lastHandledAt = Date.now();

    const files = entry.files || [];
    if (files.length) {
      await openFile(files[0]);
      return;
    }
    const text = (entry.text || '').trim();
    if (text) {
      if (/^https?:\/\//i.test(text)) {
        await loadURL(text);
      } else {
        try {
          JSON.parse(text);
          loadData(text, entry.title || 'shared.json', text.length);
        } catch (e) {
          loadDataSafeText(text, entry.title || 'shared.json');
        }
      }
      return;
    }
    if (entry.url) await loadURL(entry.url);
  }

  function loadDataSafeText(text, name) {
    state.data = null;
    state.fileName = name;
    state.fileSize = text.length;
    state.pretty = text;
    state.view = 'raw';
    $('file-name').textContent = name;
    $('file-meta').textContent = fmtBytes(text.length) + ' · Text';
    $('tree').hidden = true;
    $('raw').hidden = false;
    if ($('table-wrap')) $('table-wrap').hidden = true;
    renderRaw();
    showViewer();
  }

  function queryShare() {
    if (!navigator.serviceWorker) return;
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (reg && reg.active) reg.active.postMessage({ type: 'QUERY_SHARE' });
    }).catch(() => {});
  }

  function isTypingTarget(el) {
    if (!el || !el.tagName) return false;
    return /input|textarea/i.test(el.tagName) || el.isContentEditable;
  }

  /* -------------------------------------------------------------
   * UI wiring
   * ----------------------------------------------------------- */
  function wireUI() {
    $('btn-pick').addEventListener('click', () => $('file-input').click());
    $('file-input').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) openFile(f);
      e.target.value = '';
    });
    $('btn-sample').addEventListener('click', async () => {
      try {
        const res = await fetch('./sample.json');
        const text = await res.text();
        loadData(text, 'sample.json', text.length);
      } catch (e) {
        showError('Could not load sample', String(e.message || e));
      }
    });
    $('btn-error-dismiss').addEventListener('click', () => { $('error-box').hidden = true; });
    if ($('btn-paste')) $('btn-paste').addEventListener('click', openPaste);
    if ($('btn-paste-open')) $('btn-paste-open').addEventListener('click', submitPaste);
    if ($('btn-clear-recent')) $('btn-clear-recent').addEventListener('click', () => {
      storageSet(RECENT_KEY, '[]');
      renderRecents();
    });
    if ($('recent-list')) $('recent-list').addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('[data-recent]');
      if (!btn) return;
      const rec = loadRecents()[+btn.dataset.recent];
      if (rec && rec.text) loadData(rec.text, rec.name, rec.size);
    });

    const dz = $('dropzone');
    dz.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('button')) return;
      $('file-input').click();
    });
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.add('dragover');
    }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.remove('dragover');
    }));
    dz.addEventListener('drop', (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) { openFile(f); return; }
      const text = e.dataTransfer && e.dataTransfer.getData && e.dataTransfer.getData('text/plain');
      if (text && text.trim()) loadData(text.trim(), 'dropped.json', text.length);
    });

    $('btn-back').addEventListener('click', showHome);
    $('btn-menu').addEventListener('click', () => openSheet('menu-sheet'));
    $('btn-info-home').addEventListener('click', showHome);
    if ($('btn-theme')) $('btn-theme').addEventListener('click', toggleTheme);

    $('bb-raw').addEventListener('click', () => setView(state.view === 'tree' ? 'raw' : 'tree'));
    $('bb-share').addEventListener('click', shareFile);
    $('bb-save').addEventListener('click', saveFile);
    $('bb-copy').addEventListener('click', copyAll);
    $('bb-open').addEventListener('click', () => $('file-input').click());

    if ($('view-tree')) $('view-tree').addEventListener('click', () => setView('tree'));
    if ($('view-raw')) $('view-raw').addEventListener('click', () => setView('raw'));
    if ($('view-table')) $('view-table').addEventListener('click', () => setView('table'));
    if ($('btn-expand')) $('btn-expand').addEventListener('click', expandAll);
    if ($('btn-collapse')) $('btn-collapse').addEventListener('click', collapseAll);
    if ($('btn-pretty')) $('btn-pretty').addEventListener('click', () => {
      state.minified = !state.minified;
      $('btn-pretty').textContent = state.minified ? 'Minified' : 'Pretty';
      renderRaw();
    });
    if ($('path-bar')) $('path-bar').addEventListener('click', async () => {
      const t = $('path-bar').textContent;
      if (!t) return;
      const ok = await copyText(t);
      toast(ok ? 'Copied ' + t : 'Copy failed');
    });

    $('menu-open').addEventListener('click', () => { closeMenu(); $('file-input').click(); });
    if ($('menu-paste')) $('menu-paste').addEventListener('click', () => { closeMenu(); openPaste(); });
    $('menu-raw').addEventListener('click', () => { closeMenu(); setView(state.view === 'tree' ? 'raw' : 'tree'); });
    if ($('menu-expand')) $('menu-expand').addEventListener('click', () => { closeMenu(); expandAll(); });
    if ($('menu-collapse')) $('menu-collapse').addEventListener('click', () => { closeMenu(); collapseAll(); });
    $('menu-share').addEventListener('click', () => { closeMenu(); shareFile(); });
    $('menu-save').addEventListener('click', () => { closeMenu(); saveFile(); });
    $('menu-copy').addEventListener('click', () => { closeMenu(); copyAll(); });
    $('menu-info').addEventListener('click', () => { closeMenu(); showInfo(); });
    $('menu-install').addEventListener('click', () => { closeMenu(); promptInstall(); });

    $('btn-schema').addEventListener('click', openSchema);

    $('btn-search').addEventListener('click', openSearch);
    $('search-close').addEventListener('click', closeSearch);
    $('search-next').addEventListener('click', () => { if (state.tree) jumpToMatch(state.tree, 1); });
    $('search-prev').addEventListener('click', () => { if (state.tree) jumpToMatch(state.tree, -1); });
    let debounce = null;
    $('search-input').addEventListener('input', (e) => {
      clearTimeout(debounce);
      const v = e.target.value;
      debounce = setTimeout(() => runSearch(v), 120);
    });
    $('search-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        jumpToMatch(state.tree, e.shiftKey ? -1 : 1);
      }
      if (e.key === 'Escape') { closeSearch(); }
      e.stopPropagation();
    });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        openSearch();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key && e.key.toLowerCase() === 'v' && !isTypingTarget(document.activeElement)) {
        const home = $('page-home');
        if (home && home.classList && (home.active || (home.classList.contains && home.classList.contains('active')))) {
          openPaste();
        }
        return;
      }
      if (e.key === 'Escape') {
        if (!$('search-box').hidden) { closeSearch(); return; }
        hideCtx();
        closeSheets();
        return;
      }
      if (isTypingTarget(document.activeElement)) return;
      if (e.key === '/') { openSearch(); return; }
      if (e.key === '?') { showInfo(); return; }
      if ($('page-viewer') && $('page-viewer').classList &&
          ($('page-viewer').active || ($('page-viewer').classList.contains && $('page-viewer').classList.contains('active')))) {
        if (e.key === 't' || e.key === 'T') setView('tree');
        else if (e.key === 'r' || e.key === 'R') setView('raw');
        else if (e.key === 'l' || e.key === 'L') setView('table');
        else if (e.key === 'e' || e.key === 'E') expandAll();
        else if (e.key === 'c' || e.key === 'C') collapseAll();
      }
    });

    const treeEl = $('tree');
    treeEl.addEventListener('click', (e) => {
      if (state._ctxOpened) { state._ctxOpened = false; return; }
      if (e.target.closest && e.target.closest('a')) return;
      const t = e.target.closest('[data-toggle]');
      if (t) { toggleNode(t.dataset.toggle); return; }
      const c = e.target.closest('[data-copy]');
      if (c) {
        const i = +c.dataset.i;
        const tree = state.tree;
        if (tree && tree.rows[i]) {
          const row = tree.rows[i];
          tree.curIdx = i;
          const v = row.value;
          const label = v === null ? 'null' : typeof v === 'string' ? v : String(v);
          copyText(String(v)).then((ok) => toast(ok ? 'Copied: ' + label.slice(0, 40) : 'Copy failed'));
          updatePathBar();
          renderTree();
        }
      } else {
        const rowEl = e.target.closest('[data-i]');
        if (rowEl && state.tree) {
          state.tree.curIdx = +rowEl.dataset.i;
          renderTree();
        }
      }
    });
    treeEl.addEventListener('contextmenu', (e) => {
      const row = e.target.closest && e.target.closest('[data-i]');
      if (!row) return;
      e.preventDefault();
      openCtx(+row.dataset.i, e.clientX, e.clientY);
    });
    let pressTimer = null, pressX = 0, pressY = 0, pressIdx = -1;
    treeEl.addEventListener('pointerdown', (e) => {
      const row = e.target.closest && e.target.closest('[data-i]');
      if (!row) return;
      pressIdx = +row.dataset.i;
      pressX = e.clientX; pressY = e.clientY;
      pressTimer = setTimeout(() => {
        state._ctxOpened = true;
        openCtx(pressIdx, pressX, pressY);
      }, 500);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => {
      treeEl.addEventListener(ev, () => { clearTimeout(pressTimer); });
    });
    treeEl.addEventListener('pointermove', (e) => {
      if (Math.abs(e.clientX - pressX) > 10 || Math.abs(e.clientY - pressY) > 10) clearTimeout(pressTimer);
    });
    treeEl.addEventListener('scroll', () => {
      hideCtx();
      if (state._scrollRaf) return;
      state._scrollRaf = requestAnimationFrame(() => {
        state._scrollRaf = null;
        renderTree();
      });
    });
    treeEl.addEventListener('keydown', (e) => {
      const tree = state.tree;
      if (!tree || !tree.rows.length) return;
      const key = e.key;
      const n = tree.rows.length;
      if (key === 'ArrowDown') { e.preventDefault(); scrollToRow(tree, Math.min(n - 1, tree.curIdx + 1)); }
      else if (key === 'ArrowUp') { e.preventDefault(); scrollToRow(tree, Math.max(0, tree.curIdx - 1)); }
      else if (key === 'ArrowRight') {
        e.preventDefault();
        const r = tree.rows[tree.curIdx];
        if (r && r.type === 'open' && !tree.open.has(r.id)) toggleNode(r.id);
        else scrollToRow(tree, Math.min(n - 1, tree.curIdx + 1));
      } else if (key === 'ArrowLeft') {
        e.preventDefault();
        const r = tree.rows[tree.curIdx];
        if (r && r.type === 'open' && tree.open.has(r.id)) toggleNode(r.id);
        else scrollToRow(tree, Math.max(0, tree.curIdx - 1));
      } else if (key === 'Enter' || key === ' ') {
        e.preventDefault();
        const r = tree.rows[tree.curIdx];
        if (r && r.type === 'open') toggleNode(r.id);
      }
    });

    if ($('table-view')) $('table-view').addEventListener('click', (e) => {
      const td = e.target.closest && e.target.closest('td[data-r]');
      if (!td) return;
      const t = $('table-view')._data;
      if (!t) return;
      const v = t.rows[+td.dataset.r][t.columns[+td.dataset.c]];
      copyText(cellCopy(v)).then((ok) => toast(ok ? 'Copied cell' : 'Copy failed'));
    });

    if ($('ctx-copy-value')) $('ctx-copy-value').addEventListener('click', () => ctxAction('value'));
    if ($('ctx-copy-path')) $('ctx-copy-path').addEventListener('click', () => ctxAction('path'));
    if ($('ctx-copy-json')) $('ctx-copy-json').addEventListener('click', () => ctxAction('json'));
    if ($('ctx-expand')) $('ctx-expand').addEventListener('click', () => ctxAction('expand'));
    document.addEventListener('click', (e) => {
      const menu = $('ctx-menu');
      if (!menu || menu.hidden) return;
      if (e.target.closest && e.target.closest('#ctx-menu')) return;
      hideCtx();
    });

    document.querySelectorAll('[data-close-sheet]').forEach((el) => {
      el.addEventListener('click', closeSheets);
    });

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      state.deferredPrompt = e;
      updateInstallUI();
    });
    window.addEventListener('appinstalled', () => {
      state.deferredPrompt = null;
      updateInstallUI();
      toast('App installed');
    });
    $('btn-install').addEventListener('click', promptInstall);

    window.addEventListener('resize', () => {
      if (state.tree) { buildOffsets(state.tree); renderTree(); }
      hideCtx();
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) queryShare();
    });
  }

  /* -------------------------------------------------------------
   * Service Worker + startup
   * ----------------------------------------------------------- */
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'SHARE_TARGET') handleShared(e.data.data);
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then(() => {
        queryShare();
      }).catch((err) => console.warn('SW registration failed', err));
    });
  }

  function registerFileHandler() {
    if (!('launchQueue' in window) || !window.launchQueue || !window.launchQueue.setConsumer) return;
    window.launchQueue.setConsumer(async (params) => {
      const files = (params && params.files) || [];
      if (!files.length) return;
      try {
        const file = await files[0].getFile();
        await openFile(file);
      } catch (e) {
        showError('Could not open file', String(e && e.message || e));
      }
    });
  }

  function init() {
    applyTheme(currentTheme());
    wireUI();
    registerSW();
    registerFileHandler();
    showHome();

    const params = new URLSearchParams(location.search);
    if (params.get('action') === 'open') {
      $('btn-pick').click();
    }
    if (params.get('action') === 'paste') {
      openPaste();
    }
    const fileParam = params.get('file');
    if (fileParam) {
      loadURL(fileParam);
    }
    updateInstallUI();
    queryShare();
  }

  window.addEventListener('DOMContentLoaded', init);
})();
