import { escapeHtml } from './core'

const TOKEN_RE = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g

export function highlightJSON(text: string): string {
  let out = ''
  let last = 0
  TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(text))) {
    out += escapeHtml(text.slice(last, m.index))
    if (m[1] !== undefined) {
      if (m[2] !== undefined) out += '<span class="t-key">' + escapeHtml(m[1]) + '</span><span class="t-colon">:</span>'
      else out += '<span class="t-str">' + escapeHtml(m[1]) + '</span>'
    } else if (m[3] !== undefined) {
      out += '<span class="' + (m[3] === 'null' ? 't-null' : 't-bool') + '">' + m[3] + '</span>'
    } else out += '<span class="t-num">' + m[0] + '</span>'
    last = m.index + m[0].length
  }
  out += escapeHtml(text.slice(last))
  return out
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
      return true
    } catch {
      return false
    }
  }
}

export function downloadFile(name: string, content: string, type = 'application/json') {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
