/**
 * Kleine Formular-Bausteine des Vorlagen-Editors (Zahlenfeld mit Einheit, Ausrichtung, Formatzeile).
 */
import { useEffect, useId, useState, type ReactNode } from 'react'
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, type LucideIcon } from 'lucide-react'
import type { TextAlign } from '@shared/types'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export function Field({
  label,
  htmlFor,
  hint,
  children,
  className
}: {
  label: ReactNode
  htmlFor?: string
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <Label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function parseNumber(text: string): number | null {
  const n = Number.parseFloat(text.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function formatNumber(value: number | undefined): string {
  return value === undefined ? '' : String(value).replace('.', ',')
}

/**
 * Zahlenfeld mit Einheit (pt/mm). Übernimmt beim Tippen gültige Werte innerhalb der Grenzen,
 * korrigiert beim Verlassen. `optional` erlaubt ein leeres Feld (= Standard).
 */
export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  ariaLabel,
  id,
  optional,
  placeholder,
  className
}: {
  value: number | undefined
  onChange(value: number | undefined): void
  min: number
  max: number
  step?: number
  unit: string
  ariaLabel?: string
  id?: string
  optional?: boolean
  placeholder?: string
  className?: string
}) {
  const [text, setText] = useState(formatNumber(value))
  // Änderungen von außen übernehmen, ohne die laufende Eingabe zu stören
  useEffect(() => {
    setText((prev) => {
      const parsed = prev.trim() === '' ? undefined : parseNumber(prev)
      return parsed === value ? prev : formatNumber(value)
    })
  }, [value])

  const commit = (raw: string, final: boolean) => {
    if (raw.trim() === '') {
      if (optional) onChange(undefined)
      else if (final) setText(formatNumber(value))
      return
    }
    const n = parseNumber(raw)
    if (n === null) {
      if (final) setText(formatNumber(value))
      return
    }
    const rounded = Math.round(n / step) * step
    const clamped = Math.min(max, Math.max(min, Math.round(rounded * 100) / 100))
    if (n >= min && n <= max) onChange(clamped)
    if (final) {
      onChange(clamped)
      setText(formatNumber(clamped))
    }
  }

  return (
    <div className={cn('relative w-28 shrink-0', className)}>
      <Input
        id={id}
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="h-9 pr-9 tabular-nums"
        onChange={(e) => {
          setText(e.target.value)
          commit(e.target.value, false)
        }}
        onBlur={(e) => commit(e.target.value, true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const base = parseNumber(text) ?? value ?? min
            const next = Math.min(max, Math.max(min, base + (e.key === 'ArrowUp' ? step : -step)))
            const rounded = Math.round(next * 100) / 100
            setText(formatNumber(rounded))
            onChange(rounded)
          } else if (e.key === 'Enter') {
            commit((e.target as HTMLInputElement).value, true)
          }
        }}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">{unit}</span>
    </div>
  )
}

const ALIGN_OPTIONS: ReadonlyArray<{ value: TextAlign; label: string; icon: LucideIcon }> = [
  { value: 'left', label: 'Linksbündig', icon: AlignLeft },
  { value: 'center', label: 'Zentriert', icon: AlignCenter },
  { value: 'right', label: 'Rechtsbündig', icon: AlignRight },
  { value: 'justify', label: 'Blocksatz', icon: AlignJustify }
]

/** Segmentierte Auswahl (Radiogruppe) – tastaturbedienbar mit Pfeiltasten. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className
}: {
  value: T
  onChange(value: T): void
  options: ReadonlyArray<{ value: T; label: string; icon?: LucideIcon; iconOnly?: boolean }>
  ariaLabel: string
  className?: string
}) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  )
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('inline-flex shrink-0 rounded-md border bg-muted/40 p-0.5', className)}>
      {options.map((o, i) => {
        const Icon = o.icon
        const checked = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={o.iconOnly ? o.label : undefined}
            title={o.label}
            tabIndex={i === index ? 0 : -1}
            className={cn(
              'inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-[5px] px-2 text-sm text-muted-foreground outline-none transition-colors',
              'hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60',
              checked && 'bg-background text-foreground shadow-xs dark:bg-input/60'
            )}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
              e.preventDefault()
              const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1
              const next = options[(i + dir + options.length) % options.length]!
              onChange(next.value)
              const group = e.currentTarget.parentElement
              requestAnimationFrame(() => group?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus())
            }}
          >
            {Icon ? <Icon className="size-4" aria-hidden /> : null}
            {o.iconOnly ? null : <span>{o.label}</span>}
          </button>
        )
      })}
    </div>
  )
}

export function AlignControl({
  value,
  onChange,
  ariaLabel = 'Ausrichtung'
}: {
  value: TextAlign | undefined
  onChange(value: TextAlign): void
  ariaLabel?: string
}) {
  return (
    <Segmented
      value={value ?? 'left'}
      onChange={onChange}
      ariaLabel={ariaLabel}
      options={ALIGN_OPTIONS.map((o) => ({ ...o, iconOnly: true }))}
    />
  )
}

/** Zeile „Schriftgröße + Ausrichtung“ eines Blocks. */
export function FormatRow({
  fontSizePt,
  align,
  onChange,
  basePt,
  label = 'Block',
  withAlign = true,
  defaultAlign = 'left'
}: {
  fontSizePt: number | undefined
  align?: TextAlign
  onChange(patch: { fontSizePt?: number; align?: TextAlign }): void
  basePt: number
  label?: string
  withAlign?: boolean
  defaultAlign?: TextAlign
}) {
  const sizeId = useId()
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
      <Field label="Schriftgröße" htmlFor={sizeId}>
        <NumberField
          id={sizeId}
          value={fontSizePt}
          optional
          placeholder={`${String(basePt).replace('.', ',')}`}
          onChange={(v) => onChange({ fontSizePt: v })}
          min={5}
          max={48}
          step={0.5}
          unit="pt"
          ariaLabel={`Schriftgröße ${label} in pt`}
        />
      </Field>
      {withAlign ? (
        <div className="min-w-0 space-y-1.5">
          <span className="block text-sm font-medium">Ausrichtung</span>
          <AlignControl value={align ?? defaultAlign} onChange={(a) => onChange({ align: a })} ariaLabel={`Ausrichtung ${label}`} />
        </div>
      ) : null}
    </div>
  )
}

/** Kartenrahmen für Abschnitte im Editor. */
export function Section({ title, description, actions, children, className }: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('space-y-3 rounded-lg border bg-card p-3 sm:p-4', className)}>
      {title || actions ? (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {title ? <h3 className="text-sm font-semibold">{title}</h3> : null}
            {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-1">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}
