'use strict';

/* Tests for core.js (browser-free) */
const assert = require('assert');
const { JsonTree, schemaLines, escapeHtml, quoteKey, truncate, countNodes, typeName } = require('../core.js');

let passed = 0;
function ok(cond, name) {
  if (!cond) throw new Error('FAILED: ' + name);
  passed++;
  console.log('  ✓ ' + name);
}

console.log('escapeHtml / quoteKey / truncate');
ok(escapeHtml('<a "b" & c>') === '&lt;a &quot;b&quot; &amp; c&gt;', 'HTML is escaped');
ok(quoteKey('normal') === '"normal"', 'normal key');
ok(quoteKey('very' + 'long'.repeat(40)).length <= 124, 'long key is truncated');
ok(quoteKey('with "quotes"') === '"with \\"quotes\\""', 'key with quotes');
ok(truncate('x'.repeat(1000)).length <= 404, 'string is truncated');

console.log('JsonTree – build');
const data = {
  name: 'Root',
  count: 3,
  active: true,
  nothing: null,
  children: [
    { id: 1, name: 'One' },
    { id: 2, name: 'Two' }
  ],
  empty: {},
  emptyArr: []
};
const tree = new JsonTree(data);
ok(tree.rows.length === 10, 'row count correct (' + tree.rows.length + ')');
ok(tree.rows[0].type === 'open' && tree.rows[0].key === null, 'root is open row');
ok(tree.rows.filter((r) => r.type === 'open').length === 2, '2 open containers (root, children collapsed)');
ok(tree.rows.filter((r) => r.type === 'value').length === 6, '6 value rows (incl. empty containers)');
const emptyRows = tree.rows.filter((r) => r.emptyKind);
ok(emptyRows.length === 2 && emptyRows[0].emptyKind === 'object' && emptyRows[1].emptyKind === 'array', 'empty containers inline');

console.log('JsonTree – expand/collapse');
let childRow = tree.rows.find((r) => r.type === 'open' && r.searchKey === 'children');
ok(!!childRow, '"children" found');
const id = childRow.id;
ok(!tree.open.has(id), '"children" initially collapsed');
tree.toggle(id);
ok(tree.open.has(id), '"children" expanded');
ok(tree.rows.length === 14, 'rows after expand (' + tree.rows.length + ')');
ok(tree.rows.filter((r) => r.type === 'open').length === 4, '4 open containers (children expanded)');
tree.toggle(id);
ok(!tree.open.has(id), '"children" collapsed again');
ok(tree.rows.length === 10, 'rows restored after collapse');
ok(tree.toggle('non-existent') === false, 'unknown ID ignored');

console.log('JsonTree – search');
const t3 = new JsonTree(data);
const childId3 = t3.rows.find((r) => r.type === 'open' && r.searchKey === 'children').id;
let m = t3.matches('One');
ok(m.list.length >= 1, 'value in collapsed tree found');
const rowIdx = m.list[0];
const row = t3.rows[rowIdx];
ok(row.type === 'open' && row.searchKey === 'children', 'hit is on container row');
t3.toggle(childId3);
m = t3.matches('One');
ok(m.list.length >= 1 && t3.rows[m.list[0]].type === 'open' && t3.rows[m.list[0]].searchKey === '0', 'after expand hit is on child container');
const objId = t3.rows[m.list[0]].id;
t3.toggle(objId);
m = t3.matches('One');
ok(m.list.some((i) => t3.rows[i].type === 'value' && t3.rows[i].value === 'One'), 'after further expand value row found');
m = t3.matches('nonexistent');
ok(m.list.length === 0, 'no hits for nonsense');
m = t3.matches('null');
ok(m.list.length >= 1 && m.list.some((i) => t3.rows[i].value === null && t3.rows[i].emptyKind === null), 'null value found');
m = t3.matches('');
ok(m.list.length === 0, 'empty query = no hits');

console.log('JsonTree – scalar root');
const t4 = new JsonTree('just a string');
ok(t4.rows.length === 1 && t4.rows[0].type === 'value', 'scalar root creates one value row');

console.log('JsonTree – large flat arrays');
const big = Array.from({ length: 100000 }, (_, i) => ({ i, s: 'value' + i }));
const t5 = new JsonTree(big);
ok(t5.rows.length === 2, 'large array initially collapsed (only open/close)');
t5.toggle(t5.rows[0].id);
ok(t5.rows.length === 200002, 'large array expanded in linear time (' + t5.rows.length + ')');
m = t5.matches('value99999');
ok(m.list.length === 1, 'search in large array');
const deep = new JsonTree({ a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } });
ok(deep.rows.length === 4, 'deep structure initially only root + close');

console.log('Schema');
const out = [];
schemaLines(data, '$', out, 0);
ok(out.length === 11, 'schema lines (' + out.length + ')');
ok(out[0] === '$  →  object (7)', 'schema root: ' + out[0]);
ok(out.some((l) => l.indexOf('$') === 0 && l.indexOf('name') === 2), 'path contains .name');
const out2 = [];
schemaLines({ x: 1 }, '$', out2, 0);
ok(out2.some((l) => l === '$.x  →  number'), 'scalar type in schema');

console.log('countNodes / typeName');
ok(countNodes(data, { n: 1e9 }) === 14, 'countNodes correct (14)');
ok(countNodes({ a: { b: 1 } }, { n: 1e9 }) === 3, 'nested');
ok(typeName(null) === 'null' && typeName([]) === 'array' && typeName({}) === 'object' && typeName(1.5) === 'number', 'typeName');

console.log('\nAll ' + passed + ' tests passed.');
