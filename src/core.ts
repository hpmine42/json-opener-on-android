export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

export type JsonKind = 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object'

export interface TreeRow {
  type: 'open' | 'close' | 'value'
  depth: number
  key: string | null
  searchKey: string
  path: string
  value?: JsonValue
  emptyKind?: 'object' | 'array' | null
  kind?: 'object' | 'array'
  count?: number
  id?: string
}

export const MAX_KEY = 120
export const MAX_STR = 400
const HAY_BUDGET = 1500

export function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

export function quoteKey(k: string): string {
  let s = JSON.stringify(String(k))
  if (s.length > MAX_KEY + 2) s = '"' + s.slice(1, 1 + MAX_KEY) + '\u2026"'
  return s
}

export function truncate(s: string): string {
  return s.length > MAX_STR ? s.slice(0, MAX_STR) + '\u2026' : s
}

function scalarHay(v: JsonValue): string {
  if (v === null) return 'null'
  const t = typeof v
  if (t === 'string') return (v as string).toLowerCase()
  if (t === 'number' || t === 'boolean') return String(v)
  return ''
}

function quickHay(val: JsonValue): string {
  const budget = { n: HAY_BUDGET }
  function rec(v: JsonValue, depth: number): string {
    if (budget.n <= 0) return ' \u2026'
    budget.n--
    if (v === null) return 'null'
    const t = typeof v
    if (t === 'string') return (v as string).toLowerCase()
    if (t === 'number' || t === 'boolean') return String(v)
    if (t !== 'object') return ''
    if (depth > 6) return ' \u2026'
    const isArr = Array.isArray(v)
    const keys = isArr ? v.map((_, i) => String(i)) : Object.keys(v as object)
    if (!keys.length) return isArr ? '[]' : '{}'
    const parts: string[] = []
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]
      const c = (v as Record<string, JsonValue>)[k]
      if (c !== null && typeof c === 'object') parts.push(k + ':(' + rec(c, depth + 1) + ')')
      else parts.push(k + ':' + (typeof c === 'string' ? c : String(c)))
    }
    return parts.join(' ').toLowerCase()
  }
  return rec(val, 0)
}

export function typeName(v: JsonValue): JsonKind {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  const t = typeof v
  if (t === 'object') return 'object'
  if (t === 'string' || t === 'number' || t === 'boolean') return t
  return 'string'
}

export function countNodes(val: JsonValue, budget: { n: number }): number {
  budget.n--
  if (budget.n <= 0) return budget.n
  if (val === null || typeof val !== 'object') return 1
  let n = 1
  if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i++) n += countNodes(val[i], budget)
  } else {
    const keys = Object.keys(val)
    for (let j = 0; j < keys.length; j++) n += countNodes(val[keys[j]], budget)
  }
  return n
}

export function stripJsonComments(text: string): string {
  let out = ''
  let inStr = false
  let esc = false
  let inLineComment = false
  let inBlockComment = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const n = text[i + 1]
    if (inLineComment) {
      if (c === '\n') { inLineComment = false; out += c }
      continue
    }
    if (inBlockComment) {
      if (c === '*' && n === '/') { inBlockComment = false; i++ }
      continue
    }
    if (inStr) {
      out += c
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') { inStr = true; out += c; continue }
    if (c === '/' && n === '/') { inLineComment = true; i++; continue }
    if (c === '/' && n === '*') { inBlockComment = true; i++; continue }
    out += c
  }
  return out
}

export function stripTrailingCommas(text: string): string {
  return text.replace(/,\s*([}\]])/g, '$1')
}

