<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import {
  JsonTree,
  type JsonValue,
  type TreeRow,
  convertToCSV,
  convertToYAML,
  countNodes,
  escapeHtml,
  flatten,
  formatBytes,
  formatJSON,
  getStats,
  jsonPath,
  schemaLines,
  sortKeysDeep,
  tryParse,
  validateJSON
} from './core'
import { copyText, downloadFile, highlightJSON } from './utils'
import { applyUpdate, setupPwa } from './pwa'

type Page = 'home' | 'viewer' | 'info'
type View = 'tree' | 'raw' | 'table' | 'stats'
type SheetId = 'menu' | 'schema' | 'command' | 'jsonpath' | 'shortcuts' | 'tools' | null

const ROW_H = 21
const CHAR_W = 8.1

const page = ref<Page>('home')
const view = ref<View>('tree')
const data = ref<JsonValue | null>(null)
const pretty = ref('')
const fileName = ref('file.json')
const fileSize = ref(0)
const fileMeta = ref('')
const formatLabel = ref('json')
const tree = ref<JsonTree | null>(null)
const treeEl = ref<HTMLElement | null>(null)
const rawEl = ref<HTMLElement | null>(null)
const searchOpen = ref(false)
const searchQuery = ref('')
const searchCount = ref('')
const searchRegex = ref(false)
const searchCase = ref(false)
const searchFilter = ref(false)
const wrap = ref(false)
const sortKeys = ref(false)
const rawMode = ref<'pretty' | 'minified'>('pretty')
const sheet = ref<SheetId>(null)
const schemaTab = ref<'schema' | 'stats' | 'preview'>('schema')
const schemaText = ref('')
const schemaStatsHtml = ref('')
const schemaYaml = ref('')
const toastMsg = ref('')
const toastOn = ref(false)
const loading = ref(false)
const loadingText = ref('Loading…')
const errorOn = ref(false)
const errorTitle = ref('Could not open file')
const errorMsg = ref('')
const pasteArea = ref('')
const urlInput = ref('')
const commandQuery = ref('')
const jsonPathInput = ref('$')
const jsonPathOutput = ref('')
const jsonPathShown = ref(false)
const crumbPath = ref('$')
const tableInfo = ref('')
const tableHtml = ref('')
const statsHtml = ref('')
const viewerStatus = ref('')
const canInstall = ref(false)
const theme = ref<'dark' | 'light'>('dark')
const recents = ref<{ name: string; size: number; at: number }[]>([])
const depthLevel = ref(1)
const ctxMenu = ref<{ x: number; y: number; i: number } | null>(null)
const lastShareKey = ref('')
const lastShareAt = ref(0)
const commandInput = ref<HTMLInputElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const dropOver = ref(false)
const updateAvailable = ref(false)
const homeTab = ref<'paste' | 'url'>('paste')

let deferredPrompt: { prompt: () => void } | null = null
let toastTimer: number | null = null
let searchTimer: number | null = null
let scrollRaf = 0
let pendingText: string | null = null

function toast(msg: string, ms = 2200) {
  toastMsg.value = msg
  toastOn.value = true
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { toastOn.value = false }, ms)
}

function storage() {
  try { return localStorage } catch { return null }
}

function applyTheme(t: 'dark' | 'light') {
  theme.value = t
  document.documentElement.setAttribute('data-theme', t)
  storage()?.setItem('json-opener-theme', t)
}

function toggleTheme() {
  applyTheme(theme.value === 'dark' ? 'light' : 'dark')
  toast('Theme: ' + (theme.value === 'dark' ? 'dark' : 'light'))
}

function loadRecents() {
  try {
    recents.value = JSON.parse(storage()?.getItem('json-opener-recent') || '[]')
  } catch { recents.value = [] }
}

function pushRecent(name: string, size: number) {
  recents.value = [{ name, size, at: Date.now() }, ...recents.value.filter((r) => r.name !== name)].slice(0, 8)
  storage()?.setItem('json-opener-recent', JSON.stringify(recents.value))
}

function clearRecents() {
  recents.value = []
  storage()?.removeItem('json-opener-recent')
  toast('History cleared')
}

function showHome() {
  page.value = 'home'
  searchOpen.value = false
  document.body.dataset.page = 'home'
}

function showInfo() {
  page.value = 'info'
  document.body.dataset.page = 'info'
  closeSheets()
}

const commands = computed(() => {
  const all = [
    { id: 'open', name: 'Open file', run: () => fileInput.value?.click() },
    { id: 'paste', name: 'Paste JSON', run: () => { showHome(); nextTick(() => document.getElementById('paste-area')?.focus()) } },
    { id: 'sample', name: 'Load sample', run: loadSample },
    { id: 'expand', name: 'Expand all', run: expandAll },
    { id: 'collapse', name: 'Collapse all', run: collapseAll },
    { id: 'tree', name: 'Tree view', run: () => setView('tree') },
    { id: 'raw', name: 'Text view', run: () => setView('raw') },
    { id: 'table', name: 'Table view', run: () => setView('table') },
    { id: 'stats', name: 'Stats view', run: () => setView('stats') },
    { id: 'yaml', name: 'Copy as YAML', run: doYAML },
    { id: 'csv', name: 'Copy as CSV', run: doCSV },
    { id: 'theme', name: 'Toggle theme', run: toggleTheme },
    { id: 'help', name: 'Help', run: showInfo }
  ]
  const q = commandQuery.value.trim().toLowerCase()
  return q ? all.filter((c) => c.name.toLowerCase().includes(q) || c.id.includes(q)) : all
})

function openSheet(id: SheetId) {
  sheet.value = id
  if (id === 'command') {
    commandQuery.value = ''
    nextTick(() => commandInput.value?.focus())
  }
}

function closeSheets() {
  sheet.value = null
  ctxMenu.value = null
}

async function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(r.error)
    r.readAsText(file)
  })
}

async function openFile(file: File | undefined | null) {
  if (!file) return
  loading.value = true
  loadingText.value = 'Reading file…'
  try {
    const text = await readFileText(file)
    loadData(text, file.name || 'file.json', file.size || text.length)
  } catch (err) {
    showError('Could not read file', String((err as Error)?.message || err))
  } finally {
    loading.value = false
  }
}

