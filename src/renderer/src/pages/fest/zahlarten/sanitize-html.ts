/**
 * Minimaler HTML-Filter für die Beispielanzeige der Zahlungstexte (Renderer, nutzt DOMParser).
 * Erlaubt nur einfache Textformatierung; Skripte, Event-Attribute und Links werden entfernt.
 */
const ALLOWED_TAGS = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'SPAN', 'DIV', 'SUB', 'SUP', 'MARK'])
const DROP_WITH_CONTENT = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'MATH'])
const SAFE_STYLE = /^[\w\s:;.,%#()'"-]*$/

function clean(node: Element): void {
  for (const child of Array.from(node.children)) {
    if (DROP_WITH_CONTENT.has(child.tagName)) {
      child.remove()
      continue
    }
    clean(child)
    if (!ALLOWED_TAGS.has(child.tagName)) {
      child.replaceWith(...Array.from(child.childNodes))
      continue
    }
    for (const attr of Array.from(child.attributes)) {
      const name = attr.name.toLowerCase()
      const keepStyle = name === 'style' && SAFE_STYLE.test(attr.value) && !/url\s*\(|expression/i.test(attr.value)
      if (!keepStyle && name !== 'data-placeholder') child.removeAttribute(attr.name)
    }
  }
}

export function sanitizeHtml(html: string): string {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const root = doc.body.firstElementChild
  if (!root) return ''
  clean(root)
  return root.innerHTML
}
