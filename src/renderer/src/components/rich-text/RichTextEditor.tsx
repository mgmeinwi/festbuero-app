/**
 * Gemeinsamer Rich-Text-Editor (TipTap) für Vorlagenblöcke und Zahlungstexte.
 *
 *   <RichTextEditor value={html} onChange={setHtml} ariaLabel="Zahlungstext Bar" minimal />
 *
 * - Werkzeugleiste: fett, kursiv, unterstrichen, Schriftgröße (pt), Ausrichtung, Zeilenumbruch, „Feld einfügen“.
 *   `minimal` = nur fett/kursiv/unterstrichen + „Feld einfügen“.
 * - Shift+Enter (oder ⌘/Strg+Enter) = harter Zeilenumbruch (`<br>`), Enter = neuer Absatz.
 * - Platzhalter sind atomare Bausteine: `<span data-placeholder="X">{X}</span>` (siehe placeholder-node.ts).
 *   Getipptes `{Rechnungsnummer}` wird automatisch zum Baustein.
 * - Ausgabe: HTML (TipTap `getHTML()`); ein leeres Dokument wird als `''` gemeldet.
 * - Der Wert ist kontrolliert: Ändert sich `value` von außen, wird der Inhalt ersetzt (ohne `onChange`).
 */
import { useEffect, useRef } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import { TextAlign } from '@tiptap/extension-text-align'
import { FontSize, TextStyle } from '@tiptap/extension-text-style'
import StarterKit from '@tiptap/starter-kit'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  CornerDownLeft,
  Italic,
  Underline as UnderlineIcon,
  type LucideIcon
} from 'lucide-react'
import type { TextAlign as Align } from '@shared/types'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn, modKey } from '@/lib/utils'
import { PlaceholderMenu } from './PlaceholderMenu'
import { PlaceholderNode } from './placeholder-node'

export interface RichTextEditorProps {
  value: string
  onChange(html: string): void
  ariaLabel: string
  /** nur fett/kursiv/unterstrichen + „Feld einfügen“ */
  minimal?: boolean
  className?: string
  /** Platzhaltertext bei leerem Inhalt (optional) */
  placeholder?: string
  /** Standardausrichtung des Inhalts (nur Anzeige; Absätze können abweichen) */
  defaultAlign?: Align
  /** Grundschriftgröße des Blocks in pt (nur Anzeige im Editor) */
  baseFontSizePt?: number
  /** id für <label htmlFor> (optional) */
  id?: string
}

/** Auswählbare Schriftgrößen in pt. */
export const FONT_SIZES_PT = [6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28] as const

const ALIGNMENTS: ReadonlyArray<{ value: Align; label: string; icon: LucideIcon }> = [
  { value: 'left', label: 'Linksbündig', icon: AlignLeft },
  { value: 'center', label: 'Zentriert', icon: AlignCenter },
  { value: 'right', label: 'Rechtsbündig', icon: AlignRight },
  { value: 'justify', label: 'Blocksatz', icon: AlignJustify }
]

const EMPTY_DOC = /^(<p>(<br>)?<\/p>)?$/

function normalizeOutput(html: string): string {
  return EMPTY_DOC.test(html.trim()) ? '' : html
}

function ToolbarButton({
  label,
  shortcut,
  icon: Icon,
  active,
  onClick,
  disabled
}: {
  label: string
  shortcut?: string
  icon: LucideIcon
  active?: boolean
  onClick(): void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors',
        'hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60',
        'disabled:pointer-events-none disabled:opacity-50',
        active && 'bg-accent text-accent-foreground'
      )}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      title={shortcut ? `${label} (${shortcut})` : label}
      // Fokus im Editor behalten (Markierung bleibt sichtbar)
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  )
}

function Divider() {
  return <span className="mx-0.5 h-5 w-px shrink-0 bg-border" aria-hidden />
}

interface ToolbarState {
  bold: boolean
  italic: boolean
  underline: boolean
  align: Align | null
  fontSize: string | null
}

