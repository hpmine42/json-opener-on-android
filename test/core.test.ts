import { describe, it, expect } from 'vitest'
import {
  JsonTree,
  schemaLines,
  escapeHtml,
  quoteKey,
  truncate,
  countNodes,
  typeName,
  tryParse,
  convertToCSV,
  jsonPath
} from '../src/core'

describe('escapeHtml / quoteKey / truncate', () => {
  it('escapes HTML', () => {
    expect(escapeHtml('<a "b" & c>')).toBe('&lt;a &quot;b&quot; &amp; c&gt;')
  })
  it('quotes keys', () => {
    expect(quoteKey('normal')).toBe('"normal"')
    expect(quoteKey('very' + 'long'.repeat(40)).length).toBeLessThanOrEqual(124)
    expect(quoteKey('with "quotes"')).toBe('"with \\"quotes\\""')
  })
  it('truncates long strings', () => {
    expect(truncate('x'.repeat(1000)).length).toBeLessThanOrEqual(404)
  })
})

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
}

describe('JsonTree', () => {
  it('builds the expected rows', () => {
    const tree = new JsonTree(data)
    expect(tree.rows.length).toBe(10)
    expect(tree.rows[0].type).toBe('open')
    expect(tree.rows[0].key).toBe(null)
    expect(tree.rows.filter((r) => r.type === 'open').length).toBe(2)
    expect(tree.rows.filter((r) => r.type === 'value').length).toBe(6)
    const emptyRows = tree.rows.filter((r) => r.emptyKind)
    expect(emptyRows.length).toBe(2)
    expect(emptyRows[0].emptyKind).toBe('object')
    expect(emptyRows[1].emptyKind).toBe('array')
  })

  it('expands and collapses children', () => {
    const tree = new JsonTree(data)
    const childRow = tree.rows.find((r) => r.type === 'open' && r.searchKey === 'children')
    expect(childRow).toBeTruthy()
    const id = childRow!.id!
    expect(tree.open.has(id)).toBe(false)
    tree.toggle(id)
    expect(tree.open.has(id)).toBe(true)
    expect(tree.rows.length).toBe(14)
    expect(tree.rows.filter((r) => r.type === 'open').length).toBe(4)
    tree.toggle(id)
    expect(tree.open.has(id)).toBe(false)
    expect(tree.rows.length).toBe(10)
    expect(tree.toggle('does-not-exist')).toBe(false)
  })

  it('searches collapsed values', () => {
    const t3 = new JsonTree(data)
    const childrenId = t3.rows.find((r) => r.type === 'open' && r.searchKey === 'children')!.id!
    let m = t3.matches('One')
    expect(m.list.length).toBeGreaterThanOrEqual(1)
    expect(t3.rows[m.list[0]].searchKey).toBe('children')
    t3.toggle(childrenId)
    m = t3.matches('One')
    expect(t3.rows[m.list[0]].searchKey).toBe('0')
    t3.toggle(t3.rows[m.list[0]].id!)
    m = t3.matches('One')
    expect(m.list.some((i) => t3.rows[i].type === 'value' && t3.rows[i].value === 'One')).toBe(true)
    expect(t3.matches('notpresent').list.length).toBe(0)
    expect(t3.matches('').list.length).toBe(0)
  })

  it('handles a scalar root', () => {
    const t4 = new JsonTree('just a string')
    expect(t4.rows.length).toBe(1)
    expect(t4.rows[0].type).toBe('value')
  })

  it('handles large arrays', () => {
    const big = Array.from({ length: 100000 }, (_, i) => ({ i, s: 'value' + i }))
    const t5 = new JsonTree(big)
    expect(t5.rows.length).toBe(2)
    t5.toggle(t5.rows[0].id!)
    expect(t5.rows.length).toBe(200002)
    expect(t5.matches('value99999').list.length).toBe(1)
  })
})

describe('schema / stats helpers', () => {
  it('builds schema lines', () => {
    const out: string[] = []
    schemaLines(data, '$', out, 0)
    expect(out.length).toBe(11)
    expect(out[0]).toBe('$  →  object (7)')
    expect(out.some((l) => l.indexOf('$') === 0 && l.indexOf('name') === 2)).toBe(true)
  })
  it('counts nodes and types', () => {
    expect(countNodes(data, { n: 1e9 })).toBe(14)
    expect(typeName(null)).toBe('null')
    expect(typeName([])).toBe('array')
    expect(typeName({})).toBe('object')
    expect(typeName(1.5)).toBe('number')
  })
  it('parses JSONC and queries paths', () => {
    const parsed = tryParse('{ /* c */ "a": 1, }')
    expect(parsed.data).toEqual({ a: 1 })
    expect(jsonPath({ users: [{ name: 'Ada' }] }, '$.users[0].name')).toEqual(['Ada'])
    expect(convertToCSV([{ a: 1, b: 2 }, { a: 3, b: 4 }])).toContain('a,b')
  })
})
