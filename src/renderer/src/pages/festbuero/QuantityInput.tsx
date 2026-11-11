import { useRef, useState, type ComponentProps, type KeyboardEvent, type Ref } from 'react'
import { normalizeQuantity, sanitizeQuantityInput, stepQuantity } from '@shared/invoice-draft'
import { cn } from '@/lib/utils'

export interface QuantityInputProps extends Omit<
  ComponentProps<'input'>,
  'value' | 'onChange' | 'type' | 'ref' | 'defaultValue'
> {
  value: number
  onValueChange: (value: number) => void
  /** Enter gedrückt (z. B. zum nächsten Feld springen) */
  onEnter?: () => void
  inputRef?: Ref<HTMLInputElement>
}

/**
 * Mengenfeld: nur Ziffern, Inhalt beim Fokus markiert (Tippen ersetzt), ↑/↓ ändern um 1
 * (mit ⇧ um 10). Während der Eingabe darf das Feld leer sein (= 0).
 */
export function QuantityInput({
  value,
  onValueChange,
  onEnter,
  inputRef,
  className,
  onFocus,
  onBlur,
  onKeyDown,
  ...props
}: QuantityInputProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const justFocused = useRef(false)
  const text = draft ?? String(value)

  function commit(next: number) {
    setDraft(String(next))
    if (next !== value) onValueChange(next)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    onKeyDown?.(e)
    if (e.defaultPrevented) return
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const el = e.currentTarget
      const step = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1)
      commit(stepQuantity(normalizeQuantity(text), step))
      setTimeout(() => el.select(), 0)
    } else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey && onEnter) {
      e.preventDefault()
      onEnter()
    }
  }

  return (
    <input
      {...props}
      ref={inputRef}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      value={text}
      onChange={(e) => {
        const clean = sanitizeQuantityInput(e.target.value)
        setDraft(clean)
        const next = normalizeQuantity(clean)
        if (next !== value) onValueChange(next)
      }}
      onFocus={(e) => {
        justFocused.current = true
        e.currentTarget.select()
        onFocus?.(e)
      }}
      onMouseUp={(e) => {
        // Klick ins Feld soll die Markierung nicht wieder aufheben
        if (justFocused.current) e.preventDefault()
        justFocused.current = false
      }}
      onBlur={(e) => {
        justFocused.current = false
        setDraft(null)
        onBlur?.(e)
      }}
      onKeyDown={handleKeyDown}
      className={cn(
        'flex h-10 min-w-0 rounded-md border border-input bg-background px-2.5 text-right text-base tabular-nums shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground dark:bg-input/30',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        className
      )}
    />
  )
}