export function tryParse(text: string, opts: { allowComments?: boolean; allowTrailingComma?: boolean } = {}) {
  const allowComments = opts.allowComments !== false
  const allowTrailingComma = opts.allowTrailingComma !== false
  const src = String(text).trim()
  if (!src) throw new SyntaxError('Empty input')
  let clean = src
  if (allowComments) clean = stripJsonComments(clean)
  if (allowTrailingComma) clean = stripTrailingCommas(clean)
  try {
    return { data: JSON.parse(clean) as JsonValue, format: 'json' as const, cleaned: clean }
  } catch (e) {
    const lines = src.split(/\n/).filter((l) => l.trim())
    if (lines.length > 1) {
      const arr: JsonValue[] = []
      let ok = true
      for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim()
        if (!line) continue
        if (allowComments) line = stripJsonComments(line)
        if (allowTrailingComma) line = stripTrailingCommas(line)
        try { arr.push(JSON.parse(line) as JsonValue) } catch { ok = false; break }
      }
      if (ok && arr.length) return { data: arr, format: 'ndjson' as const, cleaned: JSON.stringify(arr) }
    }
    throw e
  }
}

export function detectFormat(text: string): 'empty' | 'json' | 'ndjson' | 'jsonc' | 'unknown' {
  const t = String(text).trim()
  if (!t) return 'empty'
  if (t[0] === '[' || t[0] === '{' || t[0] === '"') {
    const lines = t.split('\n').filter((l) => l.trim())
    if (lines.length > 3) {
      let maybeNDJSON = true
      for (let i = 0; i < Math.min(5, lines.length); i++) {
        const l = lines[i].trim()
        if (l[0] !== '{' && l[0] !== '[' && l[0] !== '"') { maybeNDJSON = false; break }
        try { JSON.parse(l) } catch { maybeNDJSON = false; break }
      }
      if (maybeNDJSON) return 'ndjson'
    }
    return 'json'
  }
  if (t.includes('//') || t.includes('/*')) return 'jsonc'
  return 'unknown'
}

export function formatBytes(n: number): string {
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / (1024 * 1024)).toFixed(1) + ' MB'
}

export function sortKeysDeep(val: JsonValue): JsonValue {
  if (val === null || typeof val !== 'object') return val
  if (Array.isArray(val)) return val.map(sortKeysDeep)
  const out: { [k: string]: JsonValue } = {}
  const keys = Object.keys(val).sort()
  for (let i = 0; i < keys.length; i++) out[keys[i]] = sortKeysDeep(val[keys[i]])
  return out
}

export function formatJSON(data: JsonValue, opts: { minify?: boolean; indent?: number; sortKeys?: boolean } = {}): string {
  const indent = opts.minify ? 0 : (opts.indent != null ? opts.indent : 2)
  let payload = data
  if (opts.sortKeys) payload = sortKeysDeep(data)
  return indent === 0 ? JSON.stringify(payload) : JSON.stringify(payload, null, indent)
}

export interface Stats {
  totalNodes: number
  maxDepth: number
  types: Record<string, number>
  totalKeys: number
  arrayLengths: number[]
  depthHistogram: Record<number, number>
  avgArraySize: number
  largestArray: number
}

export function getStats(data: JsonValue): Stats {
  const stats: Stats = {
    totalNodes: 0,
    maxDepth: 0,
    types: { string: 0, number: 0, boolean: 0, null: 0, object: 0, array: 0 },
    totalKeys: 0,
    arrayLengths: [],
    depthHistogram: {},
    avgArraySize: 0,
    largestArray: 0
  }
  function walk(v: JsonValue, depth: number) {
    stats.totalNodes++
    stats.maxDepth = Math.max(stats.maxDepth, depth)
    stats.depthHistogram[depth] = (stats.depthHistogram[depth] || 0) + 1
    const t = typeName(v)
    stats.types[t] = (stats.types[t] || 0) + 1
    if (Array.isArray(v)) {
      stats.arrayLengths.push(v.length)
      for (let i = 0; i < v.length; i++) walk(v[i], depth + 1)
    } else if (v !== null && typeof v === 'object') {
      const keys = Object.keys(v)
      stats.totalKeys += keys.length
      for (let k = 0; k < keys.length; k++) walk(v[keys[k]], depth + 1)
    }
  }
  walk(data, 0)
  stats.avgArraySize = stats.arrayLengths.length
    ? stats.arrayLengths.reduce((a, b) => a + b, 0) / stats.arrayLengths.length
    : 0
  stats.largestArray = stats.arrayLengths.length ? Math.max(...stats.arrayLengths) : 0
  return stats
}

