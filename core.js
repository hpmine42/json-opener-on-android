/* JSON Opener – core logic (no DOM, testable in Node) */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.JsonCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MAX_KEY = 120;
  var MAX_STR = 400;
  var HAY_BUDGET = 1500;
  var IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function quoteKey(k) {
    var s = JSON.stringify(String(k));
    if (s.length > MAX_KEY + 2) {
      s = '"' + s.slice(1, 1 + MAX_KEY) + '\u2026"';
    }
    return s;
  }

  function truncate(s) {
    return s.length > MAX_STR ? s.slice(0, MAX_STR) + '\u2026' : s;
  }

  function scalarHay(v) {
    if (v === null) return 'null';
    var t = typeof v;
    if (t === 'string') return v.toLowerCase();
    if (t === 'number' || t === 'boolean') return String(v);
    return '';
  }

  function joinPath(parent, key, isIndex) {
    if (key == null || key === '') return parent || '$';
    if (isIndex) return parent + '[' + key + ']';
    if (IDENT.test(key)) return parent + '.' + key;
    return parent + '[' + JSON.stringify(String(key)) + ']';
  }

  function isProbablyUrl(s) {
    return typeof s === 'string' && /^https?:\/\/[^\s]+$/i.test(s);
  }

  function quickHay(val) {
    var budget = { n: HAY_BUDGET };
    function rec(v, depth) {
      if (budget.n <= 0) return ' \u2026';
      budget.n--;
      if (v === null) return 'null';
      var t = typeof v;
      if (t === 'string') return v.toLowerCase();
      if (t === 'number' || t === 'boolean') return String(v);
      if (t !== 'object') return '';
      if (depth > 6) return ' \u2026';
      var isArr = Array.isArray(v);
      var keys = isArr ? v.map(function (_, i) { return String(i); }) : Object.keys(v);
      if (!keys.length) return isArr ? '[]' : '{}';
      var parts = [];
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var c = v[k];
        if (c !== null && typeof c === 'object') {
          parts.push(k + ':(' + rec(c, depth + 1) + ')');
        } else {
          parts.push(k + ':' + (typeof c === 'string' ? c : String(c)));
        }
      }
      return parts.join(' ').toLowerCase();
    }
    return rec(val, 0);
  }

  function typeName(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    var t = typeof v;
    if (t === 'object') return 'object';
    return t;
  }

  function countNodes(val, budget) {
    budget.n--;
    if (budget.n <= 0) return budget.n;
    if (val === null || typeof val !== 'object') return 1;
    var n = 1;
    if (Array.isArray(val)) {
      for (var i = 0; i < val.length; i++) n += countNodes(val[i], budget);
    } else {
      var keys = Object.keys(val);
      for (var j = 0; j < keys.length; j++) n += countNodes(val[keys[j]], budget);
    }
    return n;
  }

  function collectStats(val) {
    var s = {
      objects: 0, arrays: 0, strings: 0, numbers: 0,
      booleans: 0, nulls: 0, keys: 0, maxDepth: 0, nodes: 0
    };
    function rec(v, d) {
      s.nodes++;
      if (d > s.maxDepth) s.maxDepth = d;
      if (v === null) { s.nulls++; return; }
      var t = typeof v;
      if (t === 'string') { s.strings++; return; }
      if (t === 'number') { s.numbers++; return; }
      if (t === 'boolean') { s.booleans++; return; }
      if (t !== 'object') return;
      if (Array.isArray(v)) {
        s.arrays++;
        for (var i = 0; i < v.length; i++) rec(v[i], d + 1);
      } else {
        s.objects++;
        var keys = Object.keys(v);
        s.keys += keys.length;
        for (var j = 0; j < keys.length; j++) rec(v[keys[j]], d + 1);
      }
    }
    rec(val, 0);
    return s;
  }

  function tableFrom(val) {
    if (!Array.isArray(val) || !val.length || val.length > 5000) return null;
    var cols = [];
    var colSet = Object.create(null);
    for (var i = 0; i < val.length; i++) {
      var row = val[i];
      if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
      var keys = Object.keys(row);
      for (var k = 0; k < keys.length; k++) {
        if (!colSet[keys[k]]) {
          colSet[keys[k]] = true;
          cols.push(keys[k]);
        }
      }
    }
    return { columns: cols, rows: val };
  }

  function findTable(data) {
    var t = tableFrom(data);
    if (t) return { path: '$', table: t };
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      var keys = Object.keys(data);
      for (var i = 0; i < keys.length; i++) {
        t = tableFrom(data[keys[i]]);
        if (t) return { path: joinPath('$', keys[i], false), table: t };
      }
    }
    return null;
  }

  function errorContext(text, message) {
    var m = /position (\d+)/i.exec(String(message || ''));
    if (!m) return { line: 0, col: 0, snippet: '', mark: -1 };
    var pos = +m[1];
    var before = text.slice(0, pos);
    var line = before.split('\n').length;
    var col = pos - before.lastIndexOf('\n');
    var start = Math.max(0, pos - 48);
    var end = Math.min(text.length, pos + 48);
    var snippet = (start > 0 ? '\u2026' : '') + text.slice(start, end) + (end < text.length ? '\u2026' : '');
    var mark = (start > 0 ? 1 : 0) + (pos - start);
    return { line: line, col: col, snippet: snippet, mark: mark, position: pos };
  }

  function previewKeys(val, kind, count) {
    if (kind === 'array') return count === 1 ? '1 item' : count + ' items';
    var keys = Object.keys(val);
    if (!keys.length) return '0 keys';
    var shown = keys.slice(0, 3).join(', ');
    if (keys.length > 3) shown += ', \u2026';
    return count === 1 ? '1 key' : count + ' keys';
  }

  /* Tree view: flat row list with virtual rendering */
  function JsonTree(data) {
    this.data = data;
    this.rows = [];
    this.open = new Set();
    this.vals = new Map();
    this.nextId = 0;
    this._hay = new Map();
    this._openAll = false;
    this._budget = Infinity;
    this._build();
  }

  JsonTree.prototype._build = function () {
    var data = this.data;
    var isArr = Array.isArray(data);
    var isObj = data !== null && typeof data === 'object' && !isArr;
    if (!isArr && !isObj) {
      this.rows.push({
        type: 'value', depth: -1, key: null, searchKey: '',
        value: data, emptyKind: null, path: '$'
      });
      return;
    }
    var keys = isArr ? data.map(function (_, i) { return String(i); }) : Object.keys(data);
    this.walk(data, -1, null, keys.length <= 5000, this.rows, '$', false);
  };

  JsonTree.prototype.walk = function (val, depth, keyStr, forceOpen, out, path, isIndex) {
    var isArr = Array.isArray(val);
    var isObj = val !== null && typeof val === 'object' && !isArr;
    var key = keyStr == null ? null : quoteKey(keyStr);
    var sKey = keyStr == null ? '' : String(keyStr);
    var selfPath = keyStr == null ? (path || '$') : joinPath(path, keyStr, !!isIndex);

    if (!isArr && !isObj) {
      out.push({
        type: 'value', depth: depth, key: key, searchKey: sKey,
        value: val, emptyKind: null, path: selfPath
      });
      return;
    }
    var kind = isArr ? 'array' : 'object';
    var keys = isArr ? val.map(function (_, i) { return String(i); }) : Object.keys(val);
    if (keys.length === 0) {
      out.push({
        type: 'value', depth: depth, key: key, searchKey: sKey,
        value: null, emptyKind: kind, path: selfPath
      });
      return;
    }
    var id = 'c' + (this.nextId++);
    this.vals.set(id, val);
    out.push({
      type: 'open', depth: depth, key: key, searchKey: sKey,
      kind: kind, count: keys.length, id: id, path: selfPath,
      preview: previewKeys(val, kind, keys.length)
    });
    var shouldOpen = forceOpen || this.open.has(id) || (this._openAll && this._budget > keys.length);
    if (shouldOpen) {
      this.open.add(id);
      if (this._openAll) this._budget -= keys.length;
      for (var i = 0; i < keys.length; i++) {
        this.walk(val[keys[i]], depth + 1, keys[i], false, out, selfPath, isArr);
      }
    }
    out.push({ type: 'close', depth: depth, kind: kind, id: id, path: selfPath });
  };

  JsonTree.prototype.ranges = function () {
    var map = new Map();
    for (var i = 0; i < this.rows.length; i++) {
      var r = this.rows[i];
      if (r.id === undefined) continue;
      if (r.type === 'open') map.set(r.id, { oi: i });
      else if (r.type === 'close') {
        var e = map.get(r.id);
        if (e) e.ci = i;
      }
    }
    return map;
  };

  JsonTree.prototype.toggle = function (id) {
    var ranges = this.ranges();
    var range = ranges.get(id);
    if (!range) return false;
    if (this.open.has(id)) {
      this.open.delete(id);
      this.rows.splice(range.oi + 1, range.ci - range.oi - 1);
    } else {
      this.open.add(id);
      var val = this.vals.get(id);
      var isArr = Array.isArray(val);
      var keys = isArr ? val.map(function (_, i) { return String(i); }) : Object.keys(val);
      var depth = this.rows[range.oi].depth + 1;
      var parentPath = this.rows[range.oi].path || '$';
      var insert = [];
      for (var i = 0; i < keys.length; i++) {
        this.walk(val[keys[i]], depth, keys[i], false, insert, parentPath, isArr);
      }
      if (insert.length) {
        var before = this.rows.slice(0, range.oi + 1);
        var after = this.rows.slice(range.oi + 1);
        this.rows = before.concat(insert, after);
      }
    }
    this._hay.clear();
    return true;
  };

  JsonTree.prototype.expandAll = function (budget) {
    this._openAll = true;
    this._budget = budget == null ? 20000 : budget;
    this.rows = [];
    this.open = new Set();
    this.vals = new Map();
    this.nextId = 0;
    this._hay.clear();
    this._build();
    this._openAll = false;
    this._budget = Infinity;
    return this.rows.length;
  };

  JsonTree.prototype.collapseAll = function () {
    this._openAll = false;
    this._budget = Infinity;
    this.rows = [];
    this.open = new Set();
    this.vals = new Map();
    this.nextId = 0;
    this._hay.clear();
    this._build();
    /* Keep the root expanded (default _build already does this for small docs)
       but collapse every nested container. For small docs _build opens only the root. */
    return this.rows.length;
  };

  JsonTree.prototype.valueOf = function (id) {
    return this.vals.get(id);
  };

  JsonTree.prototype.hayFor = function (id) {
    if (this._hay.has(id)) return this._hay.get(id);
    var h = quickHay(this.vals.get(id));
    this._hay.set(id, h);
    return h;
  };

  JsonTree.prototype.matches = function (needleRaw) {
    var needle = String(needleRaw || '').toLowerCase();
    var set = new Set();
    var list = [];
    if (!needle) return { set: set, list: list };
    var rows = this.rows;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var hay = null;
      if (r.type === 'value') {
        hay = (r.searchKey ? r.searchKey + ' ' : '') + scalarHay(r.value);
      } else if (r.type === 'open' && r.searchKey) {
        hay = r.searchKey;
        if (!this.open.has(r.id)) hay += ' ' + this.hayFor(r.id);
      } else if (r.type === 'open' && !r.searchKey) {
        /* Root container: search inside when collapsed */
        if (!this.open.has(r.id)) hay = this.hayFor(r.id);
      }
      if (hay !== null && hay.indexOf(needle) !== -1) {
        set.add(i);
        list.push(i);
      }
    }
    return { set: set, list: list };
  };

  function schemaLines(val, path, out, depth) {
    if (out.length >= 400) {
      if (out[out.length - 1] !== '\u2026') out.push('\u2026');
      return;
    }
    if (val === null || typeof val !== 'object') {
      out.push(path + '  \u2192  ' + typeName(val));
      return;
    }
    if (Array.isArray(val)) {
      out.push(path + '  \u2192  array [' + val.length + ']');
      if (val.length) {
        var first = val[0];
        var same = true;
        for (var i = 1; i < val.length; i++) {
          var v = val[i];
          if (typeof v !== typeof first || (v === null) !== (first === null) || Array.isArray(v) !== Array.isArray(first)) {
            same = false;
            break;
          }
        }
        if (same) schemaLines(first, path + '[]', out, depth + 1);
        else for (var j = 0; j < Math.min(val.length, 8); j++) schemaLines(val[j], path + '[' + j + ']', out, depth + 1);
      }
      return;
    }
    var keys = Object.keys(val);
    out.push(path + '  \u2192  object (' + keys.length + ')');
    for (var k = 0; k < keys.length; k++) schemaLines(val[keys[k]], path + '.' + keys[k], out, depth + 1);
  }

  return {
    JsonTree: JsonTree,
    schemaLines: schemaLines,
    escapeHtml: escapeHtml,
    quoteKey: quoteKey,
    truncate: truncate,
    countNodes: countNodes,
    typeName: typeName,
    collectStats: collectStats,
    tableFrom: tableFrom,
    findTable: findTable,
    joinPath: joinPath,
    errorContext: errorContext,
    isProbablyUrl: isProbablyUrl,
    previewKeys: previewKeys,
    MAX_STR: MAX_STR
  };
});