function parsePosition(text: string, msg: string) {
  const m = /position (\d+)/.exec(msg)
  if (!m) return ''
  const pos = +m[1]
  const before = text.slice(0, pos)
  return ` (line ${before.split('\n').length}, column ${pos - before.lastIndexOf('\n')})`
}

function loadData(text: string, name: string, size: number) {
  let parsed: JsonValue
  let info: { format: string } | null = null
  try {
    info = tryParse(text, { allowComments: true, allowTrailingComma: true })
    parsed = info.data
  } catch (err) {
    pendingText = text
    errorOn.value = true
    errorTitle.value = 'Could not open file'
    errorMsg.value = 'This file does not contain valid JSON: ' + (err as Error).message + parsePosition(text, (err as Error).message)
    showHome()
    return
  }
  data.value = parsed
  pretty.value = formatJSON(parsed, { indent: 2, sortKeys: sortKeys.value })
  fileName.value = name
  fileSize.value = size
  formatLabel.value = info?.format || 'json'
  const budget = { n: 200001 }
  const nodes = countNodes(parsed, budget)
  const entries = budget.n <= 0 ? '>200,000' : String(nodes - 1)
  fileMeta.value = `${formatBytes(size)} · ${entries} entries · ${formatLabel.value}`
  view.value = 'tree'
  errorOn.value = false
  const t = new JsonTree(parsed)
  tree.value = t
  depthLevel.value = 1
  page.value = 'viewer'
  document.body.dataset.page = 'viewer'
  pushRecent(name, size)
  closeSearch()
  nextTick(() => {
    renderTree()
    renderRaw()
    renderTable()
    renderStats()
    updateStatus()
  })
  if (size > 20 * 1024 * 1024) toast('Very large file — this may take a moment')
}

function showError(title: string, msg: string) {
  errorOn.value = true
  errorTitle.value = title
  errorMsg.value = msg
  showHome()
}

function openAsText() {
  const text = pendingText || pasteArea.value
  if (!text) return
  data.value = null
  pretty.value = text
  fileName.value = fileName.value || 'file.txt'
  fileMeta.value = formatBytes(text.length) + ' · text'
  view.value = 'raw'
  page.value = 'viewer'
  document.body.dataset.page = 'viewer'
  errorOn.value = false
  nextTick(renderRaw)
}

async function loadURL(url: string) {
  loading.value = true
  loadingText.value = 'Fetching URL…'
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const text = await res.text()
    loadData(text, url.split('/').pop() || 'file.json', text.length)
  } catch (err) {
    showError('Could not load URL', String((err as Error).message || err))
  } finally {
    loading.value = false
  }
}

async function loadSample() {
  try {
    const res = await fetch('./sample.json')
    const text = await res.text()
    loadData(text, 'sample.json', text.length)
  } catch (e) {
    showError('Could not load sample', String((e as Error).message || e))
  }
}

function pasteOpen() {
  const t = pasteArea.value.trim()
  if (!t) { toast('Paste area is empty'); return }
  loadData(t, 'pasted.json', t.length)
}

function rowLines(r: TreeRow, cpl: number) {
  let chars = 21
  if (r.type === 'open') chars = 20 + (r.key ? r.key.length + 2 : 0) + 20
  else if (r.type === 'value') chars = 20 + (r.key ? r.key.length + 2 : 0) + (typeof r.value === 'string' ? Math.min(r.value.length, 400) : 8)
  return Math.max(1, Math.ceil(chars / cpl))
}

function buildOffsets(t: JsonTree) {
  const el = treeEl.value
  if (!el) return
  const cpl = Math.max(20, Math.floor((el.clientWidth - 36) / CHAR_W))
  t.cpl = cpl
  const n = t.rows.length
  const heights = new Array(n)
  const offsets = new Array(n)
  let acc = 0
  for (let i = 0; i < n; i++) {
    const lines = rowLines(t.rows[i], cpl)
    heights[i] = lines
    offsets[i] = acc
    acc += lines * ROW_H
  }
  t.heights = heights
  t.offsets = offsets
  t.totalH = acc
}

function scalarHTML(r: TreeRow) {
  const v = r.value
  if (r.emptyKind) return '<span class="t-brace">' + (r.emptyKind === 'object' ? '{ }' : '[ ]') + '</span>'
  if (v === null) return '<span class="t-null">null</span>'
  const ty = typeof v
  if (ty === 'boolean') return '<span class="t-bool">' + v + '</span>'
  if (ty === 'number') return '<span class="t-num">' + v + '</span>'
  const s = String(v)
  return '<span class="t-str">"' + escapeHtml(s.length > 400 ? s.slice(0, 400) + '…' : s) + '"</span>'
}

function rowHTML(r: TreeRow, i: number, t: JsonTree) {
  const pad = r.depth >= 0 ? r.depth * 18 : 0
  let cls = 'node-line'
  if (t.matchSet.size && t.matchSet.has(i)) cls += ' match'
  if (t.curIdx === i) cls += ' focused'
  const style = 'padding-left:' + (pad + 6) + 'px'
  const keyHTML = r.key ? '<span class="t-key">' + escapeHtml(r.key) + '</span><span class="t-colon">: </span>' : ''
  if (r.type === 'open') {
    const open = !!(r.id && t.open.has(r.id))
    const label = r.count === 1 ? (r.kind === 'object' ? '1 key' : '1 item') : r.count + (r.kind === 'object' ? ' keys' : ' items')
    return '<div class="' + cls + '" style="' + style + '" data-i="' + i + '" data-toggle="' + r.id + '" role="button">' +
      '<span class="twisty">' + (open ? '▾' : '▸') + '</span>' + keyHTML +
      '<span class="t-brace">' + (r.kind === 'object' ? '{' : '[') + '</span>' +
      '<span class="t-ellipsis"> ' + label + '</span>' +
      '<span class="t-brace">' + (r.kind === 'object' ? '}' : ']') + '</span></div>'
  }
  if (r.type === 'close') {
    return '<div class="' + cls + '" style="' + style + '" data-i="' + i + '"><span class="twisty empty"></span><span class="t-brace">' + (r.kind === 'object' ? '}' : ']') + '</span></div>'
  }
  return '<div class="' + cls + '" style="' + style + '" data-i="' + i + '" data-copy="1">' +
    '<span class="twisty empty"></span>' + keyHTML + scalarHTML(r) + '</div>'
}