export function flatten(obj: JsonValue, prefix = '$', out: Record<string, JsonValue> = {}): Record<string, JsonValue> {
  if (obj === null || typeof obj !== 'object') {
    out[prefix] = obj
    return out
  }
  if (Array.isArray(obj)) {
    if (!obj.length) { out[prefix] = []; return out }
    for (let i = 0; i < obj.length; i++) flatten(obj[i], prefix + '[' + i + ']', out)
    return out
  }
  const keys = Object.keys(obj)
  if (!keys.length) { out[prefix] = {}; return out }
  for (let k = 0; k < keys.length; k++) {
    const key = keys[k]
    const safe = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)
      ? '.' + key
      : '["' + key.replace(/"/g, '\\"') + '"]'
    flatten(obj[key], prefix + safe, out)
  }
  return out
}

export function jsonPath(data: JsonValue, path: string): JsonValue[] {
  if (!path || path === '$') return [data]
  let expr = String(path).trim()
  if (expr[0] !== '$') throw new Error('JSONPath must start with $')
  expr = expr.replace(/\['([^']+)'\]/g, '.$1').replace(/\["([^"]+)"\]/g, '.$1').replace(/\[(\d+)\]/g, '.$1')
  const parts = expr.split('.').filter(Boolean)
  if (parts[0] === '$') parts.shift()
  let current: JsonValue[] = [data]
  for (let pi = 0; pi < parts.length; pi++) {
    const part = parts[pi]
    const next: JsonValue[] = []
    if (part === '*') {
      for (const cur of current) {
        if (cur !== null && typeof cur === 'object') {
          const vals = Array.isArray(cur) ? cur : Object.values(cur)
          for (const v of vals) next.push(v)
        }
      }
    } else if (part === '**') {
      const queue = current.slice()
      const visited: JsonValue[] = []
      while (queue.length) {
        const node = queue.shift() as JsonValue
        visited.push(node)
        if (node !== null && typeof node === 'object') {
          const kids = Array.isArray(node) ? node : Object.values(node)
          for (const k of kids) queue.push(k)
        }
      }
      next.push(...visited)
    } else {
      for (const c of current) {
        if (c !== null && typeof c === 'object' && !Array.isArray(c) && part in c) next.push(c[part])
        else if (Array.isArray(c) && /^\d+$/.test(part)) {
          const idx = +part
          if (idx < c.length) next.push(c[idx])
        }
      }
    }
    current = next
    if (!current.length) break
  }
  return current
}

