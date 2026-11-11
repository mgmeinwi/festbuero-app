/**
 * TipTap-Knoten „Platzhalter“: atomarer, nicht trennbarer Inline-Baustein.
 *
 * Serialisierung (getHTML): `<span data-placeholder="Rechnungsdatum_DE">{Rechnungsdatum_DE}</span>`
 * – der Renderer ersetzt den Text `{…}`; beim Laden wird das `span` wieder als Baustein erkannt.
 * Im Editor wird der Baustein als Chip mit deutscher Beschriftung angezeigt.
 */
import { InputRule, mergeAttributes, Node } from '@tiptap/core'
import { PLACEHOLDERS, resolvePlaceholderField } from '@shared/placeholders'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    placeholderField: {
      /** Fügt einen Platzhalter-Baustein ein, z. B. `insertPlaceholder('Rechnungsnummer')` */
      insertPlaceholder: (field: string) => ReturnType
    }
  }
}

/** Erlaubte Zeichen im Platzhalter-Inhalt (Feld + optionale Variante). */
const FIELD_RE = /^[A-Za-zÄÖÜäöüß]+(?:_[^{}<>"]+)?$/

/** Normalisiert `{Feld}` bzw. `Feld` → `Feld` (ohne Klammern); ungültig → null. */
export function normalizePlaceholderField(value: string | null | undefined): string | null {
  if (!value) return null
  const inner = value.trim().replace(/^\{/, '').replace(/\}$/, '')
  return FIELD_RE.test(inner) ? inner : null
}

/** Deutsche Beschriftung eines Platzhalters für den Chip (Fallback: der Rohname). */
export function placeholderLabel(field: string): { label: string; example: string | null } {
  const def = PLACEHOLDERS.find((p) => p.token === `{${field}}`)
  if (def) return { label: def.label, example: def.example }
  const [name, variant] = field.split(/_(.*)/s)
  const resolved = name ? resolvePlaceholderField(name) : null
  if (resolved) return { label: variant ? `${resolved} (${variant})` : resolved, example: null }
  return { label: field, example: null }
}

export const PlaceholderNode = Node.create({
  name: 'placeholder',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      field: {
        default: '',
        parseHTML: (element) => normalizePlaceholderField(element.getAttribute('data-placeholder')) ?? '',
        renderHTML: (attributes) => ({ 'data-placeholder': attributes.field as string })
      }
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-placeholder]',
        // ungültige Bausteine als normalen Text behandeln
        getAttrs: (element) => (normalizePlaceholderField(element.getAttribute('data-placeholder')) ? null : false)
      }
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), `{${node.attrs.field as string}}`]
  },

  renderText({ node }) {
    return `{${node.attrs.field as string}}`
  },

  addNodeView() {
    return ({ node }) => {
      const field = node.attrs.field as string
      const { label, example } = placeholderLabel(field)
      const dom = document.createElement('span')
      dom.className =
        'rt-chip mx-px inline-flex items-center rounded-md border border-primary/30 bg-primary/10 px-1.5 align-baseline text-[0.85em] leading-snug font-medium text-primary select-none whitespace-nowrap dark:bg-primary/20'
      dom.setAttribute('data-placeholder', field)
      dom.setAttribute('contenteditable', 'false')
      dom.title = example ? `Feld „${label}“ – z. B. ${example}` : `Feld „${label}“`
      dom.textContent = label
      return { dom }
    }
  },

  addCommands() {
    return {
      insertPlaceholder:
        (field: string) =>
        ({ chain }) => {
          const normalized = normalizePlaceholderField(field)
          if (!normalized) return false
          return chain().insertContent({ type: this.name, attrs: { field: normalized } }).run()
        }
    }
  },

  addInputRules() {
    // Getipptes `{Rechnungsnummer}` wird automatisch zum Baustein (nur bekannte Felder).
    const type = this.type
    return [
      new InputRule({
        find: /\{([A-Za-zÄÖÜäöüß]+(?:_[^{}<>"]+)?)\}$/,
        handler: ({ state, range, match }) => {
          const field = normalizePlaceholderField(match[1])
          const name = field?.split('_')[0] ?? ''
          if (!field || !resolvePlaceholderField(name)) return null
          state.tr.replaceWith(range.from, range.to, type.create({ field }))
        }
      })
    ]
  }
})