function renderTree() {
  const t = tree.value
  const el = treeEl.value
  if (!t || !el) return
  t.el = el
  const total = t.rows.length
  if (!total) { el.innerHTML = ''; return }
  buildOffsets(t)
  const scrollTop = el.scrollTop
  const viewH = el.clientHeight || 600
  let lo = 0, hi = total
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((t.offsets as number[])[mid] < scrollTop) lo = mid + 1
    else hi = mid
  }
  let start = Math.max(0, lo - 20)
  let end = lo
  while (end < total && (t.offsets as number[])[end] < scrollTop + viewH) end++
  end = Math.min(total, end + 20)
  let html = '<div style="height:' + (t.offsets as number[])[start] + 'px"></div>'
  for (let i = start; i < end; i++) html += rowHTML(t.rows[i], i, t)
  const lastEnd = (t.offsets as number[])[end - 1] + (t.heights as number[])[end - 1] * ROW_H
  html += '<div style="height:' + Math.max(0, t.totalH - lastEnd) + 'px"></div>'
  el.innerHTML = html
}

function onTreeClick(e: MouseEvent) {
  const t = tree.value
  if (!t) return
  const target = e.target as HTMLElement
  const tog = target.closest('[data-toggle]') as HTMLElement | null
  if (tog) {
    t.toggle(tog.dataset.toggle as string)
    renderTree()
    return
  }
  const copy = target.closest('[data-copy]') as HTMLElement | null
  if (copy) {
    const i = +(copy.dataset.i || -1)
    const row = t.rows[i]
    if (row) {
      const v = row.value
      copyText(v === null || v === undefined ? 'null' : String(v)).then((ok) => toast(ok ? 'Copied' : 'Copy failed'))
      t.curIdx = i
      crumbPath.value = row.path || '$'
      renderTree()
    }
  } else {
    const rowEl = target.closest('[data-i]') as HTMLElement | null
    if (rowEl) {
      t.curIdx = +(rowEl.dataset.i || -1)
      crumbPath.value = t.rows[t.curIdx]?.path || '$'
      renderTree()
    }
  }
}

function onTreeContext(e: MouseEvent) {
  e.preventDefault()
  const el = (e.target as HTMLElement).closest('[data-i]') as HTMLElement | null
  if (!el) return
  const pad = 12
  const w = 200
  const h = 160
  const x = Math.min(Math.max(pad, e.clientX), window.innerWidth - w - pad)
  const y = Math.min(Math.max(pad, e.clientY), window.innerHeight - h - pad)
  ctxMenu.value = { x, y, i: +(el.dataset.i || 0) }
}

function onTreeScroll() {
  if (scrollRaf) return
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0
    renderTree()
  })
}

function onTreeKey(e: KeyboardEvent) {
  const t = tree.value
  if (!t || !t.rows.length) return
  const n = t.rows.length
  if (e.key === 'ArrowDown') { e.preventDefault(); scrollToRow(Math.min(n - 1, t.curIdx + 1)) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); scrollToRow(Math.max(0, t.curIdx - 1)) }
  else if (e.key === 'ArrowRight') {
    e.preventDefault()
    const r = t.rows[t.curIdx]
    if (r?.type === 'open' && r.id && !t.open.has(r.id)) { t.toggle(r.id); renderTree() }
    else scrollToRow(Math.min(n - 1, t.curIdx + 1))
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault()
    const r = t.rows[t.curIdx]
    if (r?.type === 'open' && r.id && t.open.has(r.id)) { t.toggle(r.id); renderTree() }
    else scrollToRow(Math.max(0, t.curIdx - 1))
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    const r = t.rows[t.curIdx]
    if (r?.type === 'open' && r.id) { t.toggle(r.id); renderTree() }
  }
}

function scrollToRow(i: number) {
  const t = tree.value
  const el = treeEl.value
  if (!t || !el || !t.offsets) return
  t.curIdx = i
  el.scrollTop = Math.max(0, t.offsets[i] - el.clientHeight / 3)
  crumbPath.value = t.rows[i]?.path || '$'
  renderTree()
}

function setView(v: View) {
  view.value = v
  if (v === 'tree') nextTick(renderTree)
  if (v === 'raw') nextTick(renderRaw)
  if (v === 'table') renderTable()
  if (v === 'stats') renderStats()
}

function renderRaw() {
  const el = rawEl.value
  if (!el) return
  if (data.value == null && pretty.value) {
    el.innerHTML = highlightJSON(pretty.value)
    return
  }
  if (data.value == null) { el.innerHTML = ''; return }
  const txt = rawMode.value === 'minified'
    ? formatJSON(data.value, { minify: true })
    : formatJSON(data.value, { indent: 2, sortKeys: sortKeys.value })
  pretty.value = txt
  el.innerHTML = highlightJSON(txt)
  el.classList.toggle('wrap', wrap.value)
}

