/**
 * Bereinigt Rich-Text-HTML (TipTap-Ausgabe aus Vorlage und Zahlungstexten), bevor es in die Rechnung kommt.
 *
 * - Erlaubt nur einfache Formatierung: p, br, strong/b, em/i, u, s, span, div, sub, sup, small.
 * - Attribute: nur `style` (gefiltert: font-size, text-align, font-weight, font-style, text-decoration)
 *   und `data-placeholder` (Platzhalter-Baustein). Alles andere (Ereignis-Handler, Links, Bilder, Skripte,
 *   Styles, iframes …) wird entfernt; bei script/style/iframe & Co. samt Inhalt.
 * - Tags werden ausbalanciert (offene Tags am Ende geschlossen), damit z. B. ein ungeschlossenes `<strong>`
 *   nicht in die übrige Rechnung „ausläuft“.
 *
 * Plattformneutral (reine Zeichenkettenverarbeitung, kein DOM).
 */

const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'span', 'div', 'sub', 'sup', 'small'])
const BLOCK_TAGS = new Set(['p', 'div'])
const VOID_TAGS = new Set(['br'])
/** Tags, deren Inhalt komplett verworfen wird */
const DROP_CONTENT_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'template',
  'noscript',
  'textarea',
  'title',
  'xmp',
  'svg',
  'math',
  'head',
  'select',
  'option',
  'noembed',
  'noframes',
  'frameset',
  'frame',
  'applet'
])

const TOKEN_RE =
  /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<![^>]*>?|<\?[^>]*>?|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g
const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

const PLACEHOLDER_ATTR_RE = /^[A-Za-zÄÖÜäöüß]+(?:_[^{}<>"]+)?$/
const FONT_SIZE_RE = /^\d{1,3}(?:\.\d{1,3})?(?:pt|px|em|rem|%)$/
const STYLE_RULES: Record<string, RegExp> = {
  'font-size': FONT_SIZE_RE,
  'text-align': /^(?:left|center|right|justify|start|end)$/,
  'font-weight': /^(?:normal|bold|bolder|lighter|[1-9]00)$/,
  'font-style': /^(?:normal|italic|oblique)$/,
  'text-decoration': /^(?:none|underline|line-through)(?:\s+(?:underline|line-through))?$/,
  'text-decoration-line': /^(?:none|underline|line-through)(?:\s+(?:underline|line-through))?$/
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);?/g, (_m, d: string) => String.fromCodePoint(Math.min(Number(d), 0x10ffff)))
    .replace(/&#x([0-9a-f]+);?/gi, (_m, h: string) => String.fromCodePoint(Math.min(Number.parseInt(h, 16), 0x10ffff)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Text zwischen Tags: spitze Klammern escapen, vorhandene Entities unverändert lassen. */
function sanitizeText(text: string): string {
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Gefilterter style-Wert oder null. */
export function sanitizeStyle(style: string): string | null {
  const out: string[] = []
  for (const decl of decodeEntities(style).split(';')) {
    const idx = decl.indexOf(':')
    if (idx < 0) continue
    const prop = decl.slice(0, idx).trim().toLowerCase()
    const value = decl
      .slice(idx + 1)
      .trim()
      .replace(/\s*!important$/i, '')
      .toLowerCase()
    const rule = STYLE_RULES[prop]
    if (rule && rule.test(value)) out.push(`${prop}: ${value}`)
  }
  return out.length > 0 ? out.join('; ') : null
}

function sanitizeAttributes(raw: string): string {
  const attrs: string[] = []
  for (const m of raw.matchAll(ATTR_RE)) {
    const name = (m[1] ?? '').toLowerCase()
    const value = m[2] ?? m[3] ?? m[4] ?? ''
    if (name === 'style') {
      const style = sanitizeStyle(value)
      if (style) attrs.push(`style="${escapeAttr(style)}"`)
    } else if (name === 'data-placeholder') {
      const decoded = decodeEntities(value).trim()
      if (PLACEHOLDER_ATTR_RE.test(decoded)) attrs.push(`data-placeholder="${escapeAttr(decoded)}"`)
    }
  }
  return attrs.length > 0 ? ` ${attrs.join(' ')}` : ''
}

/** Bereinigt Rich-Text-HTML (siehe Moduldokumentation). Nicht-Strings → ''. */
export function sanitizeRichHtml(html: unknown): string {
  if (typeof html !== 'string' || html === '') return ''
  const out: string[] = []
  const stack: string[] = []
  let last = 0
  let dropUntil: string | null = null

  const closeTo = (index: number): void => {
    while (stack.length > index) out.push(`</${stack.pop()!}>`)
  }

  TOKEN_RE.lastIndex = 0
  for (let m = TOKEN_RE.exec(html); m !== null; m = TOKEN_RE.exec(html)) {
    const text = html.slice(last, m.index)
    last = TOKEN_RE.lastIndex
    if (dropUntil) {
      if (m[2] && m[1] === '/' && m[2].toLowerCase() === dropUntil) dropUntil = null
      continue
    }
    if (text) out.push(sanitizeText(text))
    const tagName = m[2]?.toLowerCase()
    if (!tagName) continue // Kommentar, Doctype, CDATA, Processing Instruction
    const isClose = m[1] === '/'
    const selfClosing = m[4] === '/'

    if (DROP_CONTENT_TAGS.has(tagName)) {
      if (!isClose && !selfClosing) dropUntil = tagName
      continue
    }
    if (!ALLOWED_TAGS.has(tagName)) continue
    const tag = tagName === 'b' ? 'strong' : tagName === 'i' ? 'em' : tagName

    if (VOID_TAGS.has(tag)) {
      if (!isClose) out.push(`<${tag}>`)
      continue
    }
    if (isClose) {
      const idx = stack.lastIndexOf(tag)
      if (idx >= 0) closeTo(idx)
      continue
    }
    // Absätze/Blöcke nicht in Absätze schachteln (wie der HTML-Parser: offenes <p> schließen)
    if (BLOCK_TAGS.has(tag)) {
      const pIdx = stack.lastIndexOf('p')
      if (pIdx >= 0) closeTo(pIdx)
    }
    out.push(`<${tag}${sanitizeAttributes(m[3] ?? '')}>`)
    if (selfClosing) out.push(`</${tag}>`)
    else stack.push(tag)
  }
  if (!dropUntil) {
    const rest = html.slice(last)
    if (rest) out.push(sanitizeText(rest))
  }
  closeTo(0)
  return out.join('')
}

/** Reiner Text eines Rich-Text-HTML (z. B. für Vorschau-Listen im Editor). */
export function richHtmlToPlainText(html: string): string {
  return decodeEntities(
    sanitizeRichHtml(html)
      .replace(/<br>/g, ' ')
      .replace(/<\/(p|div)>/g, ' ')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\s+/g, ' ')
    .trim()
}
