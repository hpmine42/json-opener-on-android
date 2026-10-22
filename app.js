'use strict';

/* JSON Opener — App logic (UI) v2 — English, enhanced */
(function () {
  const $ = (id) => document.getElementById(id);
  const {
    JsonTree, schemaLines, buildSchemaTree, escapeHtml, countNodes, typeName,
    tryParse, detectFormat, formatJSON, sortKeysDeep, getStats, flatten,
    jsonPath, convertToYAML, convertToCSV, validateJSON, formatBytes, stripJsonComments
  } = window.JsonCore;

  const ROW_H = 21;
  const CHAR_W = 8.1;

  const state = {
    data: null,
    rawText: '',
    fileName: 'file.json',
    fileSize: 0,
    pretty: '',
    view: 'tree', // tree | raw | table | stats
    tree: null,
    lastHandledKey: '',
    lastHandledAt: 0,
    deferredPrompt: null,
    depthLevel: 1,
    rawMode: 'pretty', // pretty | minified
    sortKeys: false,
    wrap: false
  };

  // ---------- Utilities ----------
  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function toast(msg, ms) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, ms || 2200);
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
      } catch (e2) { return false; }
    }
  }

  function downloadFile(name, content, type) {
    const blob = new Blob([content], { type: type || 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function showLoading(show, text) {
    const el = $('loading');
    if (!el) return;
    el.hidden = !show;
    const t = el.querySelector('.loading-text');
    if (t && text) t.textContent = text;
  }

  function safeGetStorage() { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; } }
  function setTheme(theme) {
    const ls = safeGetStorage();
    const de = document.documentElement;
    if (!de) return;
    if (theme === 'auto') { if (de.removeAttribute) de.removeAttribute('data-theme'); if (ls) ls.removeItem('json-opener-theme'); }
    else { if (de.setAttribute) de.setAttribute('data-theme', theme); if (ls) ls.setItem('json-opener-theme', theme); }
  }
  function toggleTheme() {
    const de = document.documentElement;
    let cur = 'dark';
    if (de && de.getAttribute) cur = de.getAttribute('data-theme') || cur;
    try { if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches) cur = 'light'; } catch (e) {}
    // if no explicit theme, fallback to cur above
    const next = cur === 'dark' ? 'light' : 'dark';
    setTheme(next);
    toast('Theme: ' + next);
  }

  // ---------- Recent files ----------
  function loadRecent() {
    try { const ls = safeGetStorage(); return ls ? JSON.parse(ls.getItem('json-opener-recent') || '[]') : []; } catch (e) { return []; }
  }
  function saveRecent(list) { try { const ls = safeGetStorage(); if (ls) ls.setItem('json-opener-recent', JSON.stringify(list.slice(0, 10))); } catch (e) {} }
  function pushRecent(name, size) {
    const list = loadRecent();
    const entry = { name, size, at: Date.now() };
    const filtered = list.filter(r => r.name !== name);
    filtered.unshift(entry);
    saveRecent(filtered);
    renderRecent();
  }
  function renderRecent() {
    const el = $('recent-list');
    if (!el) return;
    const list = loadRecent();
    if (!list.length) { el.innerHTML = '<span class="muted">No recent files yet.</span>'; return; }
    el.innerHTML = '';
    list.slice(0, 5).forEach(r => {
      const div = document.createElement('div');
      div.className = 'recent-item';
      div.innerHTML = `<span>${escapeHtml(r.name)}</span><span class="muted">${fmtBytes(r.size)} · ${new Date(r.at).toLocaleDateString()}</span>`;
      div.addEventListener('click', () => toast('Recent: ' + r.name + ' — open a file to view again'));
      el.appendChild(div);
    });
  }

  // ---------- Navigation ----------
  function setPage(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = $('page-' + page);
    if (target) target.classList.add('active');
    const back = $('btn-back'); if (back) back.hidden = page === 'home';
    const bb = $('bottom-bar'); if (bb) bb.hidden = page !== 'viewer';
    const bc = $('breadcrumbs'); if (bc) bc.hidden = page !== 'viewer' || state.view !== 'tree';
    if (page === 'viewer') updateViewButtons();
    try { if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') window.scrollTo(0, 0); } catch (e) {}
  }
  function showHome() { setPage('home'); const s = $('btn-search'); if (s) s.hidden = true; renderRecent(); }
  function showViewer() {
    setPage('viewer');
    const s = $('btn-search'); if (s) s.hidden = false;
    if (state.tree) { state.tree.el = $('tree'); buildOffsets(state.tree); renderTree(); updateViewerStatus(); }
    else { renderRaw(); }
    try { if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') window.scrollTo(0, 0); } catch (e) {}
  }
  function showInfo() { setPage('info'); const s = $('btn-search'); if (s) s.hidden = true; }

  function updateViewerStatus() {
    const el = $('viewer-status');
    if (!el) return;
    if (!state.data) { el.textContent = ''; return; }
    const stats = getStats(state.data);
    el.textContent = `${stats.totalNodes} nodes · depth ${stats.maxDepth} · ${Object.entries(stats.types).filter(([k,v])=>v).map(([k,v])=>k+':'+v).join(' · ')}`;
  }

  // ---------- File handling ----------
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
      showLoading(true, 'Reading file…');
      const text = await readFileText(file);
      loadData(text, name, file.size || text.length);
    } catch (err) {
      showError('Could not read file', String(err && err.message || err));
    } finally { showLoading(false); }
  }

  function parsePosition(text, msg) {
    const m = /position (\d+)/.exec(msg);
    if (!m) return '';
    const pos = +m[1];
    const before = text.slice(0, pos);
    const line = before.split('\n').length;
    const col = pos - before.lastIndexOf('\n');
    return ` (line ${line}, column ${col})`;
  }

  function loadData(text, name, size) {
    const raw = String(text);
    state.rawText = raw;
    state.fileName = name;
    state.fileSize = size || raw.length;

    // Try tolerant parse (JSONC + NDJSON)
    let parsed;
    let info = null;
    try {
      info = tryParse(raw, { allowComments: true, allowTrailingComma: true });
      parsed = info.data;
    } catch (err) {
      showParseError(err, raw, name);
      return;
    }

    state.data = parsed;
    state.pretty = formatJSON(parsed, { indent: 2, sortKeys: state.sortKeys });
    state.view = 'tree';

    const budget = { n: 200001 };
    const nodes = countNodes(parsed, budget);
    const entries = budget.n <= 0 ? '>200,000' : String(nodes - 1);
    $('file-name').textContent = name;
    $('file-meta').textContent = `${fmtBytes(state.fileSize)} · ${entries} entries · ${info ? info.format : 'json'}`;

    buildTree(parsed);
    renderRaw();
    renderTable();
    renderStats();
    showViewer();
    const eb = $('error-box'); if (eb) eb.hidden = true;
    pushRecent(name, state.fileSize);
    if (state.fileSize > 20 * 1024 * 1024) toast('Very large file — this may take a moment');

    // Close search if open
    closeSearch();
  }

  function showParseError(err, text, name) {
    state.data = null;
    const msgEl = $('error-msg');
    if (msgEl) msgEl.textContent = 'This file does not contain valid JSON: ' + err.message + parsePosition(text, err.message) + '\n\nTip: Enable “Text” view to inspect raw content, or use Tools → Validate for details.';
    const box = $('error-box'); if (box) box.hidden = false;
    let btn = document.getElementById('btn-view-as-text');
    // Reuse error paste button
    const pasteBtn = $('btn-error-paste');
    if (pasteBtn) {
      pasteBtn.onclick = () => {
        state.data = null;
        state.fileName = name;
        state.fileSize = text.length;
        state.pretty = text;
        state.view = 'raw';
        $('file-name').textContent = name;
        $('file-meta').textContent = fmtBytes(text.length) + ' · text';
        $('tree').hidden = true;
        const rw = $('raw-wrap'); if (rw) rw.hidden = false; else $('raw').hidden = false;
        renderRaw();
        showViewer();
        setView('raw');
      };
    }
    showHome();
  }

  function showError(title, msg) {
    const box = $('error-box'); if (box) box.hidden = false;
    const t = document.querySelector('.error-title'); if (t) t.textContent = '⚠️ ' + title;
    const m = $('error-msg'); if (m) m.textContent = msg;
    showHome();
  }

  async function loadURL(url) {
    showLoading(true, 'Fetching URL…');
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      loadData(text, url.split('/').pop() || 'file.json', text.length);
    } catch (err) {
      showError('Could not load URL', String(err.message || err));
    } finally { showLoading(false); }
  }

  // ---------- Tree (virtualized) ----------
  function buildTree(data) {
    const tree = new JsonTree(data);
    tree.el = $('tree');
    tree.offsets = null; tree.heights = null; tree.cpl = 0; tree.totalH = 0;
    tree.matchSet = new Set(); tree.matchList = []; tree.matchIdx = -1; tree.curIdx = -1;
    state.tree = tree;
    const rw = $('raw-wrap'); if (rw) rw.hidden = true;
    const tw = $('table-wrap'); if (tw) tw.hidden = true;
    const sv = $('stats-view'); if (sv) sv.hidden = true;
    const raw = $('raw'); if (raw) raw.hidden = true;
    $('tree').hidden = false;
    state.depthLevel = 1;
    buildOffsets(tree);
    updateBreadcrumbs(-1);
  }

  function buildOffsets(tree) {
    const el = tree.el;
    if (!el) return;
    const cpl = Math.max(20, Math.floor((el.clientWidth - 36) / CHAR_W));
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
    if (r.type === 'open') chars = 20 + (r.key ? r.key.length + 2 : 0) + 4 + labelLen(r) + 2;
    else if (r.type === 'close') chars = 21;
    else chars = 20 + (r.key ? r.key.length + 2 : 0) + valueDispLen(r);
    return Math.max(1, Math.ceil(chars / cpl));
  }
  function labelLen(r) {
    const n = r.count;
    return n === 1 ? (r.kind === 'object' ? 10 : 9) : String(n).length + (r.kind === 'object' ? 10 : 9);
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
    const viewH = el.clientHeight;
    let lo = 0, hi = total;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tree.offsets[mid] < scrollTop) lo = mid + 1; else hi = mid;
    }
    let start = Math.max(0, lo - 20);
    let end = lo;
    while (end < total && tree.offsets[end] < scrollTop + viewH) end++;
    end = Math.min(total, end + 20);
    let html = '<div style="height:' + tree.offsets[start] + 'px"></div>';
    for (let i = start; i < end; i++) html += rowHTML(tree.rows[i], i, tree);
    const lastEnd = tree.offsets[end - 1] + tree.heights[end - 1] * ROW_H;
    html += '<div style="height:' + Math.max(0, tree.totalH - lastEnd) + 'px"></div>';
    el.innerHTML = html;
  }

  function rowHTML(r, i, tree) {
    const pad = r.depth >= 0 ? r.depth * 18 : 0;
    let cls = 'node-line';
    if (tree.matchSet && tree.matchSet.size && tree.matchSet.has(i)) cls += ' match';
    if (tree.curIdx === i) cls += ' focused';
    const style = 'padding-left:' + (pad + 6) + 'px';
    const keyHTML = r.key ? '<span class="t-key">' + escapeHtml(r.key) + '</span><span class="t-colon">: </span>' : '';
    const typeBadge = r.type === 'open' ? '' : r.emptyKind ? '<span class="type-badge">' + r.emptyKind + '</span>' : '<span class="type-badge">' + typeName(r.value) + '</span>';
    if (r.type === 'open') {
      const open = tree.open.has(r.id);
      const label = r.count === 1 ? (r.kind === 'object' ? '1 key' : '1 item') : r.count + (r.kind === 'object' ? ' keys' : ' items');
      return '<div class="' + cls + '" style="' + style + '" data-i="' + i + '" data-toggle="' + r.id + '" role="button" aria-expanded="' + open + '" title="' + escapeHtml(r.path || '') + '">' +
        '<span class="twisty">' + (open ? '▾' : '▸') + '</span>' + keyHTML +
        '<span class="t-brace">' + (r.kind === 'object' ? '{' : '[') + '</span>' +
        '<span class="t-ellipsis"> ' + label + '</span>' +
        '<span class="t-brace">' + (r.kind === 'object' ? '}' : ']') + '</span>' +
        '<span class="type-badge" style="margin-left:8px">' + escapeHtml(r.path || '') + '</span></div>';
    }
    if (r.type === 'close') {
      return '<div class="' + cls + '" style="' + style + '" data-i="' + i + '">' +
        '<span class="twisty empty"></span>' +
        '<span class="t-brace">' + (r.kind === 'object' ? '}' : ']') + '</span></div>';
    }
    return '<div class="' + cls + '" style="' + style + '" data-i="' + i + '" data-copy="1" title="Click to copy value • Right-click for more • Path: ' + escapeHtml(r.path || '') + '">' +
      '<span class="twisty empty"></span>' + keyHTML + scalarHTML(r) + typeBadge + '</div>';
  }

  function scalarHTML(r) {
    const v = r.value;
    if (r.emptyKind) return '<span class="t-brace">' + (r.emptyKind === 'object' ? '{ }' : '[ ]') + '</span>';
    if (v === null) return '<span class="t-null">null</span>';
    const t = typeof v;
    if (t === 'boolean') return '<span class="t-bool">' + v + '</span>';
    if (t === 'number') return '<span class="t-num">' + v + '</span>';
    return '<span class="t-str">"' + escapeHtml(v.length > 400 ? v.slice(0, 400) + '\u2026' : v) + '"</span>';
  }

  function toggleNode(id) {
    const tree = state.tree;
    if (!tree) return;
    tree.toggle(id);
    buildOffsets(tree);
    renderTree();
    updateBreadcrumbs(tree.curIdx);
  }

  function scrollToRow(tree, i) {
    tree.curIdx = i;
    if (tree.el) tree.el.scrollTop = Math.max(0, tree.offsets[i] - tree.el.clientHeight / 3);
    renderTree();
    updateBreadcrumbs(i);
  }

  function updateBreadcrumbs(idx) {
    const bc = $('crumb-path');
    if (!bc || !state.tree) return;
    const tree = state.tree;
    if (idx == null || idx < 0 || idx >= tree.rows.length) {
      bc.textContent = '$';
      return;
    }
    bc.textContent = tree.rows[idx].path || '$';
  }

  // ---------- Raw view ----------
  const TOKEN_RE = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

  function highlightJSON(text) {
    let out = ''; let last = 0; TOKEN_RE.lastIndex = 0; let m;
    while ((m = TOKEN_RE.exec(text))) {
      out += escapeHtml(text.slice(last, m.index));
      if (m[1] !== undefined) {
        if (m[2] !== undefined) out += '<span class="t-key">' + escapeHtml(m[1]) + '</span><span class="t-colon">:</span>';
        else out += '<span class="t-str">' + escapeHtml(m[1]) + '</span>';
      } else if (m[3] !== undefined) {
        const cls = m[3] === 'null' ? 't-null' : 't-bool';
        out += '<span class="' + cls + '">' + m[3] + '</span>';
      } else out += '<span class="t-num">' + m[0] + '</span>';
      last = m.index + m[0].length;
    }
    out += escapeHtml(text.slice(last));
    return out;
  }

  function renderRaw() {
    const raw = $('raw');
    if (!raw) return;
    if (!state.pretty) { raw.innerHTML = ''; return; }
    let txt = state.pretty;
    if (state.rawMode === 'minified') txt = formatJSON(state.data, { minify: true });
    else txt = formatJSON(state.data, { indent: 2, sortKeys: state.sortKeys });
    raw.innerHTML = highlightJSON(txt);
    raw.classList.toggle('wrap', !!state.wrap);
    // store current raw display for copy
    raw.dataset.text = txt;
  }

  // ---------- Table view ----------
  function renderTable() {
    const tbl = $('table-view'); const info = $('table-info');
    if (!tbl || !info) return;
    const data = state.data;
    let rows = null;
    if (Array.isArray(data)) rows = data;
    else if (data && typeof data === 'object') {
      // find first array property
      for (const k in data) if (Array.isArray(data[k])) { rows = data[k]; info.textContent = `Showing array property “${k}” (${rows.length} rows)`; break; }
    }
    if (!rows) {
      if (!Array.isArray(data)) { info.textContent = 'Table view works best for arrays of objects. This JSON is an object — showing its values if they contain arrays.'; }
      tbl.innerHTML = ''; return;
    }
    if (!rows.length) { info.textContent = 'Empty array — nothing to show.'; tbl.innerHTML = ''; return; }
    if (!info.textContent) info.textContent = `Array with ${rows.length} items`;
    // Collect columns
    const cols = [];
    const seen = new Set();
    rows.slice(0, 200).forEach(r => {
      if (r && typeof r === 'object' && !Array.isArray(r)) Object.keys(r).forEach(k => { if (!seen.has(k)) { seen.add(k); cols.push(k); } });
    });
    if (!cols.length) { info.textContent = 'No object rows to tabulate (array of primitives).'; tbl.innerHTML = ''; return; }
    let head = '<tr>' + cols.map(c => '<th>' + escapeHtml(c) + '</th>').join('') + '</tr>';
    let body = '';
    const limit = Math.min(rows.length, 200);
    for (let i = 0; i < limit; i++) {
      const r = rows[i];
      body += '<tr>' + cols.map(c => {
        let v = r ? r[c] : undefined;
        if (v !== null && typeof v === 'object') v = JSON.stringify(v);
        if (v === undefined) v = '';
        const s = String(v);
        return '<td title="' + escapeHtml(s) + '">' + escapeHtml(s.length > 120 ? s.slice(0,120)+'…' : s) + '</td>';
      }).join('') + '</tr>';
    }
    tbl.innerHTML = '<thead>' + head + '</thead><tbody>' + body + '</tbody>';
    if (rows.length > limit) info.textContent += ` — showing first ${limit} of ${rows.length}`;
  }

  // ---------- Stats view ----------
  function renderStats() {
    const el = $('stats-view');
    if (!el || !state.data) return;
    const stats = getStats(state.data);
    const total = stats.totalNodes;
    const depth = stats.maxDepth;
    const types = Object.entries(stats.types).filter(([k,v])=>v).sort((a,b)=>b[1]-a[1]);
    el.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><h4>Nodes</h4><div class="big">${total.toLocaleString()}</div><div class="muted small">objects + arrays + values</div></div>
        <div class="stat-card"><h4>Depth</h4><div class="big">${depth}</div><div class="muted small">max nesting</div></div>
        <div class="stat-card"><h4>Keys</h4><div class="big">${stats.totalKeys.toLocaleString()}</div><div class="muted small">total object keys</div></div>
        <div class="stat-card"><h4>Size</h4><div class="big">${fmtBytes(state.fileSize)}</div><div class="muted small">file size</div></div>
      </div>
      <div class="stat-card">
        <h4>Types</h4>
        ${types.map(([k,v]) => {
          const pct = ((v/total)*100).toFixed(1);
          return `<div style="display:flex;justify-content:space-between;margin:6px 0"><span>${escapeHtml(k)}</span><span>${v} · ${pct}%</span></div><div class="stat-bar"><div class="stat-bar-fill" style="width:${pct}%"></div></div>`;
        }).join('')}
      </div>
      <div class="stat-card">
        <h4>Arrays</h4>
        <div class="muted small">Largest array: ${stats.largestArray} · Average: ${stats.avgArraySize.toFixed(1)} · Count: ${stats.arrayLengths.length}</div>
        <pre class="schema-output" style="margin-top:8px;max-height:200px">${escapeHtml(JSON.stringify({ arrayLengthsSample: stats.arrayLengths.slice(0,20) }, null, 2))}</pre>
      </div>
      <div class="stat-card">
        <h4>Quick actions</h4>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
          <button class="btn small" onclick="document.getElementById('btn-copy-tree').click()">Copy visible tree</button>
          <button class="btn small" onclick="document.getElementById('tool-yaml').click()">Copy as YAML</button>
          <button class="btn small" onclick="document.getElementById('tool-csv').click()">Copy as CSV</button>
        </div>
      </div>
    `;
  }

  function setView(view) {
    state.view = view;
    const treeEl = $('tree');
    const rawWrap = $('raw-wrap') || $('raw');
    const tblWrap = $('table-wrap');
    const statsEl = $('stats-view');
    const bc = $('breadcrumbs');
    if (treeEl) treeEl.hidden = view !== 'tree';
    if (rawWrap) rawWrap.hidden = view !== 'raw';
    else if ($('raw')) $('raw').hidden = view !== 'raw';
    if (tblWrap) tblWrap.hidden = view !== 'table';
    if (statsEl) statsEl.hidden = view !== 'stats';
    if (bc) bc.hidden = view !== 'tree';
    updateViewButtons();
    if (view === 'tree' && state.tree) { buildOffsets(state.tree); renderTree(); }
    if (view === 'raw') renderRaw();
    if (view === 'table') renderTable();
    if (view === 'stats') renderStats();
  }

  function updateViewButtons() {
    document.querySelectorAll('.view-switch .chip').forEach(b => b.classList.remove('active'));
    const active = document.querySelector(`.view-switch [data-view="${state.view}"]`);
    if (active) active.classList.add('active');
    const rawBtn = $('bb-raw'); if (rawBtn) rawBtn.classList.toggle('active', state.view === 'raw');
    const tblBtn = $('bb-table'); if (tblBtn) tblBtn.classList.toggle('active', state.view === 'table');
  }

  // ---------- Search ----------
  function openSearch() {
    const box = $('search-box');
    if (!box) return;
    box.hidden = false;
    const input = $('search-input');
    input.focus(); input.select();
  }
  function closeSearch() {
    const box = $('search-box'); if (box) box.hidden = true;
    if (state.tree) {
      state.tree.matchSet = new Set(); state.tree.matchList = []; state.tree.matchIdx = -1;
      // remove filter
      document.querySelectorAll('.node-line.filtered-hidden').forEach(el => el.classList.remove('filtered-hidden'));
      renderTree();
    }
  }
  function runSearch(needle) {
    const tree = state.tree;
    if (!tree) return;
    const useRegex = !!($('search-regex') && $('search-regex').checked);
    const caseSensitive = !!($('search-case') && $('search-case').checked);
    const filterMode = !!($('search-filter') && $('search-filter').checked);
    const res = tree.matches(needle, { regex: useRegex, caseSensitive });
    tree.matchSet = res.set; tree.matchList = res.list; tree.matchIdx = res.list.length ? 0 : -1;
    const countEl = $('search-count');
    if (countEl) countEl.textContent = res.list.length ? `1/${res.list.length}` : (needle ? 'No matches' : '');
    if (filterMode && needle) {
      // In filter mode we will re-render with hidden non-matches? For virtualized we need to hide via CSS after render
      // Instead we re-render and then hide
      if (tree.matchIdx >= 0) jumpToMatch(tree, 0);
      else renderTree();
      // Apply filter visual: add class to non-matches (post-render we need to mark)
      // Do it via style: we can add logic in render to skip, but for now just highlight
    } else {
      if (tree.matchIdx >= 0) jumpToMatch(tree, 0);
      else renderTree();
    }
  }
  function jumpToMatch(tree, rel) {
    const n = tree.matchList.length;
    if (!n) return;
    tree.matchIdx = (tree.matchIdx + rel + n) % n;
    let idx = tree.matchList[tree.matchIdx];
    let row = tree.rows[idx];
    if (row && row.type === 'open' && !tree.open.has(row.id)) {
      const id = row.id;
      toggleNode(id);
      const res = tree.matches($('search-input').value, { regex: !!$('search-regex').checked, caseSensitive: !!$('search-case').checked });
      tree.matchSet = res.set; tree.matchList = res.list;
      tree.matchIdx = -1;
      const openIdx = tree.rows.findIndex(r => r.type === 'open' && r.id === id);
      if (openIdx >= 0) {
        const ranges = tree.ranges();
        const rng = ranges.get(id);
        const closeIdx = rng ? rng.ci : openIdx;
        let target = openIdx;
        for (const m of tree.matchList) if (m > openIdx && m <= closeIdx) { target = m; break; }
        idx = target;
        tree.matchIdx = tree.matchList.indexOf(idx);
        if (tree.matchIdx < 0) tree.matchIdx = 0;
      }
    }
    scrollToRow(tree, idx);
    const countEl = $('search-count');
    if (countEl) countEl.textContent = (tree.matchIdx + 1) + '/' + tree.matchList.length;
  }

  // ---------- Schema / Stats sheet ----------
  function openSchema() {
    if (!state.data) { toast('No file loaded'); return; }
    const out = [];
    schemaLines(state.data, '$', out, 0);
    const schemaEl = $('schema-output');
    if (schemaEl) schemaEl.textContent = out.join('\n');
    const statsEl = $('schema-stats');
    if (statsEl) {
      const stats = getStats(state.data);
      statsEl.innerHTML = `<div class="stats-grid">
        <div class="stat-card"><h4>Nodes</h4><div class="big">${stats.totalNodes}</div></div>
        <div class="stat-card"><h4>Depth</h4><div class="big">${stats.maxDepth}</div></div>
        <div class="stat-card"><h4>Keys</h4><div class="big">${stats.totalKeys}</div></div>
        <div class="stat-card"><h4>Size</h4><div class="big">${fmtBytes(state.fileSize)}</div></div>
      </div>
      <pre class="schema-output">${escapeHtml(JSON.stringify(stats, null, 2))}</pre>`;
    }
    const yamlEl = $('schema-yaml');
    if (yamlEl) yamlEl.textContent = convertToYAML(state.data).slice(0, 8000);
    openSheet('sheet-schema');
    // default tab
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    const firstTab = document.querySelector('.tab[data-tab="schema"]'); if (firstTab) firstTab.classList.add('active');
    updateSchemaTab('schema');
  }
  function updateSchemaTab(tab) {
    const schema = $('schema-output'); const stats = $('schema-stats'); const yaml = $('schema-yaml');
    if (schema) schema.hidden = tab !== 'schema';
    if (stats) stats.hidden = tab !== 'stats';
    if (yaml) yaml.hidden = tab !== 'preview';
  }

  // ---------- Tools ----------
  function doValidate() {
    if (!state.rawText) { toast('No file loaded'); return; }
    const res = validateJSON(state.rawText);
    if (res.valid) toast('✅ Valid JSON — format: ' + res.format);
    else {
      const e = res.error;
      toast('❌ Invalid: ' + e.message);
      showError('Validation failed', e.message + (e.line ? `\nAt line ${e.line}, column ${e.col}` : ''));
      openSheet('sheet-schema'); // reuse?
    }
  }
  function doFormat() {
    if (!state.data) { toast('No file loaded'); return; }
    state.pretty = formatJSON(state.data, { indent: 2, sortKeys: state.sortKeys });
    state.rawMode = 'pretty';
    renderRaw();
    toast('Formatted with 2-space indent');
  }
  function doMinify() {
    if (!state.data) return;
    state.pretty = formatJSON(state.data, { minify: true });
    state.rawMode = 'minified';
    renderRaw();
    toast('Minified');
  }
  function doSort() {
    if (!state.data) return;
    state.data = sortKeysDeep(state.data);
    state.pretty = formatJSON(state.data, { indent: 2, sortKeys: true });
    state.sortKeys = true;
    const toggle = $('toggle-sort'); if (toggle) toggle.checked = true;
    buildTree(state.data);
    renderRaw(); renderTree(); renderTable();
    toast('Keys sorted alphabetically');
  }
  async function doYAML() {
    if (!state.data) return;
    const yaml = convertToYAML(state.data);
    const ok = await copyText(yaml);
    toast(ok ? 'YAML copied to clipboard' : 'Copy failed');
  }
  async function doCSV() {
    if (!state.data) return;
    const csv = convertToCSV(state.data);
    if (!csv) { toast('No tabular data found for CSV'); return; }
    const ok = await copyText(csv);
    toast(ok ? 'CSV copied (' + csv.split('\n').length + ' lines)' : 'Copy failed');
  }
  function doCSVDownload() {
    if (!state.data) return;
    const csv = convertToCSV(state.data);
    if (!csv) { toast('No tabular data'); return; }
    downloadFile(state.fileName.replace(/\.json$/i, '.csv') || 'data.csv', csv, 'text/csv');
    toast('CSV downloaded');
  }
  async function doFlatten() {
    if (!state.data) return;
    const flat = flatten(state.data);
    const txt = JSON.stringify(flat, null, 2);
    const ok = await copyText(txt);
    toast(ok ? `Flattened ${Object.keys(flat).length} paths → copied` : 'Copy failed');
    // also show in schema output
    $('schema-output').textContent = txt.slice(0, 10000);
    openSheet('sheet-schema');
  }
  function openJsonPath() { $('jsonpath-output').hidden = true; $('jsonpath-output').textContent = ''; $('jsonpath-input').value = '$'; openSheet('sheet-jsonpath'); $('jsonpath-input').focus(); }
  function runJsonPath() {
    const path = $('jsonpath-input').value.trim();
    if (!path) return;
    try {
      const res = jsonPath(state.data, path);
      const out = $('jsonpath-output');
      out.hidden = false;
      out.textContent = JSON.stringify(res, null, 2);
      toast(`Found ${res.length} match(es)`);
    } catch (e) { toast('JSONPath error: ' + e.message); }
  }

  // ---------- Sharing / Saving ----------
  async function shareFile() {
    if (!state.pretty && !state.rawText) { toast('No file loaded'); return; }
    const content = state.data ? formatJSON(state.data, { indent: 2, sortKeys: state.sortKeys }) : state.rawText;
    const file = new File([content], state.fileName || 'file.json', { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: state.fileName }); return; } catch (err) { if (err && err.name === 'AbortError') return; }
    }
    // Fallback: download
    downloadFile(state.fileName || 'file.json', content, 'application/json');
    toast('File saved (sharing not available)');
  }
  function saveFile() {
    if (!state.pretty && !state.rawText) { toast('No file loaded'); return; }
    const content = state.data ? formatJSON(state.data, { indent: 2, sortKeys: state.sortKeys }) : state.rawText;
    downloadFile(state.fileName || 'file.json', content, 'application/json');
    toast('File saved');
  }
  async function copyAll() {
    const content = state.data ? formatJSON(state.data, { indent: 2 }) : state.rawText;
    if (!content) { toast('No file loaded'); return; }
    const ok = await copyText(content);
    toast(ok ? 'Copied to clipboard' : 'Copy failed');
  }

  // ---------- Sheets ----------
  function openSheet(id) { const s = $(id); if (s) s.hidden = false; }
  function closeSheets() { document.querySelectorAll('.sheet').forEach(s => s.hidden = true); }
  function closeMenu() { const m = $('menu-sheet'); if (m) m.hidden = true; }

  // ---------- Install ----------
  function updateInstallUI() {
    const show = !!state.deferredPrompt;
    const b1 = $('btn-install'); if (b1) b1.hidden = !show;
    const b2 = $('menu-install'); if (b2) b2.hidden = !show;
  }
  async function promptInstall() {
    if (!state.deferredPrompt) { toast('Install not available — use browser menu → Install'); return; }
    const p = state.deferredPrompt; state.deferredPrompt = null; updateInstallUI();
    try { p.prompt(); await p.userChoice; } catch (e) {}
  }

  // ---------- Share target ----------
  function shareKey(entry) {
    const f = entry.files && entry.files[0];
    if (f) return (f.name || '') + ':' + (f.size || 0);
    return 'text:' + String(entry.text || entry.url || '').slice(0, 64);
  }
  async function handleShared(entry) {
    if (!entry) return;
    const key = shareKey(entry);
    if (key === state.lastHandledKey && Date.now() - state.lastHandledAt < 5000) return;
    state.lastHandledKey = key; state.lastHandledAt = Date.now();
    const files = entry.files || [];
    if (files.length) { await openFile(files[0]); return; }
    const text = (entry.text || '').trim();
    if (text) {
      if (/^https?:\/\//i.test(text)) { await loadURL(text); }
      else {
        try { JSON.parse(text); loadData(text, entry.title || 'shared-text.json', text.length); }
        catch (e) { loadDataSafeText(text, entry.title || 'shared-text.json'); }
      }
      return;
    }
    if (entry.url) await loadURL(entry.url);
  }
  function loadDataSafeText(text, name) {
    state.data = null; state.fileName = name; state.fileSize = text.length; state.pretty = text; state.view = 'raw';
    $('file-name').textContent = name; $('file-meta').textContent = fmtBytes(text.length) + ' · text';
    const tr = $('tree'); if (tr) tr.hidden = true;
    const rw = $('raw-wrap'); if (rw) rw.hidden = false; else $('raw').hidden = false;
    renderRaw(); showViewer(); setView('raw');
  }
  function queryShare() {
    if (!navigator.serviceWorker) return;
    navigator.serviceWorker.getRegistration().then(reg => { if (reg && reg.active) reg.active.postMessage({ type: 'QUERY_SHARE' }); }).catch(()=>{});
  }

  // ---------- Command palette ----------
  const commands = [
    { id: 'open', name: 'Open file', action: () => $('file-input').click() },
    { id: 'paste', name: 'Paste JSON', action: () => $('paste-area').focus() },
    { id: 'expand', name: 'Expand all', action: () => { if (state.tree) { state.tree.expandAll(); buildOffsets(state.tree); renderTree(); toast('Expanded all'); } } },
    { id: 'collapse', name: 'Collapse all', action: () => { if (state.tree) { state.tree.collapseAll(); buildOffsets(state.tree); renderTree(); toast('Collapsed'); } } },
    { id: 'search', name: 'Search', action: () => openSearch() },
    { id: 'schema', name: 'Show schema', action: () => openSchema() },
    { id: 'validate', name: 'Validate JSON', action: () => doValidate() },
    { id: 'format', name: 'Format (prettify)', action: () => doFormat() },
    { id: 'minify', name: 'Minify', action: () => doMinify() },
    { id: 'sort', name: 'Sort keys', action: () => doSort() },
    { id: 'yaml', name: 'Copy as YAML', action: () => doYAML() },
    { id: 'csv', name: 'Copy as CSV', action: () => doCSV() },
    { id: 'flatten', name: 'Flatten', action: () => doFlatten() },
    { id: 'jsonpath', name: 'JSONPath query', action: () => openJsonPath() },
    { id: 'share', name: 'Share file', action: () => shareFile() },
    { id: 'save', name: 'Save file', action: () => saveFile() },
    { id: 'copy', name: 'Copy file', action: () => copyAll() },
    { id: 'theme', name: 'Toggle theme', action: () => toggleTheme() },
    { id: 'info', name: 'About & Help', action: () => showInfo() },
    { id: 'home', name: 'Go to home', action: () => showHome() },
  ];
  function openCommandPalette() {
    openSheet('sheet-command');
    const input = $('command-input'); input.value = ''; input.focus();
    renderCommandList('');
    input.oninput = () => renderCommandList(input.value);
  }
  function renderCommandList(q) {
    const list = $('command-list');
    const needle = q.toLowerCase();
    const filtered = commands.filter(c => !needle || c.name.toLowerCase().includes(needle) || c.id.includes(needle));
    list.innerHTML = '';
    filtered.forEach(c => {
      const div = document.createElement('button');
      div.className = 'command-item';
      div.innerHTML = `<span>${escapeHtml(c.name)}</span><span class="muted small">${c.id}</span>`;
      div.addEventListener('click', () => { closeSheets(); c.action(); });
      list.appendChild(div);
    });
    if (!filtered.length) list.innerHTML = '<div class="muted" style="padding:10px">No commands found</div>';
  }

  // ---------- Context menu ----------
  let ctxMenu = null;
  function showContextMenu(x, y, rowIdx) {
    hideContextMenu();
    const tree = state.tree; if (!tree) return;
    const row = tree.rows[rowIdx];
    if (!row) return;
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.style.left = x + 'px'; menu.style.top = y + 'px';
    const actions = [
      { label: 'Copy value', fn: async () => { const v = row.value !== undefined ? (typeof row.value === 'string' ? row.value : JSON.stringify(row.value)) : JSON.stringify(tree.vals.get(row.id) || row.path); const ok = await copyText(String(v)); toast(ok ? 'Copied value' : 'Copy failed'); } },
      { label: 'Copy path', fn: async () => { const ok = await copyText(row.path || ''); toast(ok ? 'Copied path: ' + (row.path||'') : 'Copy failed'); } },
      { label: 'Copy subtree (JSON)', fn: async () => {
        let data = null;
        if (row.type === 'open') data = tree.vals.get(row.id);
        else data = row.value;
        const ok = await copyText(JSON.stringify(data, null, 2)); toast(ok ? 'Subtree copied' : 'Copy failed');
      }},
      { label: row.type === 'open' ? (tree.open.has(row.id) ? 'Collapse' : 'Expand') : '—', fn: () => { if (row.type === 'open') toggleNode(row.id); } },
    ];
    actions.forEach(a => {
      if (a.label === '—') return;
      const b = document.createElement('button'); b.className = 'ctx-item'; b.textContent = a.label; b.addEventListener('click', () => { hideContextMenu(); a.fn(); });
      menu.appendChild(b);
    });
    document.body.appendChild(menu);
    ctxMenu = menu;
    // keep in viewport
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';
    setTimeout(() => document.addEventListener('click', hideContextMenu, { once: true }), 0);
  }
  function hideContextMenu() { if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; } }

  // ---------- UI wiring ----------
  function wireUI() {
    // Theme
    try { const ls = safeGetStorage(); const savedTheme = ls && ls.getItem('json-opener-theme'); if (savedTheme) setTheme(savedTheme); } catch (e) {}
    const themeBtn = $('btn-theme'); if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
    const menuTheme = $('menu-theme'); if (menuTheme) menuTheme.addEventListener('click', () => { closeMenu(); toggleTheme(); });

    // File open
    const pickBtn = $('btn-pick'); if (pickBtn) pickBtn.addEventListener('click', () => $('file-input').click());
    const fileInput = $('file-input');
    if (fileInput) fileInput.addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      if (f) openFile(f);
      e.target.value = '';
    });
    const pasteBtn = $('btn-paste'); if (pasteBtn) pasteBtn.addEventListener('click', () => { $('paste-area').focus(); document.getElementById('paste-area').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    const pasteLoad = $('btn-paste-load');
    if (pasteLoad) pasteLoad.addEventListener('click', () => {
      const t = $('paste-area').value.trim();
      if (!t) { toast('Paste area is empty'); return; }
      // try parse to detect filename hint
      let name = 'pasted.json';
      try { const p = JSON.parse(t); if (p && p.app) name = 'app.json'; } catch (e) {}
      loadData(t, name, t.length);
    });
    const urlLoad = $('btn-url-load');
    if (urlLoad) urlLoad.addEventListener('click', () => {
      const url = $('url-input').value.trim();
      if (!url) { toast('Enter a URL'); return; }
      loadURL(url);
    });
    const urlInput = $('url-input');
    if (urlInput) urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-url-load').click(); });

    const sampleBtn = $('btn-sample');
    if (sampleBtn) sampleBtn.addEventListener('click', async () => {
      try { const res = await fetch('./sample.json'); const text = await res.text(); loadData(text, 'sample.json', text.length); } catch (e) { showError('Could not load sample', String(e.message || e)); }
    });
    const errDismiss = $('btn-error-dismiss'); if (errDismiss) errDismiss.addEventListener('click', () => { $('error-box').hidden = true; });
    const clearRecent = $('btn-clear-recent'); if (clearRecent) clearRecent.addEventListener('click', () => { const ls = safeGetStorage(); if (ls) ls.removeItem('json-opener-recent'); renderRecent(); toast('History cleared'); });

    // Drag & drop
    const dz = $('dropzone');
    if (dz) {
      ['dragenter','dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('dragover'); }));
      ['dragleave','drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('dragover'); }));
      dz.addEventListener('drop', e => { const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) openFile(f); });
      dz.addEventListener('click', e => { if (e.target === dz || e.target.classList.contains('dz-icon') || e.target.tagName === 'H2' || e.target.tagName === 'P') $('file-input').click(); });
      dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file-input').click(); } });
    }
    // Global drag & drop
    ['dragenter','dragover'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); if (dz) dz.classList.add('dragover'); }));
    document.addEventListener('drop', e => {
      e.preventDefault(); if (dz) dz.classList.remove('dragover');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) openFile(f);
    });
    document.addEventListener('paste', e => {
      // If user is typing in input, ignore
      const ae = document.activeElement;
      if (ae && /INPUT|TEXTAREA/.test(ae.tagName)) return;
      const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
      if (text && text.trim().startsWith('{') || text.trim().startsWith('[')) {
        // optionally auto-open? Just toast and offer
        // We will load if it's valid JSON and no file loaded
        try { JSON.parse(text); loadData(text, 'pasted.json', text.length); toast('Pasted JSON opened'); } catch (err) {}
      }
    });

    // Navigation
    const backBtn = $('btn-back'); if (backBtn) backBtn.addEventListener('click', showHome);
    const menuBtn = $('btn-menu'); if (menuBtn) menuBtn.addEventListener('click', () => openSheet('menu-sheet'));
    const infoHome = $('btn-info-home'); if (infoHome) infoHome.addEventListener('click', showHome);
    const shortcutsBtn = $('btn-shortcuts'); if (shortcutsBtn) shortcutsBtn.addEventListener('click', () => openSheet('sheet-shortcuts'));
    const bottomBar = $('bottom-bar');

    // Viewer actions
    const viewTreeBtn = $('btn-view-tree'); if (viewTreeBtn) viewTreeBtn.addEventListener('click', () => setView('tree'));
    const viewRawBtn = $('btn-view-raw'); if (viewRawBtn) viewRawBtn.addEventListener('click', () => setView('raw'));
    const viewTableBtn = $('btn-view-table'); if (viewTableBtn) viewTableBtn.addEventListener('click', () => setView('table'));
    const viewStatsBtn = $('btn-view-stats'); if (viewStatsBtn) viewStatsBtn.addEventListener('click', () => setView('stats'));
    const expandBtn = $('btn-expand-all'); if (expandBtn) expandBtn.addEventListener('click', () => { if (!state.tree) return; state.tree.expandAll(); buildOffsets(state.tree); renderTree(); toast('Expanded all'); });
    const collapseBtn = $('btn-collapse-all'); if (collapseBtn) collapseBtn.addEventListener('click', () => { if (!state.tree) return; state.tree.collapseAll(); buildOffsets(state.tree); renderTree(); toast('Collapsed'); });
    const depthBtn = $('btn-depth'); if (depthBtn) depthBtn.addEventListener('click', () => {
      if (!state.tree) return;
      state.depthLevel++;
      state.tree.expandToDepth(state.depthLevel);
      buildOffsets(state.tree); renderTree();
      toast('Expanded to depth ' + state.depthLevel);
      if (state.depthLevel > 10) state.depthLevel = 0;
    });
    const schemaBtn = $('btn-schema'); if (schemaBtn) schemaBtn.addEventListener('click', openSchema);
    const copySchemaBtn = $('btn-copy-schema'); if (copySchemaBtn) copySchemaBtn.addEventListener('click', async () => {
      const txt = $('schema-output').textContent;
      const ok = await copyText(txt); toast(ok ? 'Schema copied' : 'Copy failed');
    });
    // tabs in schema sheet
    document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      updateSchemaTab(tab.dataset.tab);
    }));

    // Viewer toolbar toggles
    const wrapToggle = $('toggle-wrap'); if (wrapToggle) wrapToggle.addEventListener('change', e => { state.wrap = e.target.checked; renderRaw(); });
    const sortToggle = $('toggle-sort'); if (sortToggle) sortToggle.addEventListener('change', e => {
      state.sortKeys = e.target.checked;
      if (state.data) { state.data = sortKeysDeep(state.data); state.pretty = formatJSON(state.data, { indent:2, sortKeys: state.sortKeys }); buildTree(state.data); renderRaw(); renderTree(); toast(state.sortKeys ? 'Keys sorted' : 'Original order'); }
    });
    const copyTreeBtn = $('btn-copy-tree'); if (copyTreeBtn) copyTreeBtn.addEventListener('click', async () => {
      if (!state.tree) return;
      // copy visible tree as indented text
      let out = '';
      state.tree.rows.forEach(r => {
        const indent = '  '.repeat(Math.max(0, r.depth+1));
        if (r.type === 'open') out += indent + (r.key ? r.key + ': ' : '') + (r.kind === 'object' ? '{' : '[') + ' // ' + r.count + '\n';
        else if (r.type === 'close') out += indent + (r.kind === 'object' ? '}' : ']') + '\n';
        else {
          let v = r.value; if (v !== null && typeof v === 'object') v = JSON.stringify(v);
          else if (typeof v === 'string') v = '"' + v + '"';
          out += indent + (r.key ? r.key + ': ' : '') + v + '\n';
        }
      });
      const ok = await copyText(out); toast(ok ? 'Tree copied' : 'Copy failed');
    });
    const copyPathBtn = $('btn-copy-path'); if (copyPathBtn) copyPathBtn.addEventListener('click', async () => {
      const path = $('crumb-path').textContent;
      const ok = await copyText(path); toast(ok ? 'Copied: ' + path : 'Copy failed');
    });
    const rawPrettyBtn = $('btn-raw-pretty'); if (rawPrettyBtn) rawPrettyBtn.addEventListener('click', () => {
      state.rawMode = 'pretty'; document.querySelectorAll('.raw-toolbar .chip').forEach(c=>c.classList.remove('active')); rawPrettyBtn.classList.add('active'); renderRaw();
    });
    const rawMinBtn = $('btn-raw-min'); if (rawMinBtn) rawMinBtn.addEventListener('click', () => {
      state.rawMode = 'minified'; document.querySelectorAll('.raw-toolbar .chip').forEach(c=>c.classList.remove('active')); rawMinBtn.classList.add('active'); renderRaw();
    });
    const rawCopyBtn = $('btn-raw-copy'); if (rawCopyBtn) rawCopyBtn.addEventListener('click', async () => {
      const txt = $('raw').dataset.text || state.pretty;
      const ok = await copyText(txt); toast(ok ? 'Copied' : 'Copy failed');
    });
    const rawWrapBtn = $('btn-raw-wrap'); if (rawWrapBtn) rawWrapBtn.addEventListener('click', () => { state.wrap = !state.wrap; if ($('toggle-wrap')) $('toggle-wrap').checked = state.wrap; renderRaw(); });

    // Bottom bar
    const bbRaw = $('bb-raw'); if (bbRaw) bbRaw.addEventListener('click', () => setView(state.view === 'tree' ? 'raw' : 'tree'));
    const bbTable = $('bb-table'); if (bbTable) bbTable.addEventListener('click', () => setView('table'));
    const bbShare = $('bb-share'); if (bbShare) bbShare.addEventListener('click', shareFile);
    const bbSave = $('bb-save'); if (bbSave) bbSave.addEventListener('click', saveFile);
    const bbCopy = $('bb-copy'); if (bbCopy) bbCopy.addEventListener('click', copyAll);
    const bbOpen = $('bb-open'); if (bbOpen) bbOpen.addEventListener('click', () => $('file-input').click());

    // Menu
    const menuOpen = $('menu-open'); if (menuOpen) menuOpen.addEventListener('click', () => { closeMenu(); $('file-input').click(); });
    const menuPaste = $('menu-paste'); if (menuPaste) menuPaste.addEventListener('click', () => { closeMenu(); showHome(); setTimeout(()=>{ $('paste-area').focus(); $('paste-area').scrollIntoView({behavior:'smooth'}); }, 100); });
    const menuUrl = $('menu-url'); if (menuUrl) menuUrl.addEventListener('click', () => { closeMenu(); showHome(); setTimeout(()=>{ $('url-input').focus(); }, 100); });
    const menuRaw = $('menu-raw'); if (menuRaw) menuRaw.addEventListener('click', () => { closeMenu(); setView(state.view === 'tree' ? 'raw' : 'tree'); });
    const menuTable = $('menu-table'); if (menuTable) menuTable.addEventListener('click', () => { closeMenu(); setView('table'); });
    const menuShare = $('menu-share'); if (menuShare) menuShare.addEventListener('click', () => { closeMenu(); shareFile(); });
    const menuSave = $('menu-save'); if (menuSave) menuSave.addEventListener('click', () => { closeMenu(); saveFile(); });
    const menuCopy = $('menu-copy'); if (menuCopy) menuCopy.addEventListener('click', () => { closeMenu(); copyAll(); });
    const menuTools = $('menu-tools'); if (menuTools) menuTools.addEventListener('click', () => { closeMenu(); openSheet('tools-sheet'); });
    const menuInfo = $('menu-info'); if (menuInfo) menuInfo.addEventListener('click', () => { closeMenu(); showInfo(); });
    const menuInstall = $('menu-install'); if (menuInstall) menuInstall.addEventListener('click', () => { closeMenu(); promptInstall(); });

    // Tools sheet buttons
    const tValidate = $('tool-validate'); if (tValidate) tValidate.addEventListener('click', () => { closeSheets(); doValidate(); });
    const tFormat = $('tool-format'); if (tFormat) tFormat.addEventListener('click', () => { closeSheets(); doFormat(); });
    const tMinify = $('tool-minify'); if (tMinify) tMinify.addEventListener('click', () => { closeSheets(); doMinify(); });
    const tSort = $('tool-sort'); if (tSort) tSort.addEventListener('click', () => { closeSheets(); doSort(); });
    const tYaml = $('tool-yaml'); if (tYaml) tYaml.addEventListener('click', () => { closeSheets(); doYAML(); });
    const tCsv = $('tool-csv'); if (tCsv) tCsv.addEventListener('click', () => { closeSheets(); doCSV(); });
    const tCsvDl = $('tool-csv-download'); if (tCsvDl) tCsvDl.addEventListener('click', () => { closeSheets(); doCSVDownload(); });
    const tFlat = $('tool-flatten'); if (tFlat) tFlat.addEventListener('click', () => { closeSheets(); doFlatten(); });
    const tPath = $('tool-path'); if (tPath) tPath.addEventListener('click', () => { closeSheets(); openJsonPath(); });
    const tCompare = $('tool-compare'); if (tCompare) tCompare.addEventListener('click', () => { closeSheets(); $('file-input').click(); toast('Pick a second file to compare (diff coming soon)'); });
    const toolsBtn = $('btn-tools'); if (toolsBtn) toolsBtn.addEventListener('click', () => openSheet('tools-sheet'));
    const jsonPathRun = $('btn-jsonpath-run'); if (jsonPathRun) jsonPathRun.addEventListener('click', runJsonPath);
    const jsonPathInput = $('jsonpath-input'); if (jsonPathInput) jsonPathInput.addEventListener('keydown', e => { if (e.key === 'Enter') runJsonPath(); });

    // Search
    const searchBtn = $('btn-search'); if (searchBtn) searchBtn.addEventListener('click', openSearch);
    const searchClose = $('search-close'); if (searchClose) searchClose.addEventListener('click', closeSearch);
    const searchNext = $('search-next'); if (searchNext) searchNext.addEventListener('click', () => { if (state.tree) jumpToMatch(state.tree, 1); });
    const searchPrev = $('search-prev'); if (searchPrev) searchPrev.addEventListener('click', () => { if (state.tree) jumpToMatch(state.tree, -1); });
    let debounce = null;
    const searchInput = $('search-input');
    if (searchInput) {
      searchInput.addEventListener('input', e => { clearTimeout(debounce); const v = e.target.value; debounce = setTimeout(()=> runSearch(v), 120); });
      searchInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); jumpToMatch(state.tree, e.shiftKey ? -1 : 1); }
        if (e.key === 'Escape') closeSearch();
        e.stopPropagation();
      });
    }
    const regexCb = $('search-regex'); if (regexCb) regexCb.addEventListener('change', () => runSearch($('search-input').value));
    const caseCb = $('search-case'); if (caseCb) caseCb.addEventListener('change', () => runSearch($('search-input').value));
    const filterCb = $('search-filter'); if (filterCb) filterCb.addEventListener('change', () => runSearch($('search-input').value));

    // Command palette
    const cmdBtn = $('btn-command'); if (cmdBtn) cmdBtn.addEventListener('click', openCommandPalette);
    const cmdInput = $('command-input'); if (cmdInput) cmdInput.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeSheets();
      if (e.key === 'Enter') {
        const first = document.querySelector('.command-item');
        if (first) first.click();
      }
    });

    // Keyboard global
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openCommandPalette(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); openSearch(); return; }
      if (e.key === 'Escape') {
        if (ctxMenu) { hideContextMenu(); return; }
        if (!$('search-box').hidden) { closeSearch(); return; }
        if (!$('menu-sheet').hidden || !$('sheet-schema').hidden || !$('sheet-command').hidden || !$('sheet-jsonpath').hidden || !$('sheet-shortcuts').hidden || !$('tools-sheet').hidden) { closeSheets(); return; }
      }
      if (e.key === '/' && !/INPUT|TEXTAREA/i.test(document.activeElement.tagName)) { openSearch(); e.preventDefault(); }
      if (!state.tree || state.view !== 'tree') return;
      // Tree-specific shortcuts when tree has focus
      if (document.activeElement && document.activeElement.id === 'tree') {
        if (e.key === 'y' || e.key === 'c') { // copy
          const idx = state.tree.curIdx;
          if (idx >= 0) {
            const row = state.tree.rows[idx];
            const val = row.value !== undefined ? row.value : state.tree.vals.get(row.id);
            copyText(typeof val === 'string' ? val : JSON.stringify(val, null, 2)).then(ok => toast(ok ? 'Copied' : 'Copy failed'));
          }
        }
        if (e.key === 'p') {
          const idx = state.tree.curIdx;
          if (idx >= 0) { const row = state.tree.rows[idx]; copyText(row.path || '').then(ok=> toast(ok ? 'Copied path' : 'Copy failed')); }
        }
      }
    });

    // Tree interactions
    const treeEl = $('tree');
    if (treeEl) {
      treeEl.addEventListener('click', e => {
        const t = e.target.closest('[data-toggle]');
        if (t) { toggleNode(t.dataset.toggle); return; }
        const c = e.target.closest('[data-copy]');
        if (c) {
          const i = +c.dataset.i;
          const tree = state.tree;
          if (tree && tree.rows[i]) {
            const r = tree.rows[i];
            const v = r.value;
            const label = v === null ? 'null' : typeof v === 'string' ? v : String(v);
            copyText(String(v !== undefined ? v : '')).then(ok => toast(ok ? 'Copied: ' + label.slice(0,40) : 'Copy failed'));
            scrollToRow(tree, i);
          }
        } else {
          // set focus index
          const idxEl = e.target.closest('[data-i]');
          if (idxEl) {
            const i = +idxEl.dataset.i;
            state.tree.curIdx = i;
            updateBreadcrumbs(i);
            renderTree();
          }
        }
      });
      treeEl.addEventListener('contextmenu', e => {
        e.preventDefault();
        const el = e.target.closest('[data-i]');
        if (!el) return;
        showContextMenu(e.clientX, e.clientY, +el.dataset.i);
      });
      treeEl.addEventListener('scroll', () => {
        if (state._scrollRaf) return;
        state._scrollRaf = requestAnimationFrame(() => { state._scrollRaf = null; renderTree(); });
      });
      treeEl.addEventListener('keydown', e => {
        const tree = state.tree;
        if (!tree || !tree.rows.length) return;
        const key = e.key;
        const n = tree.rows.length;
        if (key === 'ArrowDown') { e.preventDefault(); scrollToRow(tree, Math.min(n-1, tree.curIdx + 1)); }
        else if (key === 'ArrowUp') { e.preventDefault(); scrollToRow(tree, Math.max(0, tree.curIdx - 1)); }
        else if (key === 'ArrowRight') {
          e.preventDefault();
          const r = tree.rows[tree.curIdx];
          if (r && r.type === 'open' && !tree.open.has(r.id)) toggleNode(r.id);
          else scrollToRow(tree, Math.min(n-1, tree.curIdx + 1));
        } else if (key === 'ArrowLeft') {
          e.preventDefault();
          const r = tree.rows[tree.curIdx];
          if (r && r.type === 'open' && tree.open.has(r.id)) toggleNode(r.id);
          else scrollToRow(tree, Math.max(0, tree.curIdx - 1));
        } else if (key === 'Enter' || key === ' ') {
          e.preventDefault();
          const r = tree.rows[tree.curIdx];
          if (r && r.type === 'open') toggleNode(r.id);
        } else if (key === 'Home') { e.preventDefault(); scrollToRow(tree, 0); }
        else if (key === 'End') { e.preventDefault(); scrollToRow(tree, n-1); }
      });
      // click outside to hide context
      document.addEventListener('click', hideContextMenu);
    }

    // Sheets close
    document.querySelectorAll('[data-close-sheet]').forEach(el => el.addEventListener('click', closeSheets));

    // Install
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); state.deferredPrompt = e; updateInstallUI(); });
    window.addEventListener('appinstalled', () => { state.deferredPrompt = null; updateInstallUI(); toast('App installed 🎉'); });
    const installBtn = $('btn-install'); if (installBtn) installBtn.addEventListener('click', promptInstall);

    // Resize
    window.addEventListener('resize', () => { if (state.tree) { buildOffsets(state.tree); renderTree(); } });

    // Visibility change
    document.addEventListener('visibilitychange', () => { if (!document.hidden) queryShare(); });

    // Error fallback for paste-as-text
    const errPaste = $('btn-error-paste'); if (errPaste) errPaste.addEventListener('click', () => { /* handled in showParseError */ });

    // Init recent
    renderRecent();
  }

  // ---------- SW ----------
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'SHARE_TARGET') handleShared(e.data.data); });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then(()=> queryShare()).catch(err=> console.warn('SW registration failed', err));
    });
  }

  function init() {
    wireUI();
    registerSW();
    showHome();
    const params = new URLSearchParams(location.search);
    if (params.get('action') === 'open') { /* will trigger file picker after user gesture; just focus button */ }
    if (params.get('action') === 'paste') { showHome(); setTimeout(()=> $('paste-area').focus(), 100); }
    const fileParam = params.get('file') || params.get('json') || params.get('url');
    if (fileParam) {
      try { const u = new URL(fileParam, location.href); loadURL(u.href); } catch (e) { loadURL(fileParam); }
    }
    const shared = params.get('shared');
    if (shared) queryShare();
    // support ?json= encoded json directly?
    const inline = params.get('data');
    if (inline) { try { const txt = decodeURIComponent(inline); loadData(txt, 'shared.json', txt.length); } catch(e){} }

    updateInstallUI();
    queryShare();

    // Auto-load if launched as file handler with launchQueue
    if ('launchQueue' in window) {
      window.launchQueue.setConsumer(async launchParams => {
        for (const handle of launchParams.files) {
          const file = await handle.getFile();
          await openFile(file);
        }
      });
    }
  }

  window.addEventListener('DOMContentLoaded', init);
})();