function renderTable() {
  const payload = data.value
  let rows: JsonValue[] | null = Array.isArray(payload) ? payload : null
  let info = ''
  if (!rows && payload && typeof payload === 'object') {
    for (const k of Object.keys(payload)) {
      if (Array.isArray((payload as Record<string, JsonValue>)[k])) {
        rows = (payload as Record<string, JsonValue>)[k] as JsonValue[]
        info = `Showing array “${k}” (${rows.length} rows)`
        break
      }
    }
  }
  if (!rows) { tableInfo.value = 'Table view works best for arrays of objects.'; tableHtml.value = ''; return }
  if (!rows.length) { tableInfo.value = 'Empty array.'; tableHtml.value = ''; return }
  const cols: string[] = []
  const seen = new Set<string>()
  rows.slice(0, 200).forEach((r) => {
    if (r && typeof r === 'object' && !Array.isArray(r)) {
      Object.keys(r).forEach((k) => { if (!seen.has(k)) { seen.add(k); cols.push(k) } })
    }
  })
  if (!cols.length) { tableInfo.value = 'No object rows to tabulate.'; tableHtml.value = ''; return }
  const limit = Math.min(rows.length, 200)
  let body = ''
  for (let i = 0; i < limit; i++) {
    const r = rows[i] as Record<string, JsonValue> | null
    body += '<tr>' + cols.map((c) => {
      let v: unknown = r ? r[c] : ''
      if (v !== null && typeof v === 'object') v = JSON.stringify(v)
      const s = v === undefined || v === null ? '' : String(v)
      return '<td title="' + escapeHtml(s) + '">' + escapeHtml(s.length > 120 ? s.slice(0, 120) + '…' : s) + '</td>'
    }).join('') + '</tr>'
  }
  tableHtml.value = '<thead><tr>' + cols.map((c) => '<th>' + escapeHtml(c) + '</th>').join('') + '</tr></thead><tbody>' + body + '</tbody>'
  tableInfo.value = (info || `Array with ${rows.length} items`) + (rows.length > limit ? ` — first ${limit}` : '')
}

function renderStats() {
  if (data.value == null) { statsHtml.value = ''; return }
  const stats = getStats(data.value)
  const total = stats.totalNodes
  const types = Object.entries(stats.types).filter(([, v]) => v).sort((a, b) => b[1] - a[1])
  statsHtml.value = `
    <div class="stats-grid">
      <div class="stat-card"><h4>Nodes</h4><div class="big">${total.toLocaleString()}</div></div>
      <div class="stat-card"><h4>Depth</h4><div class="big">${stats.maxDepth}</div></div>
      <div class="stat-card"><h4>Keys</h4><div class="big">${stats.totalKeys.toLocaleString()}</div></div>
      <div class="stat-card"><h4>Size</h4><div class="big">${formatBytes(fileSize.value)}</div></div>
    </div>
    <div class="stat-card"><h4>Types</h4>
      ${types.map(([k, v]) => {
        const pct = ((v / total) * 100).toFixed(1)
        return `<div style="display:flex;justify-content:space-between;margin:6px 0"><span>${escapeHtml(k)}</span><span>${v} · ${pct}%</span></div><div class="stat-bar"><div class="stat-bar-fill" style="width:${pct}%"></div></div>`
      }).join('')}
    </div>`
  viewerStatus.value = `${stats.totalNodes} nodes · depth ${stats.maxDepth}`
}

function updateStatus() {
  if (data.value == null) { viewerStatus.value = ''; return }
  const s = getStats(data.value)
  viewerStatus.value = `${s.totalNodes} nodes · depth ${s.maxDepth}`
}

function expandAll() {
  tree.value?.expandAll()
  renderTree()
  toast('Expanded all')
}
function collapseAll() {
  tree.value?.collapseAll()
  renderTree()
  toast('Collapsed')
}
function depthPlus() {
  if (!tree.value) return
  depthLevel.value++
  tree.value.expandToDepth(depthLevel.value)
  renderTree()
  toast('Expanded to depth ' + depthLevel.value)
  if (depthLevel.value > 10) depthLevel.value = 0
}

function openSchema() {
  if (data.value == null) return
  const out: string[] = []
  schemaLines(data.value, '$', out, 0)
  schemaText.value = out.join('\n')
  const s = getStats(data.value)
  schemaStatsHtml.value = Object.entries(s.types).map(([k, v]) => `${k}: ${v}`).join(' · ')
  schemaYaml.value = convertToYAML(data.value)
  schemaTab.value = 'schema'
  openSheet('schema')
}

function openSearch() {
  searchOpen.value = true
  nextTick(() => searchInput.value?.focus())
}
function closeSearch() {
  searchOpen.value = false
  if (tree.value) {
    tree.value.matchSet = new Set()
    tree.value.matchList = []
    tree.value.matchIdx = -1
    renderTree()
  }
}
function runSearch(q: string) {
  const t = tree.value
  if (!t) return
  const res = t.matches(q, { regex: searchRegex.value, caseSensitive: searchCase.value })
  t.matchSet = res.set
  t.matchList = res.list
  t.matchIdx = res.list.length ? 0 : -1
  searchCount.value = res.list.length ? '1/' + res.list.length : 'No matches'
  if (t.matchIdx >= 0) jumpMatch(0)
  else renderTree()
}
function onSearchInput() {
  if (searchTimer) window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => runSearch(searchQuery.value), 120)
}
function jumpMatch(rel: number) {
  const t = tree.value
  if (!t || !t.matchList.length) return
  t.matchIdx = (t.matchIdx + rel + t.matchList.length) % t.matchList.length
  let idx = t.matchList[t.matchIdx]
  const row = t.rows[idx]
  if (row?.type === 'open' && row.id && !t.open.has(row.id)) {
    t.toggle(row.id)
    const res = t.matches(searchQuery.value, { regex: searchRegex.value, caseSensitive: searchCase.value })
    t.matchSet = res.set
    t.matchList = res.list
    idx = t.matchList[t.matchIdx] ?? idx
  }
  scrollToRow(idx)
  searchCount.value = (t.matchIdx + 1) + '/' + t.matchList.length
}

async function shareFile() {
  if (!pretty.value) { toast('No file loaded'); return }
  const file = new File([pretty.value], fileName.value || 'file.json', { type: 'application/json' })
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: fileName.value }); return } catch (e) {
      if ((e as Error).name === 'AbortError') return
    }
  }
  downloadFile(fileName.value, pretty.value)
  toast('File saved')
}
function saveFile() {
  if (!pretty.value) { toast('No file loaded'); return }
  downloadFile(fileName.value, pretty.value)
  toast('File saved')
}
async function copyAll() {
  if (!pretty.value) { toast('No file loaded'); return }
  toast((await copyText(pretty.value)) ? 'Copied' : 'Copy failed')
}