export function convertToYAML(data: JsonValue, indent = 0): string {
  const pad = '  '.repeat(indent)
  if (data === null) return 'null'
  if (typeof data === 'boolean') return data ? 'true' : 'false'
  if (typeof data === 'number') return String(data)
  if (typeof data === 'string') {
    if (/[:#\-\n]/.test(data) || data.trim() !== data) return JSON.stringify(data)
    return data
  }
  if (Array.isArray(data)) {
    if (!data.length) return '[]'
    let out = ''
    for (let i = 0; i < data.length; i++) {
      const v = convertToYAML(data[i], indent + 1)
      if (v.includes('\n')) out += pad + '- ' + v.trimStart().split('\n').join('\n' + pad + '  ') + '\n'
      else out += pad + '- ' + v + '\n'
    }
    return out.trimEnd()
  }
  const keys = Object.keys(data)
  if (!keys.length) return '{}'
  const lines: string[] = []
  for (const key of keys) {
    const val = data[key]
    const formatted = convertToYAML(val, indent + 1)
    const needsQuote = /[^a-zA-Z0-9_\-]/.test(key) || /^\d/.test(key)
    const keyStr = needsQuote ? JSON.stringify(key) : key
    if (formatted.includes('\n') && typeof val === 'object' && val !== null) lines.push(pad + keyStr + ':\n' + formatted)
    else if (formatted.includes('\n')) lines.push(pad + keyStr + ': |\n' + pad + '  ' + formatted.replace(/\n/g, '\n' + pad + '  '))
    else lines.push(pad + keyStr + ': ' + formatted)
  }
  return lines.join('\n')
}

export function convertToCSV(data: JsonValue): string {
  let rows: JsonValue[] | null = Array.isArray(data) ? data : null
  if (!rows) {
    if (data !== null && typeof data === 'object') {
      for (const k in data) if (Array.isArray(data[k])) { rows = data[k] as JsonValue[]; break }
    }
    if (!rows) rows = [data]
  }
  if (!rows.length) return ''
  const headers: string[] = []
  const headerSet: Record<string, number> = {}
  for (const r of rows) {
    if (r !== null && typeof r === 'object' && !Array.isArray(r)) {
      for (const k of Object.keys(r)) if (!headerSet[k]) { headerSet[k] = 1; headers.push(k) }
    }
  }
  if (!headers.length) return ''
  function esc(v: unknown): string {
    if (v === null || v === undefined) return ''
    const s = String(v)
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
    return s
  }
  const lines = [headers.map(esc).join(',')]
  for (const row of rows) {
    const line: string[] = []
    for (const h of headers) {
      let cell: unknown = row && typeof row === 'object' && !Array.isArray(row) ? (row as Record<string, JsonValue>)[h] : undefined
      if (cell !== null && typeof cell === 'object') cell = JSON.stringify(cell)
      line.push(esc(cell))
    }
    lines.push(line.join(','))
  }
  return lines.join('\n')
}

export function validateJSON(text: string) {
  try {
    const parsed = tryParse(text)
    return { valid: true as const, data: parsed.data, format: parsed.format, error: null }
  } catch (e) {
    const msg = (e as Error).message || String(e)
    const posMatch = /position (\d+)/.exec(msg)
    let line = 1, col = 1, pos = -1
    if (posMatch) {
      pos = +posMatch[1]
      const before = String(text).slice(0, pos)
      line = before.split('\n').length
      col = pos - before.lastIndexOf('\n')
    }
    return { valid: false as const, data: null, format: null, error: { message: msg, line, col, pos } }
  }
}

export class JsonTree {
  data: JsonValue
  rows: TreeRow[] = []
  open = new Set<string>()
  vals = new Map<string, JsonValue>()
  nextId = 0
  _hay = new Map<string, string>()
  el: HTMLElement | null = null
  offsets: number[] | null = null
  heights: number[] | null = null
  cpl = 0
  totalH = 0
  matchSet = new Set<number>()
  matchList: number[] = []
  matchIdx = -1
  curIdx = -1

  constructor(data: JsonValue) {
    this.data = data
    this._build()
  }

  _build() {
    const data = this.data
    const isArr = Array.isArray(data)
    const isObj = data !== null && typeof data === 'object' && !isArr
    if (!isArr && !isObj) {
      this.rows.push({ type: 'value', depth: -1, key: null, searchKey: '', value: data, emptyKind: null, path: '$' })
      return
    }
    const keys = isArr ? data.map((_, i) => String(i)) : Object.keys(data as object)
    this.walk(data, -1, null, keys.length <= 5000, this.rows, '$')
  }

  walk(val: JsonValue, depth: number, keyStr: string | null, forceOpen: boolean, out: TreeRow[], path: string) {
    const isArr = Array.isArray(val)
    const isObj = val !== null && typeof val === 'object' && !isArr
    const key = keyStr == null ? null : quoteKey(keyStr)
    const sKey = keyStr == null ? '' : String(keyStr)
    if (!isArr && !isObj) {
      out.push({ type: 'value', depth, key, searchKey: sKey, value: val, emptyKind: null, path })
      return
    }
    const kind: 'array' | 'object' = isArr ? 'array' : 'object'
    const keys = isArr ? val.map((_, i) => String(i)) : Object.keys(val as object)
    if (keys.length === 0) {
      out.push({ type: 'value', depth, key, searchKey: sKey, value: null, emptyKind: kind, path })
      return
    }
    const id = 'c' + (this.nextId++)
    this.vals.set(id, val)
    out.push({ type: 'open', depth, key, searchKey: sKey, kind, count: keys.length, id, path })
    if (forceOpen || this.open.has(id)) {
      this.open.add(id)
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i]
        let childPath = isArr ? path + '[' + k + ']' : path + '.' + k
        if (path === '$' && !isArr) childPath = '$.' + k
        else if (path === '$' && isArr) childPath = '$[' + k + ']'
        this.walk((val as Record<string, JsonValue>)[k], depth + 1, k, false, out, childPath)
      }
    }
    out.push({ type: 'close', depth, kind, id, path, key: null, searchKey: '' })
  }

  ranges() {
    const map = new Map<string, { oi: number; ci?: number }>()
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i]
      if (r.id === undefined) continue
      if (r.type === 'open') map.set(r.id, { oi: i })
      else if (r.type === 'close') {
        const e = map.get(r.id)
        if (e) e.ci = i
      }
    }
    return map
  }

  toggle(id: string): boolean {
    const ranges = this.ranges()
    const range = ranges.get(id)
    if (!range) return false
    if (this.open.has(id)) {
      this.open.delete(id)
      this.rows.splice(range.oi + 1, (range.ci ?? range.oi) - range.oi - 1)
    } else {
      this.open.add(id)
      const val = this.vals.get(id) as JsonValue
      const isArr = Array.isArray(val)
      const keys = isArr ? val.map((_, i) => String(i)) : Object.keys(val as object)
      const depth = this.rows[range.oi].depth + 1
      const basePath = this.rows[range.oi].path
      const insert: TreeRow[] = []
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i]
        const childPath = isArr ? basePath + '[' + k + ']' : (basePath === '$' ? '$.' + k : basePath + '.' + k)
        this.walk((val as Record<string, JsonValue>)[k], depth, k, false, insert, childPath)
      }
      if (insert.length) {
        this.rows = this.rows.slice(0, range.oi + 1).concat(insert, this.rows.slice(range.oi + 1))
      }
    }
    this._hay.clear()
    return true
  }

  expandAll(): boolean {
    let expanded = false
    let again = true
    let safety = 20000
    while (again && safety-- > 0) {
      again = false
      for (let i = 0; i < this.rows.length; i++) {
        const r = this.rows[i]
        if (r.type === 'open' && r.id && !this.open.has(r.id)) {
          this.toggle(r.id)
          expanded = true
          again = true
          break
        }
      }
    }
    return expanded
  }

  collapseAll(): boolean {
    let root: TreeRow | null = null
    for (let i = 0; i < this.rows.length; i++) {
      if (this.rows[i].depth === -1 && this.rows[i].type === 'open') { root = this.rows[i]; break }
    }
    if (root) {
      this.open.clear()
      this.rows = []
      this._hay.clear()
      this.nextId = 0
      this.vals.clear()
      this._build()
      return true
    }
    return false
  }

  expandToDepth(targetDepth: number): boolean {
    let changed = false
    let again = true
    let safety = 10000
    while (again && safety-- > 0) {
      again = false
      for (let i = 0; i < this.rows.length; i++) {
        const r = this.rows[i]
        if (r.type === 'open' && r.id && r.depth < targetDepth && !this.open.has(r.id)) {
          this.toggle(r.id)
          changed = true
          again = true
          break
        }
      }
    }
    return changed
  }

  getPathForRow(idx: number): string {
    if (idx < 0 || idx >= this.rows.length) return ''
    return this.rows[idx].path || ''
  }

  hayFor(id: string): string {
    if (this._hay.has(id)) return this._hay.get(id) as string
    const h = quickHay(this.vals.get(id) as JsonValue)
    this._hay.set(id, h)
    return h
  }

  matches(needleRaw: string, opts: { regex?: boolean; caseSensitive?: boolean } = {}) {
    const useRegex = !!opts.regex
    const caseSensitive = !!opts.caseSensitive
    let needle = String(needleRaw || '')
    if (!caseSensitive) needle = needle.toLowerCase()
    const set = new Set<number>()
    const list: number[] = []
    if (!needle) return { set, list }
    let regex: RegExp | null = null
    if (useRegex) {
      try { regex = new RegExp(needle, caseSensitive ? '' : 'i') } catch { regex = null }
      if (!regex) return { set, list }
    }
    const rows = this.rows
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      let hay: string | null = null
      if (r.type === 'value') {
        hay = (r.searchKey ? r.searchKey + ' ' : '') + scalarHay(r.value as JsonValue) + ' ' + (r.path || '')
        if (!caseSensitive) hay = hay.toLowerCase()
      } else if (r.type === 'open') {
        hay = (r.searchKey ? r.searchKey + ' ' : '') + (r.path || '')
        if (r.id && !this.open.has(r.id)) hay += ' ' + this.hayFor(r.id)
        if (!caseSensitive) hay = hay.toLowerCase()
      } else continue
      const hit = useRegex && regex ? regex.test(hay) : hay.indexOf(needle) !== -1
      if (hit) { set.add(i); list.push(i) }
    }
    return { set, list }
  }
}

