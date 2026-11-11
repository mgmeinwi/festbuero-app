/**
 * Einzeiliges Textfeld (reiner Text, kein HTML) mit „Feld einfügen“. Fügt `{Feld}` an der Cursorposition ein.
 * Genutzt für Infozeilen der Vorlage (Wert, z. B. „{Leistungsdatum}“).
 */
import { useRef } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { PlaceholderMenu } from './PlaceholderMenu'

export interface PlaceholderInputProps {
  value: string
  onChange(value: string): void
  ariaLabel: string
  id?: string
  placeholder?: string
  className?: string
  maxLength?: number
}

export function PlaceholderInput({ value, onChange, ariaLabel, id, placeholder, className, maxLength }: PlaceholderInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const selectionRef = useRef<{ start: number; end: number } | null>(null)

  function rememberSelection() {
    const el = inputRef.current
    if (!el) return
    selectionRef.current = { start: el.selectionStart ?? el.value.length, end: el.selectionEnd ?? el.value.length }
  }

  function insert(field: string) {
    const token = `{${field}}`
    const sel = selectionRef.current ?? { start: value.length, end: value.length }
    const next = value.slice(0, sel.start) + token + value.slice(sel.end)
    onChange(maxLength ? next.slice(0, maxLength) : next)
    const caret = sel.start + token.length
    selectionRef.current = { start: caret, end: caret }
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(caret, caret)
    })
  }

  return (
    <div className={cn('flex min-w-0 items-center gap-1', className)}>
      <Input
        ref={inputRef}
        id={id}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        maxLength={maxLength}
        className="h-9 min-w-0 flex-1"
        onChange={(e) => {
          onChange(e.target.value)
          selectionRef.current = { start: e.target.selectionStart ?? 0, end: e.target.selectionEnd ?? 0 }
        }}
        onSelect={rememberSelection}
        onKeyUp={rememberSelection}
        onBlur={rememberSelection}
      />
      <PlaceholderMenu iconOnly preventFocusReturn onInsert={insert} className="size-9 shrink-0 px-0" />
    </div>
  )
}
