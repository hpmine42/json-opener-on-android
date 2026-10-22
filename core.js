/* JSON Opener — Core (DOM-free, testable in Node) */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.JsonCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------- Constants ----------
  var MAX_KEY = 120; // display: max key length
  var MAX_STR = 400; // display: max string length
  var HAY_BUDGET = 1500;

  // ---------- Helpers ----------
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

  // ---------- New: JSONC / tolerant parsing ----------
  function stripJsonComments(text) {
    var out = '';
    var inStr = false;
    var esc = false;
    var inLineComment = false;
    var inBlockComment = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      var n = text[i + 1];
      if (inLineComment) {
        if (c === '\n') { inLineComment = false; out += c; }
        continue;
      }
      if (inBlockComment) {
        if (c === '*' && n === '/') { inBlockComment = false; i++; }
        continue;
      }
      if (inStr) {
        out += c;
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; out += c; continue; }
      if (c === '/' && n === '/') { inLineComment = true; i++; continue; }
      if (c === '/' && n === '*') { inBlockComment = true; i++; continue; }
      out += c;
    }
    return out;
  }

  // Remove trailing commas before } or ]
  function stripTrailingCommas(text) {
    return text.replace(/,\s*([}\]])/g, '$1');
  }

  function tryParse(text, opts) {
    opts = opts || {};
    var allowComments = opts.allowComments !== false;
    var allowTrailingComma = opts.allowTrailingComma !== false;
    var src = String(text).trim();
    if (!src) throw new SyntaxError('Empty input');

    // NDJSON / JSON Lines detection: multiple lines each valid JSON
    // We'll try normal parse first; if fails and we detect many lines, try NDJSON.
    var clean = src;
    if (allowComments) clean = stripJsonComments(clean);
    if (allowTrailingComma) clean = stripTrailingCommas(clean);

    try {
      return { data: JSON.parse(clean), format: 'json', cleaned: clean };
    } catch (e) {
      // Try NDJSON: each non-empty line is JSON
      var lines = src.split(/\n/).filter(function (l) { return l.trim(); });
      if (lines.length > 1) {
        var arr = [];
        var ok = true;
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line) continue;
          var lc = allowComments ? stripJsonComments(line) : line;
          if (allowTrailingComma) lc = stripTrailingCommas(lc);
          try { arr.push(JSON.parse(lc)); } catch (_e) { ok = false; break; }
        }
        if (ok && arr.length) {
          return { data: arr, format: 'ndjson', cleaned: JSON.stringify(arr) };
        }
      }
      // Enhance error with position context if possible
      throw e;
    }
  }

  function detectFormat(text) {
    var t = String(text).trim();
    if (!t) return 'empty';
    if (t[0] === '[' || t[0] === '{' || t[0] === '"') {
      // check NDJSON heuristic
      var lines = t.split('\n').filter(function (l) { return l.trim(); });
      if (lines.length > 3) {
        var maybeNDJSON = true;
        for (var i = 0; i < Math.min(5, lines.length); i++) {
          var l = lines[i].trim();
          if (l[0] !== '{' && l[0] !== '[' && l[0] !== '"') { maybeNDJSON = false; break; }
          try { JSON.parse(l); } catch (e) { maybeNDJSON = false; break; }
        }
        if (maybeNDJSON) return 'ndjson';
      }
      return 'json';
    }
    // comment detection
    if (t.indexOf('//') !== -1 || t.indexOf('/*') !== -1) return 'jsonc';
    return 'unknown';
  }

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function formatJSON(data, opts) {
    opts = opts || {};
    var indent = opts.minify ? 0 : (opts.indent != null ? opts.indent : 2);
    var sortKeys = !!opts.sortKeys;
    if (sortKeys) data = sortKeysDeep(data);
    return indent === 0 ? JSON.stringify(data) : JSON.stringify(data, null, indent);
  }

  function sortKeysDeep(val) {
    if (val === null || typeof val !== 'object') return val;
    if (Array.isArray(val)) return val.map(sortKeysDeep);
    var out = {};
    var keys = Object.keys(val).sort();
    for (var i = 0; i < keys.length; i++) out[keys[i]] = sortKeysDeep(val[keys[i]]);
    return out;
  }

  function getStats(data) {
    var stats = {
      totalNodes: 0,
      maxDepth: 0,
      types: { string: 0, number: 0, boolean: 0, null: 0, object: 0, array: 0 },
      totalKeys: 0,
      arrayLengths: [],
      depthHistogram: {}
    };
    function walk(v, depth) {
      stats.totalNodes++;
      stats.maxDepth = Math.max(stats.maxDepth, depth);
      stats.depthHistogram[depth] = (stats.depthHistogram[depth] || 0) + 1;
      var t = typeName(v);
      if (stats.types[t] != null) stats.types[t]++; else stats.types[t] = 1;
      if (Array.isArray(v)) {
        stats.arrayLengths.push(v.length);
        for (var i = 0; i < v.length; i++) walk(v[i], depth + 1);
      } else if (v !== null && typeof v === 'object') {
        var keys = Object.keys(v);
        stats.totalKeys += keys.length;
        for (var k = 0; k < keys.length; k++) walk(v[keys[k]], depth + 1);
      }
    }
    walk(data, 0);
    stats.avgArraySize = stats.arrayLengths.length ? (stats.arrayLengths.reduce(function (a, b) { return a + b; }, 0) / stats.arrayLengths.length) : 0;
    stats.largestArray = stats.arrayLengths.length ? Math.max.apply(null, stats.arrayLengths) : 0;
    return stats;
  }

  function flatten(obj, prefix, out) {
    prefix = prefix || '$';
    out = out || {};
    if (obj === null || typeof obj !== 'object' || obj instanceof Date) {
      out[prefix] = obj;
      return out;
    }
    if (Array.isArray(obj)) {
      if (!obj.length) { out[prefix] = []; return out; }
      for (var i = 0; i < obj.length; i++) flatten(obj[i], prefix + '[' + i + ']', out);
      return out;
    }
    var keys = Object.keys(obj);
    if (!keys.length) { out[prefix] = {}; return out; }
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      var safe = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? '.' + key : '["' + key.replace(/"/g, '\\"') + '"]';
      // avoid leading dot on root expansions? Keep $. prefix.
      flatten(obj[key], prefix + safe, out);
    }
    return out;
  }

  // Simple JSONPath: supports $, ., [], *, wildcards, array slices not full spec
  function jsonPath(data, path) {
    if (!path || path === '$') return [data];
    // Normalize: $['a'] -> $.a etc.
    var expr = String(path).trim();
    if (expr[0] !== '$') throw new Error('JSONPath must start with $');
    expr = expr.replace(/\['([^']+)'\]/g, '.$1').replace(/\["([^"]+)"\]/g, '.$1').replace(/\[(\d+)\]/g, '.$1');
    // Handle wildcard .* and [*]
    var parts = expr.split('.').filter(Boolean);
    // first is $, remove
    if (parts[0] === '$') parts.shift();
    var current = [data];
    for (var pi = 0; pi < parts.length; pi++) {
      var part = parts[pi];
      var next = [];
      if (part === '*') {
        for (var ci = 0; ci < current.length; ci++) {
          var cur = current[ci];
          if (cur !== null && typeof cur === 'object') {
            var vals = Array.isArray(cur) ? cur : Object.values(cur);
            for (var vi = 0; vi < vals.length; vi++) next.push(vals[vi]);
          }
        }
      } else if (part === '**') {
        // recursive descent: collect all descendants
        var queue = current.slice();
        var visited = [];
        while (queue.length) {
          var node = queue.shift();
          visited.push(node);
          if (node !== null && typeof node === 'object') {
            var kids = Array.isArray(node) ? node : Object.values(node);
            for (var ki = 0; ki < kids.length; ki++) queue.push(kids[ki]);
          }
        }
        next = visited;
      } else {
        for (var cj = 0; cj < current.length; cj++) {
          var c = current[cj];
          if (c !== null && typeof c === 'object' && part in c) next.push(c[part]);
          else if (Array.isArray(c) && /^\d+$/.test(part)) {
            var idx = +part;
            if (idx < c.length) next.push(c[idx]);
          }
        }
      }
      current = next;
      if (!current.length) break;
    }
    return current;
  }

  function convertToYAML(data, indent) {
    indent = indent || 0;
    var pad = '  '.repeat(indent);
    if (data === null) return 'null';
    if (typeof data === 'boolean') return data ? 'true' : 'false';
    if (typeof data === 'number') return String(data);
    if (typeof data === 'string') {
      if (/[:#\-\n]/.test(data) || data.trim() !== data) return JSON.stringify(data);
      return data;
    }
    if (Array.isArray(data)) {
      if (!data.length) return '[]';
      var out = '';
      for (var i = 0; i < data.length; i++) {
        var v = convertToYAML(data[i], indent + 1);
        if (v.indexOf('\n') !== -1) {
          out += pad + '- ' + v.trimStart().split('\n').join('\n' + pad + '  ') + '\n';
        } else {
          out += pad + '- ' + v + '\n';
        }
      }
      return out.trimEnd();
    }
    // object
    var keys = Object.keys(data);
    if (!keys.length) return '{}';
    var lines = [];
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      var val = data[keys[k]];
      var formatted = convertToYAML(val, indent + 1);
      var needsQuote = /[^a-zA-Z0-9_\-]/.test(key) || /^\d/.test(key);
      var keyStr = needsQuote ? JSON.stringify(key) : key;
      if (formatted.indexOf('\n') !== -1 && typeof val === 'object' && val !== null) {
        lines.push(pad + keyStr + ':\n' + formatted);
      } else if (formatted.indexOf('\n') !== -1) {
        lines.push(pad + keyStr + ': |\n' + pad + '  ' + formatted.replace(/\n/g, '\n' + pad + '  '));
      } else {
        lines.push(pad + keyStr + ': ' + formatted);
      }
    }
    return lines.join('\n');
  }

  function convertToCSV(data) {
    // Expect array of objects or object with array value
    var rows = data;
    if (!Array.isArray(rows)) {
      // try to find first array property
      var found = null;
      if (data !== null && typeof data === 'object') {
        for (var k in data) if (Array.isArray(data[k])) { found = data[k]; break; }
      }
      if (found) rows = found; else rows = [data];
    }
    if (!rows.length) return '';
    // collect headers
    var headers = [];
    var headerSet = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r !== null && typeof r === 'object' && !Array.isArray(r)) {
        var ks = Object.keys(r);
        for (var j = 0; j < ks.length; j++) if (!headerSet[ks[j]]) { headerSet[ks[j]] = 1; headers.push(ks[j]); }
      }
    }
    if (!headers.length) return '';
    function esc(v) {
      if (v === null || v === undefined) return '';
      var s = String(v);
      if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    }
    var lines = [headers.map(esc).join(',')];
    for (var ri = 0; ri < rows.length; ri++) {
      var row = rows[ri];
      var line = [];
      for (var hi = 0; hi < headers.length; hi++) {
        var h = headers[hi];
        var cell = row && typeof row === 'object' ? row[h] : undefined;
        if (cell !== null && typeof cell === 'object') cell = JSON.stringify(cell);
        line.push(esc(cell));
      }
      lines.push(line.join(','));
    }
    return lines.join('\n');
  }

  function validateJSON(text) {
    try {
      var parsed = tryParse(text);
      return { valid: true, data: parsed.data, format: parsed.format, error: null };
    } catch (e) {
      var msg = e.message || String(e);
      var posMatch = /position (\d+)/.exec(msg);
      var line = 1, col = 1, pos = -1;
      if (posMatch) {
        pos = +posMatch[1];
        var before = String(text).slice(0, pos);
        line = before.split('\n').length;
        col = pos - before.lastIndexOf('\n');
      }
      return { valid: false, data: null, format: null, error: { message: msg, line: line, col: col, pos: pos } };
    }
  }

  // ---------- Tree view (virtualized) ----------
  function JsonTree(data) {
    this.data = data;
    this.rows = [];          // flat rows: open / close / value
    this.open = new Set();   // ids of expanded containers
    this.vals = new Map();   // id -> container value
    this.nextId = 0;
    this._hay = new Map();
    this._build();
  }

  JsonTree.prototype._build = function () {
    var data = this.data;
    var isArr = Array.isArray(data);
    var isObj = data !== null && typeof data === 'object' && !isArr;
    if (!isArr && !isObj) {
      this.rows.push({ type: 'value', depth: -1, key: null, searchKey: '', value: data, emptyKind: null, path: '$' });
      return;
    }
    var keys = isArr ? data.map(function (_, i) { return String(i); }) : Object.keys(data);
    // Keep root collapsed only if huge (>5000) to avoid freeze; else open
    var shouldOpenRoot = keys.length <= 5000;
    this.walk(data, -1, null, shouldOpenRoot, this.rows, '$');
  };

  JsonTree.prototype.walk = function (val, depth, keyStr, forceOpen, out, path) {
    var isArr = Array.isArray(val);
    var isObj = val !== null && typeof val === 'object' && !isArr;
    var key = keyStr == null ? null : quoteKey(keyStr);
    var sKey = keyStr == null ? '' : String(keyStr);

    if (!isArr && !isObj) {
      out.push({ type: 'value', depth: depth, key: key, searchKey: sKey, value: val, emptyKind: null, path: path });
      return;
    }
    var kind = isArr ? 'array' : 'object';
    var keys = isArr ? val.map(function (_, i) { return String(i); }) : Object.keys(val);
    if (keys.length === 0) {
      out.push({ type: 'value', depth: depth, key: key, searchKey: sKey, value: null, emptyKind: kind, path: path });
      return;
    }
    var id = 'c' + (this.nextId++);
    this.vals.set(id, val);
    out.push({ type: 'open', depth: depth, key: key, searchKey: sKey, kind: kind, count: keys.length, id: id, path: path });
    if (forceOpen || this.open.has(id)) {
      this.open.add(id);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var childPath = isArr ? path + '[' + k + ']' : path + '.' + k;
        // sanitize path $.foo edge: root path already $; avoid $.. etc.
        if (path === '$' && !isArr) childPath = '$.' + k;
        else if (path === '$' && isArr) childPath = '$[' + k + ']';
        this.walk(val[k], depth + 1, k, false, out, childPath);
      }
    }
    out.push({ type: 'close', depth: depth, kind: kind, id: id, path: path });
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
      var basePath = this.rows[range.oi].path;
      var insert = [];
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var childPath = isArr ? basePath + '[' + k + ']' : (basePath === '$' ? '$.' + k : basePath + '.' + k);
        this.walk(val[k], depth, k, false, insert, childPath);
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

  JsonTree.prototype.expandAll = function () {
    var expanded = false;
    // Expand level by level to avoid infinite due to splice changes
    // Collect ids that are currently collapsed
    var again = true;
    var safety = 20000;
    while (again && safety-- > 0) {
      again = false;
      for (var i = 0; i < this.rows.length; i++) {
        var r = this.rows[i];
        if (r.type === 'open' && !this.open.has(r.id)) {
          this.toggle(r.id);
          expanded = true;
          again = true;
          break; // restart scan because rows changed
        }
      }
    }
    return expanded;
  };

  JsonTree.prototype.collapseAll = function () {
    var ranges = this.ranges();
    // find root id (depth -1 open)
    var root = null;
    for (var i = 0; i < this.rows.length; i++) if (this.rows[i].depth === -1 && this.rows[i].type === 'open') { root = this.rows[i]; break; }
    // Close everything except root if exists
    var ids = Array.from(this.open);
    // sort by depth descending? We can just clear and rebuild collapsed
    // Simpler: rebuild from scratch with only root open
    if (root) {
      // reset and rebuild
      this.open.clear();
      this.rows = [];
      this._hay.clear();
      this.nextId = 0; // careful: ids will change, but we need consistent rebuild
      this.vals.clear();
      this._build();
      // now close root's children? Actually we want root open but children collapsed => that's default after _build
      // If original large root was collapsed, we already collapsed all.
      return true;
    } else {
      // scalar root: nothing to collapse
      return false;
    }
  };

  JsonTree.prototype.expandToDepth = function (targetDepth) {
    // expand all nodes with depth < targetDepth
    var changed = false;
    var again = true;
    var safety = 10000;
    while (again && safety-- > 0) {
      again = false;
      for (var i = 0; i < this.rows.length; i++) {
        var r = this.rows[i];
        if (r.type === 'open' && r.depth < targetDepth && !this.open.has(r.id)) {
          this.toggle(r.id);
          changed = true;
          again = true;
          break;
        }
      }
    }
    return changed;
  };

  JsonTree.prototype.getPathForRow = function (idx) {
    if (idx < 0 || idx >= this.rows.length) return '';
    return this.rows[idx].path || '';
  };

  JsonTree.prototype.hayFor = function (id) {
    if (this._hay.has(id)) return this._hay.get(id);
    var h = quickHay(this.vals.get(id));
    this._hay.set(id, h);
    return h;
  };

  JsonTree.prototype.matches = function (needleRaw, opts) {
    opts = opts || {};
    var useRegex = !!opts.regex;
    var caseSensitive = !!opts.caseSensitive;
    var needle = String(needleRaw || '');
    if (!caseSensitive) needle = needle.toLowerCase();
    var set = new Set();
    var list = [];
    if (!needle) return { set: set, list: list };
    var regex = null;
    if (useRegex) {
      try { regex = new RegExp(needle, caseSensitive ? '' : 'i'); } catch (e) { regex = null; }
      if (!regex) return { set: set, list: list };
    }
    var rows = this.rows;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var hay = null;
      if (r.type === 'value') {
        hay = (r.searchKey ? r.searchKey + ' ' : '') + scalarHay(r.value) + ' ' + (r.path || '');
        if (!caseSensitive) hay = hay.toLowerCase();
      } else if (r.type === 'open') {
        hay = (r.searchKey ? r.searchKey + ' ' : '') + (r.path || '');
        if (!this.open.has(r.id)) hay += ' ' + this.hayFor(r.id);
        if (!caseSensitive) hay = hay.toLowerCase();
      } else continue;
      var hit = false;
      if (useRegex) hit = regex.test(hay);
      else hit = hay.indexOf(needle) !== -1;
      if (hit) { set.add(i); list.push(i); }
    }
    return { set: set, list: list };
  };

  // ---------- Schema ----------
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

  function buildSchemaTree(val, path, depth, out) {
    if (depth > 12) return;
    if (out.length >= 600) { out.push({ path: '…', type: 'truncated' }); return; }
    var t = typeName(val);
    var node = { path: path, type: t, count: 0, example: null, children: [] };
    if (t === 'object') {
      var keys = Object.keys(val);
      node.count = keys.length;
      if (keys.length) node.example = '{ ' + keys.slice(0, 3).join(', ') + (keys.length > 3 ? ', …' : '') + ' }';
      out.push(node);
      for (var i = 0; i < keys.length; i++) buildSchemaTree(val[keys[i]], path + '.' + keys[i], depth + 1, out);
    } else if (t === 'array') {
      node.count = val.length;
      node.example = '[' + val.length + ' items]';
      out.push(node);
      if (val.length) {
        var sample = val[0];
        var uniform = val.every(function (v) { return typeName(v) === typeName(sample); });
        if (uniform) buildSchemaTree(sample, path + '[]', depth + 1, out);
        else for (var j = 0; j < Math.min(val.length, 5); j++) buildSchemaTree(val[j], path + '[' + j + ']', depth + 1, out);
      }
    } else {
      node.example = String(val).slice(0, 60);
      out.push(node);
    }
  }

  // ---------- Public API ----------
  return {
    JsonTree: JsonTree,
    schemaLines: schemaLines,
    buildSchemaTree: buildSchemaTree,
    escapeHtml: escapeHtml,
    quoteKey: quoteKey,
    truncate: truncate,
    countNodes: countNodes,
    typeName: typeName,
    stripJsonComments: stripJsonComments,
    stripTrailingCommas: stripTrailingCommas,
    tryParse: tryParse,
    detectFormat: detectFormat,
    formatBytes: formatBytes,
    formatJSON: formatJSON,
    sortKeysDeep: sortKeysDeep,
    getStats: getStats,
    flatten: flatten,
    jsonPath: jsonPath,
    convertToYAML: convertToYAML,
    convertToCSV: convertToCSV,
    validateJSON: validateJSON,
    MAX_STR: MAX_STR,
    MAX_KEY: MAX_KEY
  };
});