export function schemaLines(val: JsonValue, path: string, out: string[], depth: number) {
  if (out.length >= 400) {
    if (out[out.length - 1] !== '\u2026') out.push('\u2026')
    return
  }
  if (val === null || typeof val !== 'object') {
    out.push(path + '  \u2192  ' + typeName(val))
    return
  }
  if (Array.isArray(val)) {
    out.push(path + '  \u2192  array [' + val.length + ']')
    if (val.length) {
      const first = val[0]
      let same = true
      for (let i = 1; i < val.length; i++) {
        const v = val[i]
        if (typeof v !== typeof first || (v === null) !== (first === null) || Array.isArray(v) !== Array.isArray(first)) {
          same = false
          break
        }
      }
      if (same) schemaLines(first, path + '[]', out, depth + 1)
      else for (let j = 0; j < Math.min(val.length, 8); j++) schemaLines(val[j], path + '[' + j + ']', out, depth + 1)
    }
    return
  }
  const keys = Object.keys(val)
  out.push(path + '  \u2192  object (' + keys.length + ')')
  for (let k = 0; k < keys.length; k++) schemaLines(val[keys[k]], path + '.' + keys[k], out, depth + 1)
}

export interface SchemaNode {
  path: string
  type: string
  count: number
  example: string | null
  children: SchemaNode[]
}