function doValidate() {
  const r = validateJSON(pretty.value || '')
  toast(r.valid ? 'Valid JSON (' + r.format + ')' : 'Invalid: ' + r.error?.message)
}
function doFormat() {
  if (data.value == null) return
  pretty.value = formatJSON(data.value, { indent: 2, sortKeys: sortKeys.value })
  rawMode.value = 'pretty'
  setView('raw')
  toast('Formatted')
}
function doMinify() {
  if (data.value == null) return
  pretty.value = formatJSON(data.value, { minify: true })
  rawMode.value = 'minified'
  setView('raw')
  toast('Minified')
}
function doSort() {
  if (data.value == null) return
  data.value = sortKeysDeep(data.value)
  sortKeys.value = true
  tree.value = new JsonTree(data.value)
  pretty.value = formatJSON(data.value, { indent: 2, sortKeys: true })
  nextTick(renderTree)
  toast('Keys sorted')
}
async function doYAML() {
  if (data.value == null) return
  toast((await copyText(convertToYAML(data.value))) ? 'YAML copied' : 'Copy failed')
}
async function doCSV() {
  if (data.value == null) return
  const csv = convertToCSV(data.value)
  if (!csv) { toast('No tabular data'); return }
  toast((await copyText(csv)) ? 'CSV copied' : 'Copy failed')
}
function doCSVDownload() {
  if (data.value == null) return
  const csv = convertToCSV(data.value)
  if (!csv) { toast('No tabular data'); return }
  downloadFile(fileName.value.replace(/\.json$/i, '.csv'), csv, 'text/csv')
}
async function doFlatten() {
  if (data.value == null) return
  toast((await copyText(JSON.stringify(flatten(data.value), null, 2))) ? 'Flattened JSON copied' : 'Copy failed')
}
function runJsonPath() {
  if (data.value == null) return
  try {
    const res = jsonPath(data.value, jsonPathInput.value.trim() || '$')
    jsonPathOutput.value = JSON.stringify(res, null, 2)
    jsonPathShown.value = true
  } catch (e) {
    jsonPathOutput.value = String((e as Error).message)
    jsonPathShown.value = true
  }
}

async function ctxAction(kind: 'value' | 'path' | 'json') {
  const t = tree.value
  const i = ctxMenu.value?.i ?? -1
  ctxMenu.value = null
  const row = t?.rows[i]
  if (!row || !t) return
  if (kind === 'path') toast((await copyText(row.path || '$')) ? 'Copied path' : 'Copy failed')
  else if (kind === 'value') {
    const v = row.type === 'open' && row.id ? t.vals.get(row.id) : row.value
    toast((await copyText(typeof v === 'string' ? v : JSON.stringify(v, null, 2))) ? 'Copied' : 'Copy failed')
  } else {
    const v = row.type === 'open' && row.id ? t.vals.get(row.id) : row.value
    toast((await copyText(JSON.stringify(v, null, 2))) ? 'Copied JSON' : 'Copy failed')
  }
}

function queryShare() {
  navigator.serviceWorker?.getRegistration().then((reg) => {
    if (reg?.active) reg.active.postMessage({ type: 'QUERY_SHARE' })
  }).catch(() => {})
}

async function handleShared(entry: { files?: File[]; text?: string; url?: string; title?: string } | null) {
  if (!entry) return
  const f = entry.files?.[0]
  const key = f ? (f.name + ':' + f.size) : 'text:' + String(entry.text || entry.url || '').slice(0, 64)
  if (key === lastShareKey.value && Date.now() - lastShareAt.value < 5000) return
  lastShareKey.value = key
  lastShareAt.value = Date.now()
  if (f) { await openFile(f); return }
  const text = (entry.text || '').trim()
  if (text) {
    if (/^https?:\/\//i.test(text)) await loadURL(text)
    else loadData(text, entry.title || 'shared.json', text.length)
    return
  }
  if (entry.url) await loadURL(entry.url)
}

function onKey(e: KeyboardEvent) {
  const tag = (document.activeElement as HTMLElement | null)?.tagName || ''
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSheet('command'); return }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); openSearch(); return }
  if (e.key === 'Escape') {
    if (ctxMenu.value) { ctxMenu.value = null; return }
    if (searchOpen.value) { closeSearch(); return }
    if (sheet.value) { closeSheets(); return }
  }
  if (e.key === '/' && !/INPUT|TEXTAREA/i.test(tag)) { e.preventDefault(); openSearch() }
}

function onPaste(e: ClipboardEvent) {
  const tag = (document.activeElement as HTMLElement | null)?.tagName || ''
  if (/INPUT|TEXTAREA/i.test(tag)) return
  const text = e.clipboardData?.getData('text') || ''
  const t = text.trim()
  if (t.startsWith('{') || t.startsWith('[')) {
    try { JSON.parse(t); loadData(t, 'pasted.json', t.length); toast('Pasted JSON opened') } catch { /* ignore */ }
  }
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  dropOver.value = false
  const f = e.dataTransfer?.files?.[0]
  if (f) openFile(f)
}

onMounted(() => {
  document.body.dataset.page = page.value
  setupPwa(() => { updateAvailable.value = true })
  const saved = storage()?.getItem('json-opener-theme')
  applyTheme(saved === 'light' ? 'light' : 'dark')
  loadRecents()
  document.addEventListener('keydown', onKey)
  document.addEventListener('paste', onPaste)
  document.addEventListener('dragover', (e) => { e.preventDefault(); dropOver.value = true })
  document.addEventListener('drop', onDrop)
  window.addEventListener('resize', () => { if (tree.value) renderTree() })
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault()
    deferredPrompt = e as unknown as { prompt: () => void }
    canInstall.value = true
  })
  window.addEventListener('appinstalled', () => { canInstall.value = false; toast('App installed') })
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type === 'SHARE_TARGET') handleShared(e.data.data)
  })
  queryShare()
  const params = new URLSearchParams(location.search)
  const fileParam = params.get('file') || params.get('json') || params.get('url')
  if (fileParam) loadURL(fileParam)
  if (params.get('shared')) queryShare()
  if ('launchQueue' in window) {
    (window as unknown as { launchQueue: { setConsumer: (cb: (p: { files: { getFile: () => Promise<File> }[] }) => void) => void } })
      .launchQueue.setConsumer(async (p) => {
        for (const h of p.files || []) openFile(await h.getFile())
      })
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKey)
  document.removeEventListener('paste', onPaste)
})
</script>