function Toolbar({ editor, minimal }: { editor: Editor; minimal: boolean }) {
  const state = useEditorState<ToolbarState>({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      align: ALIGNMENTS.find((a) => e.isActive({ textAlign: a.value }))?.value ?? null,
      fontSize: (e.getAttributes('textStyle').fontSize as string | undefined) ?? null
    })
  })
  const fontSizeValue = state.fontSize ? String(Number.parseFloat(state.fontSize)) : 'default'

  return (
    <div
      role="toolbar"
      aria-label="Formatierung"
      className="flex flex-wrap items-center gap-0.5 border-b bg-muted/40 px-1 py-1"
    >
      <ToolbarButton
        label="Fett"
        shortcut={`${modKey}+B`}
        icon={Bold}
        active={state.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <ToolbarButton
        label="Kursiv"
        shortcut={`${modKey}+I`}
        icon={Italic}
        active={state.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <ToolbarButton
        label="Unterstrichen"
        shortcut={`${modKey}+U`}
        icon={UnderlineIcon}
        active={state.underline}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      />
      {minimal ? null : (
        <>
          <Divider />
          <Select
            value={FONT_SIZES_PT.map(String).includes(fontSizeValue) || fontSizeValue === 'default' ? fontSizeValue : 'default'}
            onValueChange={(v) => {
              if (v === 'default') editor.chain().focus().unsetFontSize().run()
              else editor.chain().focus().setFontSize(`${v}pt`).run()
            }}
          >
            <SelectTrigger size="sm" className="h-8 w-[5.5rem] gap-1 px-2 text-xs" aria-label="Schriftgröße" title="Schriftgröße (pt)">
              <SelectValue />
            </SelectTrigger>
            <SelectContent onCloseAutoFocus={(e) => {
              e.preventDefault()
              editor.commands.focus()
            }}>
              <SelectItem value="default">Standard</SelectItem>
              {FONT_SIZES_PT.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size} pt
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Divider />
          {ALIGNMENTS.map((a) => (
            <ToolbarButton
              key={a.value}
              label={a.label}
              icon={a.icon}
              active={state.align === a.value}
              onClick={() => {
                if (state.align === a.value) editor.chain().focus().unsetTextAlign().run()
                else editor.chain().focus().setTextAlign(a.value).run()
              }}
            />
          ))}
          <Divider />
          <ToolbarButton
            label="Zeilenumbruch"
            shortcut="Shift+Enter"
            icon={CornerDownLeft}
            onClick={() => editor.chain().focus().setHardBreak().run()}
          />
        </>
      )}
      <Divider />
      <PlaceholderMenu
        preventFocusReturn
        onInsert={(field) => {
          editor.chain().focus().insertPlaceholder(field).run()
        }}
      />
    </div>
  )
}

export function RichTextEditor({
  value,
  onChange,
  ariaLabel,
  minimal = false,
  className,
  placeholder,
  defaultAlign,
  baseFontSizePt,
  id
}: RichTextEditorProps) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  /** zuletzt gemeldeter bzw. übernommener Wert (verhindert Rücksetzen beim Tippen) */
  const lastValueRef = useRef(value)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        link: false,
        strike: false,
        trailingNode: false,
        dropcursor: false
      }),
      TextStyle,
      FontSize,
      TextAlign.configure({ types: ['paragraph'], alignments: ['left', 'center', 'right', 'justify'] }),
      PlaceholderNode
    ],
    content: value || '',
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        'aria-label': ariaLabel,
        'aria-multiline': 'true',
        role: 'textbox',
        ...(id ? { id } : {}),
        ...(placeholder ? { 'data-placeholder-text': placeholder } : {}),
        class: cn(
          'min-h-16 px-3 py-2 leading-relaxed outline-none',
          '[&_p]:min-h-[1lh] [&_strong]:font-semibold'
        )
      }
    },
    onUpdate: ({ editor: e }) => {
      const html = normalizeOutput(e.getHTML())
      if (html === lastValueRef.current) return
      lastValueRef.current = html
      onChangeRef.current(html)
    }
  })

  // Externe Änderungen übernehmen (z. B. „Auf Standard zurücksetzen“, anderer Block gewählt)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (value === lastValueRef.current) return
    lastValueRef.current = value
    editor.commands.setContent(value || '', { emitUpdate: false })
  }, [editor, value])

  // aria-label aktuell halten
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.view.dom.setAttribute('aria-label', ariaLabel)
  }, [editor, ariaLabel])

  const isEmpty = !value

  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border border-input bg-background shadow-xs transition-[color,box-shadow] dark:bg-input/30',
        'focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
        className
      )}
      data-slot="rich-text-editor"
    >
      {editor ? <Toolbar editor={editor} minimal={minimal} /> : null}
      <div
        className="relative text-sm"
        style={{
          textAlign: defaultAlign,
          fontSize: baseFontSizePt ? `${Math.min(Math.max(baseFontSizePt, 7), 18)}pt` : undefined
        }}
      >
        {placeholder && isEmpty ? (
          <div className="pointer-events-none absolute inset-x-3 top-2 truncate text-sm text-muted-foreground" aria-hidden>
            {placeholder}
          </div>
        ) : null}
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}

export default RichTextEditor