export function buildSchemaTree(val: JsonValue, path: string, depth: number, out: SchemaNode[]) {
  if (depth > 12) return
  if (out.length >= 600) { out.push({ path: '…', type: 'truncated', count: 0, example: null, children: [] }); return }
  const t = typeName(val)
  const node: SchemaNode = { path, type: t, count: 0, example: null, children: [] }
  if (t === 'object' && val && typeof val === 'object' && !Array.isArray(val)) {
    const keys = Object.keys(val)
    node.count = keys.length
    if (keys.length) node.example = '{ ' + keys.slice(0, 3).join(', ') + (keys.length > 3 ? ', …' : '') + ' }'
    out.push(node)
    for (let i = 0; i < keys.length; i++) buildSchemaTree(val[keys[i]], path + '.' + keys[i], depth + 1, out)
  } else if (t === 'array' && Array.isArray(val)) {
    node.count = val.length
    node.example = '[' + val.length + ' items]'
    out.push(node)
    if (val.length) {
      const sample = val[0]
      const uniform = val.every((v) => typeName(v) === typeName(sample))
      if (uniform) buildSchemaTree(sample, path + '[]', depth + 1, out)
      else for (let j = 0; j < Math.min(val.length, 5); j++) buildSchemaTree(val[j], path + '[' + j + ']', depth + 1, out)
    }
  } else {
    node.example = String(val).slice(0, 60)
    out.push(node)
  }
}