<template>
  <div v-if="updateAvailable" class="update-banner">
    <span>A new version is ready.</span>
    <button class="btn primary compact" @click="applyUpdate()">Reload</button>
  </div>
  <header id="topbar">
    <button class="icon-btn" title="Back" aria-label="Back" :hidden="page === 'home'" @click="showHome">
      <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M15.4 4.6 13.8 3 5 12l8.8 9 1.6-1.6L8.2 12z"/></svg>
    </button>
    <div class="brand">
      <span class="brand-mark">{ }</span>
      <div class="brand-copy">
        <span class="brand-text">JSON Opener</span>
        <span class="brand-badge">Vue</span>
      </div>
    </div>
    <div class="topbar-actions">
      <button v-if="canInstall" class="btn ghost compact" @click="deferredPrompt?.prompt()">Install</button>
      <button class="icon-btn" title="Toggle theme" aria-label="Toggle theme" @click="toggleTheme">
        <svg class="i-moon" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z"/></svg>
        <svg class="i-sun" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0-4a1 1 0 0 0 1-1V2a1 1 0 1 0-2 0v1a1 1 0 0 0 1 1zm0 16a1 1 0 0 0-1 1v1a1 1 0 1 0 2 0v-1a1 1 0 0 0-1-1zM4 13H3a1 1 0 1 0 0-2h1a1 1 0 1 0 0 2zm17-1h-1a1 1 0 1 0 0 2h1a1 1 0 1 0 0-2z"/></svg>
      </button>
      <button class="icon-btn" title="Search" aria-label="Search" :hidden="page !== 'viewer'" @click="openSearch">
        <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M10.5 4a6.5 6.5 0 0 1 5.2 10.4l4 4a1 1 0 0 1-1.4 1.4l-4-4A6.5 6.5 0 1 1 10.5 4zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z"/></svg>
      </button>
      <button class="icon-btn hide-narrow" title="Command palette" aria-label="Commands" @click="openSheet('command')">
        <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M8 6a2 2 0 1 0-2 2v8a2 2 0 1 0 2 2h8a2 2 0 1 0 2-2V8a2 2 0 1 0-2-2H8zm0 2h8v8H8V8z"/></svg>
      </button>
      <button class="icon-btn" title="Menu" aria-label="Menu" @click="openSheet('menu')">
        <svg viewBox="0 0 24 24" width="18" height="18"><circle fill="currentColor" cx="12" cy="6" r="1.6"/><circle fill="currentColor" cx="12" cy="12" r="1.6"/><circle fill="currentColor" cx="12" cy="18" r="1.6"/></svg>
      </button>
    </div>
  </header>

  <div class="breadcrumbs" :hidden="page !== 'viewer' || view !== 'tree'" @click="copyText(crumbPath).then(ok => toast(ok ? 'Copied path' : 'Copy failed'))">
    <span class="crumb-path">{{ crumbPath }}</span>
    <button class="mini-btn hide-narrow" type="button">Copy path</button>
  </div>

  <main>
    <section v-show="page === 'home'" class="page page-home" :class="{ active: page === 'home' }">
      <div class="home-shell">
        <div class="home-intro">
          <p class="eyebrow">Local · Private · Offline</p>
          <h1>Open JSON</h1>
          <p class="lede">Share from Android, pick a file, or paste. Nothing leaves this device.</p>
        </div>
        <div class="dropzone" :class="{ dragover: dropOver }" tabindex="0" role="button" @click="fileInput?.click()" @dragover.prevent="dropOver = true" @dragleave="dropOver = false" @drop="onDrop">
          <div class="dz-visual"><span class="dz-icon">{ }</span></div>
          <h2>Drop a file here</h2>
          <p class="dz-hint">On Android: <strong>Share → JSON Opener</strong></p>
          <div class="dz-actions" @click.stop>
            <button class="btn primary" @click="fileInput?.click()">Choose file</button>
            <button class="btn" @click="loadSample">Sample</button>
          </div>
          <input ref="fileInput" type="file" accept=".json,application/json,text/plain,.jsonc,.jsonl,.geojson,.ndjson" hidden @change="openFile(($event.target as HTMLInputElement).files?.[0] || null); ($event.target as HTMLInputElement).value = ''">
        </div>
        <div class="intake">
          <div class="intake-tabs" role="tablist">
            <button type="button" class="chip" :class="{ active: homeTab === 'paste' }" @click="homeTab = 'paste'">Paste</button>
            <button type="button" class="chip" :class="{ active: homeTab === 'url' }" @click="homeTab = 'url'">URL</button>
          </div>
          <div v-show="homeTab === 'paste'" class="intake-card">
            <textarea id="paste-area" v-model="pasteArea" rows="4" placeholder='{"hello": "world"}' spellcheck="false"></textarea>
            <button class="btn primary" @click="pasteOpen">Open pasted JSON</button>
          </div>
          <div v-show="homeTab === 'url'" class="intake-card">
            <input v-model="urlInput" type="url" placeholder="https://api.example.com/data.json" @keydown.enter="urlInput && loadURL(urlInput)">
            <button class="btn" @click="urlInput && loadURL(urlInput)">Load URL</button>
          </div>
        </div>
        <div class="recent-panel">
          <div class="recent-head">
            <h3>Recently opened</h3>
            <button class="btn ghost small" @click="clearRecents">Clear</button>
          </div>
          <div class="recent-list">
            <span v-if="!recents.length" class="muted">Nothing here yet.</span>
            <button v-for="r in recents" :key="r.name + r.at" class="recent-item" @click="toast('Open a file to view ' + r.name + ' again')">
              <span class="recent-name">{{ r.name }}</span>
              <span class="muted">{{ formatBytes(r.size) }}</span>
            </button>
          </div>
        </div>
        <div v-if="errorOn" class="error-box">
          <div class="error-title">{{ errorTitle }}</div>
          <div class="error-msg">{{ errorMsg }}</div>
          <div class="error-actions">
            <button class="btn ghost" @click="errorOn = false">Dismiss</button>
            <button class="btn" @click="openAsText">Open as text</button>
          </div>
        </div>
      </div>
    </section>

    <section v-show="page === 'viewer'" class="page page-viewer" :class="{ active: page === 'viewer' }">
      <div class="viewer-head">
        <div class="file-info">
          <span class="file-name">{{ fileName }}</span>
          <span class="file-meta">{{ fileMeta }}</span>
        </div>
        <div class="view-switch" role="tablist" aria-label="View">
          <button class="chip" :class="{ active: view === 'tree' }" @click="setView('tree')">Tree</button>
          <button class="chip" :class="{ active: view === 'raw' }" @click="setView('raw')">Text</button>
          <button class="chip" :class="{ active: view === 'table' }" @click="setView('table')">Table</button>
          <button class="chip" :class="{ active: view === 'stats' }" @click="setView('stats')">Stats</button>
        </div>
      </div>
      <div class="viewer-toolbar">
        <div class="toolbar-left">
          <button class="chip" @click="expandAll">Expand</button>
          <button class="chip" @click="collapseAll">Collapse</button>
          <button class="chip hide-narrow" @click="depthPlus">Depth +1</button>
          <button class="chip primary-chip" @click="openSchema">Schema</button>
          <label class="toolbar-check hide-narrow"><input v-model="wrap" type="checkbox" @change="renderRaw"> Wrap</label>
          <label class="toolbar-check hide-narrow"><input v-model="sortKeys" type="checkbox" @change="doSort"> Sort keys</label>
        </div>
        <div class="toolbar-right">
          <span class="muted small hide-narrow">{{ viewerStatus }}</span>
          <button class="btn ghost small" @click="openSheet('tools')">Tools</button>
        </div>
      </div>
      <div v-show="searchOpen" class="search-box">
        <div class="search-row">
          <div class="search-input-wrap">
            <input ref="searchInput" v-model="searchQuery" type="search" placeholder="Search…" @input="onSearchInput" @keydown.enter.prevent="jumpMatch($event.shiftKey ? -1 : 1)" @keydown.esc="closeSearch">
            <span class="search-count">{{ searchCount }}</span>
          </div>
          <div class="search-nav">
            <button class="icon-btn" aria-label="Previous" @click="jumpMatch(-1)">↑</button>
            <button class="icon-btn" aria-label="Next" @click="jumpMatch(1)">↓</button>
            <button class="icon-btn" aria-label="Close search" @click="closeSearch">✕</button>
          </div>
        </div>
        <div class="search-options">
          <label><input v-model="searchRegex" type="checkbox" @change="runSearch(searchQuery)"> Regex</label>
          <label><input v-model="searchCase" type="checkbox" @change="runSearch(searchQuery)"> Aa</label>
        </div>
      </div>
      <div v-show="view === 'tree'" ref="treeEl" class="tree" tabindex="0" @click="onTreeClick" @contextmenu="onTreeContext" @scroll="onTreeScroll" @keydown="onTreeKey"></div>
      <div v-show="view === 'raw'" class="raw-wrap">
        <div class="raw-toolbar">
          <button class="chip" :class="{ active: rawMode === 'pretty' }" @click="rawMode = 'pretty'; renderRaw()">Pretty</button>
          <button class="chip" :class="{ active: rawMode === 'minified' }" @click="rawMode = 'minified'; renderRaw()">Minified</button>
          <button class="mini-btn" @click="copyAll">Copy</button>
        </div>
        <pre ref="rawEl" class="raw" :class="{ wrap }"></pre>
      </div>
      <div v-show="view === 'table'" class="table-wrap">
        <div class="table-info">{{ tableInfo }}</div>
        <div class="table-scroll"><table class="json-table" v-html="tableHtml"></table></div>
      </div>
      <div v-show="view === 'stats'" class="stats-view" v-html="statsHtml"></div>
    </section>

    <section v-show="page === 'info'" class="page page-info" :class="{ active: page === 'info' }">
      <div class="info-card">
        <p class="eyebrow">About</p>
        <h1>JSON Opener</h1>
        <p class="info-sub">A Vue 3 + TypeScript studio for JSON. Open files from the Android share sheet — no upload.</p>
        <div class="info-badges"><span class="badge">Vue 3</span><span class="badge">TypeScript</span><span class="badge">PWA</span><span class="badge">Offline</span></div>
        <h2>Install on Android</h2>
        <ol class="steps">
          <li>Open this page in <strong>Chrome</strong>.</li>
          <li>Tap <strong>⋮ → Install app</strong>.</li>
          <li>Share a JSON file and pick <strong>JSON Opener</strong>.</li>
        </ol>
        <h2>Shortcuts</h2>
        <div class="shortcuts">
          <div><kbd>Ctrl</kbd><kbd>F</kbd> Search</div>
          <div><kbd>Ctrl</kbd><kbd>K</kbd> Commands</div>
          <div><kbd>/</kbd> Search</div>
          <div><kbd>Esc</kbd> Close</div>
        </div>
        <div class="info-actions">
          <button class="btn primary" @click="showHome">Back to start</button>
          <button class="btn" @click="openSheet('shortcuts')">All shortcuts</button>
        </div>
      </div>
    </section>
  </main>

  <nav class="bottom-bar" :hidden="page !== 'viewer'">
    <button class="bb-btn" data-icon="↗" @click="shareFile">Share</button>
    <button class="bb-btn" data-icon="↓" @click="saveFile">Save</button>
    <button class="bb-btn" data-icon="⧉" @click="copyAll">Copy</button>
    <button class="bb-btn" data-icon="▢" @click="fileInput?.click()">Open</button>
  </nav>

  <div v-if="loading" class="loading">
    <div class="spinner"></div>
    <div class="loading-text">{{ loadingText }}</div>
  </div>
  <div v-if="toastOn" class="toast">{{ toastMsg }}</div>

  <div v-if="sheet === 'menu'" class="sheet">
    <div class="sheet-backdrop" @click="closeSheets"></div>
    <div class="sheet-panel">
      <div class="sheet-title">Menu</div>
      <button class="sheet-item" @click="closeSheets(); fileInput?.click()">Open file</button>
      <button class="sheet-item" @click="closeSheets(); showHome()">Paste JSON</button>
      <button class="sheet-item" @click="closeSheets(); setView(view === 'tree' ? 'raw' : 'tree')">Toggle text view</button>
      <button class="sheet-item" @click="closeSheets(); setView('table')">Table view</button>
      <button class="sheet-item" @click="closeSheets(); shareFile()">Share</button>
      <button class="sheet-item" @click="closeSheets(); saveFile()">Save</button>
      <button class="sheet-item" @click="closeSheets(); copyAll()">Copy</button>
      <button class="sheet-item" @click="closeSheets(); openSheet('tools')">Tools</button>
      <button class="sheet-item" @click="closeSheets(); openSheet('command')">Commands</button>
      <button class="sheet-item" @click="closeSheets(); toggleTheme()">Toggle theme</button>
      <button class="sheet-item" @click="closeSheets(); showInfo()">About &amp; help</button>
    </div>
  </div>

  <div v-if="sheet === 'schema'" class="sheet">
    <div class="sheet-backdrop" @click="closeSheets"></div>
    <div class="sheet-panel large">
      <div class="sheet-title">Schema &amp; stats</div>
      <div class="tabs">
        <button class="tab" :class="{ active: schemaTab === 'schema' }" @click="schemaTab = 'schema'">Schema</button>
        <button class="tab" :class="{ active: schemaTab === 'stats' }" @click="schemaTab = 'stats'">Stats</button>
        <button class="tab" :class="{ active: schemaTab === 'preview' }" @click="schemaTab = 'preview'">YAML preview</button>
      </div>
      <pre v-show="schemaTab === 'schema'" class="schema-output">{{ schemaText }}</pre>
      <div v-show="schemaTab === 'stats'" class="schema-stats">{{ schemaStatsHtml }}</div>
      <pre v-show="schemaTab === 'preview'" class="schema-output">{{ schemaYaml }}</pre>
      <div class="sheet-actions">
        <button class="btn ghost" @click="closeSheets">Close</button>
        <button class="btn primary" @click="copyText(schemaText).then(ok => toast(ok ? 'Schema copied' : 'Copy failed'))">Copy schema</button>
      </div>
    </div>
  </div>

  <div v-if="sheet === 'command'" class="sheet">
    <div class="sheet-backdrop" @click="closeSheets"></div>
    <div class="sheet-panel command-panel">
      <div class="sheet-title">Command palette</div>
      <input ref="commandInput" v-model="commandQuery" type="search" placeholder="Expand, sort, yaml, csv…" @keydown.enter="commands[0] && (closeSheets(), commands[0].run())">
      <div class="command-list">
        <button v-for="c in commands" :key="c.id" class="command-item" @click="closeSheets(); c.run()">{{ c.name }}</button>
      </div>
    </div>
  </div>

  <div v-if="sheet === 'jsonpath'" class="sheet">
    <div class="sheet-backdrop" @click="closeSheets"></div>
    <div class="sheet-panel">
      <div class="sheet-title">JSONPath</div>
      <input v-model="jsonPathInput" type="text" placeholder="$.users[0].name" @keydown.enter="runJsonPath">
      <div class="sheet-actions">
        <button class="btn ghost" @click="closeSheets">Close</button>
        <button class="btn primary" @click="runJsonPath">Run</button>
      </div>
      <pre v-show="jsonPathShown" class="schema-output">{{ jsonPathOutput }}</pre>
    </div>
  </div>

  <div v-if="sheet === 'shortcuts'" class="sheet">
    <div class="sheet-backdrop" @click="closeSheets"></div>
    <div class="sheet-panel">
      <div class="sheet-title">Keyboard shortcuts</div>
      <div class="shortcuts">
        <div><kbd>Ctrl</kbd><kbd>F</kbd> Search</div>
        <div><kbd>/</kbd> Search</div>
        <div><kbd>Ctrl</kbd><kbd>K</kbd> Commands</div>
        <div><kbd>↑</kbd><kbd>↓</kbd> Navigate</div>
        <div><kbd>Esc</kbd> Close</div>
      </div>
      <button class="btn primary" @click="closeSheets">Close</button>
    </div>
  </div>

  <div v-if="sheet === 'tools'" class="sheet">
    <div class="sheet-backdrop" @click="closeSheets"></div>
    <div class="sheet-panel">
      <div class="sheet-title">Tools</div>
      <button class="sheet-item" @click="closeSheets(); doValidate()">Validate</button>
      <button class="sheet-item" @click="closeSheets(); doFormat()">Format</button>
      <button class="sheet-item" @click="closeSheets(); doMinify()">Minify</button>
      <button class="sheet-item" @click="closeSheets(); doSort()">Sort keys</button>
      <button class="sheet-item" @click="closeSheets(); doYAML()">Copy as YAML</button>
      <button class="sheet-item" @click="closeSheets(); doCSV()">Copy as CSV</button>
      <button class="sheet-item" @click="closeSheets(); doCSVDownload()">Download CSV</button>
      <button class="sheet-item" @click="closeSheets(); doFlatten()">Flatten</button>
      <button class="sheet-item" @click="closeSheets(); openSheet('jsonpath')">JSONPath query…</button>
      <button class="sheet-item" @click="closeSheets()">Close</button>
    </div>
  </div>

  <div v-if="ctxMenu" class="ctx-menu" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }">
    <button class="ctx-item" @click="ctxAction('value')">Copy value</button>
    <button class="ctx-item" @click="ctxAction('path')">Copy path</button>
    <button class="ctx-item" @click="ctxAction('json')">Copy as JSON</button>
  </div>
</template>
