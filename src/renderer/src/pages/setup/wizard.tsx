/**
 * Bausteine des Einrichtungsassistenten: Kontext (Aktionsleiste, Enter = weiter), Schritt-Überschrift
 * und Fortschrittsanzeige.
 */
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface WizardStepDef {
  id: 'welcome' | 'documents' | 'printer' | 'festival' | 'done'
  /** kurze Beschriftung für die Fortschrittsanzeige */
  label: string
}

export const WIZARD_STEPS: readonly WizardStepDef[] = [
  { id: 'welcome', label: 'Willkommen' },
  { id: 'documents', label: 'Ordner' },
  { id: 'printer', label: 'Drucker' },
  { id: 'festival', label: 'Fest' },
  { id: 'done', label: 'Fertig' }
]

interface WizardContextValue {
  /** Container der Aktionsleiste (unten, immer sichtbar) */
  actionsEl: HTMLElement | null
  /** aktuelle Hauptaktion für Enter */
  primaryRef: React.MutableRefObject<(() => void) | null>
}

export const WizardContext = createContext<WizardContextValue | null>(null)

function useWizard(): WizardContextValue {
  const ctx = useContext(WizardContext)
  if (!ctx) throw new Error('WizardContext fehlt')
  return ctx
}

/**
 * Aktionsbuttons eines Schritts (rechts in der Aktionsleiste). `onPrimary` wird bei Enter ausgelöst,
 * sofern der Fokus nicht auf einem Button, Link oder Eingabefeld liegt.
 */
export function StepActions({ onPrimary, children }: { onPrimary: (() => void) | null; children: ReactNode }) {
  const { actionsEl, primaryRef } = useWizard()
  const handlerRef = useRef(onPrimary)
  handlerRef.current = onPrimary

  useEffect(() => {
    const run = () => handlerRef.current?.()
    primaryRef.current = run
    return () => {
      if (primaryRef.current === run) primaryRef.current = null
    }
  }, [primaryRef])

  if (!actionsEl) return null
  return createPortal(children, actionsEl)
}

/** Überschrift eines Schritts; erhält beim Anzeigen den Fokus (Screenreader, Enter = weiter). */
export function StepHeading({
  icon,
  title,
  description,
  autoFocus = true,
  as: Tag = 'h2'
}: {
  icon?: ReactNode
  title: string
  description?: ReactNode
  autoFocus?: boolean
  as?: 'h1' | 'h2'
}) {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true })
  }, [autoFocus])
  return (
    <div className="flex items-start gap-3">
      {icon ? (
        <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary [&_svg]:size-5">
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 space-y-1">
        <Tag ref={ref} tabIndex={-1} className="text-xl font-semibold tracking-tight outline-none sm:text-2xl">
          {title}
        </Tag>
        {description ? <p className="text-sm text-muted-foreground sm:text-base">{description}</p> : null}
      </div>
    </div>
  )
}

/** Fortschrittsanzeige: Kreise mit Verbindungslinien; erledigte Schritte sind anklickbar (zurück). */
export function StepProgress({ current, onSelect }: { current: number; onSelect: (index: number) => void }) {
  const total = WIZARD_STEPS.length
  return (
    <nav aria-label="Fortschritt der Einrichtung" data-testid="setup-progress">
      <p className="sr-only" aria-live="polite">
        Schritt {current + 1} von {total}: {WIZARD_STEPS[current]?.label}
      </p>
      <ol className="flex items-start">
        {WIZARD_STEPS.map((step, index) => {
          const done = index < current
          const active = index === current
          const circle = (
            <span
              className={cn(
                'flex size-8 items-center justify-center rounded-full border-2 text-sm font-semibold tabular-nums transition-colors',
                done && 'border-primary bg-primary text-primary-foreground',
                active && 'border-primary bg-background text-primary ring-4 ring-primary/15',
                !done && !active && 'border-border bg-background text-muted-foreground'
              )}
            >
              {done ? <Check className="size-4" aria-hidden /> : index + 1}
            </span>
          )
          return (
            <li key={step.id} className="relative flex min-w-0 flex-1 flex-col items-center gap-1.5">
              {index > 0 ? (
                <span
                  aria-hidden
                  className={cn(
                    'absolute top-4 right-[calc(50%+1.25rem)] left-[calc(-50%+1.25rem)] h-0.5 -translate-y-1/2 rounded-full',
                    index <= current ? 'bg-primary' : 'bg-border'
                  )}
                />
              ) : null}
              {done ? (
                <button
                  type="button"
                  onClick={() => onSelect(index)}
                  className="rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
                  aria-label={`Zurück zu Schritt ${index + 1}: ${step.label}`}
                >
                  {circle}
                </button>
              ) : (
                <span aria-current={active ? 'step' : undefined}>{circle}</span>
              )}
              <span
                className={cn(
                  'max-w-full truncate px-1 text-xs',
                  active ? 'font-medium text-foreground' : 'text-muted-foreground'
                )}
              >
                {step.label}
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
