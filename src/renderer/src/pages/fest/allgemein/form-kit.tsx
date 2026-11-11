/**
 * Gemeinsame Formular-Bausteine der Fest-Einstellungen (Allgemein, Nummern, Zahlarten).
 * Liegt hier, weil der Bereich „Fest-Einstellungen“ nur seine Seitenordner bearbeitet.
 */
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { Check, LoaderCircle, Save, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn, modKey } from '@/lib/utils'

/** Abschnitt einer Einstellungsseite: Titel, Beschreibung, Inhalt (Karte). */
export function SettingsSection({
  title,
  description,
  icon,
  actions,
  children,
  className,
  id,
  tone = 'default'
}: {
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
  id?: string
  tone?: 'default' | 'danger'
}) {
  const headingId = id ? `${id}-title` : undefined
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn(
        'rounded-xl border bg-card text-card-foreground shadow-xs',
        tone === 'danger' && 'border-destructive/30',
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pt-4 sm:px-5 sm:pt-5">
        <div className={cn('flex min-w-0 gap-3', description ? 'items-start' : 'items-center')}>
          {icon ? (
            <span
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-primary [&_svg]:size-4',
                description && 'mt-0.5',
                tone === 'danger' && 'bg-destructive/10 text-destructive'
              )}
              aria-hidden
            >
              {icon}
            </span>
          ) : null}
          <div className="min-w-0 space-y-1">
            <h2 id={headingId} className="text-base font-semibold leading-tight">
              {title}
            </h2>
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children ? <div className="grid gap-5 px-4 pt-4 pb-4 sm:px-5 sm:pb-5">{children}</div> : <div className="pb-4 sm:pb-5" />}
    </section>
  )
}

/** Hinweis- oder Fehlertext unter einem Feld. */
export function FieldMessage({ id, error, children }: { id?: string; error?: boolean; children: ReactNode }) {
  return (
    <p
      id={id}
      role={error ? 'alert' : undefined}
      className={cn('text-xs', error ? 'font-medium text-destructive' : 'text-muted-foreground')}
    >
      {children}
    </p>
  )
}

/**
 * Speichern-Leiste am Ende eines `<form>` (Speichern-Button ist `type="submit"`). Bei ungespeicherten
 * Änderungen klebt sie unten im Scrollbereich, sonst steht sie unauffällig am Formularende (spart bei
 * niedrigen Fenstern Platz).
 */
export function SaveBar({
  dirty,
  saving,
  canSave = true,
  onDiscard,
  formId,
  savedText = 'Alle Änderungen gespeichert'
}: {
  dirty: boolean
  saving: boolean
  /** false = Eingaben ungültig (Speichern gesperrt) */
  canSave?: boolean
  onDiscard: () => void
  formId?: string
  savedText?: string
}) {
  return (
    <div
      className={cn(
        '-mx-1 px-1',
        dirty && 'sticky bottom-0 z-10 bg-gradient-to-t from-background via-background/90 to-transparent pt-3 pb-4'
      )}
    >
      <div
        className="flex items-center gap-2 rounded-xl border bg-card/95 px-3 py-2 shadow-md backdrop-blur sm:gap-3 sm:px-4"
        data-testid="save-bar"
        data-dirty={dirty ? 'true' : 'false'}
      >
        <p className="flex min-w-0 flex-1 items-center gap-2 text-sm" aria-live="polite">
          {dirty ? (
            <>
              <span className="size-2 shrink-0 rounded-full bg-warning" aria-hidden />
              <span className="truncate font-medium">Ungespeicherte Änderungen</span>
            </>
          ) : (
            <>
              <Check className="size-4 shrink-0 text-success" aria-hidden />
              <span className="truncate text-muted-foreground">{savedText}</span>
            </>
          )}
        </p>
        <Button type="button" variant="ghost" onClick={onDiscard} disabled={!dirty || saving}>
          <Undo2 aria-hidden />
          <span className="hidden sm:inline">Verwerfen</span>
          <span className="sr-only sm:hidden">Änderungen verwerfen</span>
        </Button>
        <Button type="submit" form={formId} disabled={!dirty || saving || !canSave} title={`Speichern (${modKey}+S)`}>
          {saving ? <LoaderCircle className="animate-spin" aria-hidden /> : <Save aria-hidden />}
          Speichern
        </Button>
      </div>
    </div>
  )
}

/** ⌘S / Strg+S speichert, solange die Seite gemountet ist (kein Menü-Kürzel, daher kein Konflikt). */
export function useSaveShortcut(onSave: () => void, enabled: boolean): void {
  const ref = useRef(onSave)
  ref.current = onSave
  useEffect(() => {
    if (!enabled) return
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 's') {
        event.preventDefault()
        // nicht das Formular hinter einem offenen Dialog speichern
        if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return
        ref.current()
      }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [enabled])
}

/** Ganzzahl aus einem Eingabefeld (nur Ziffern) oder null. */
export function parseIntegerInput(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const n = Number(trimmed)
  return Number.isSafeInteger(n) ? n : null
}

/**
 * Setzt beim Öffnen der Seite den umgebenden Scrollbereich nach oben (die Tab-Leiste der
 * Fest-Einstellungen behält sonst die Scrollposition der vorherigen Seite).
 */
export function ScrollToTopOnMount() {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    let el = ref.current?.parentElement ?? null
    while (el && el !== document.body) {
      if (/(auto|scroll)/.test(getComputedStyle(el).overflowY)) {
        el.scrollTop = 0
        return
      }
      el = el.parentElement
    }
  }, [])
  return <span ref={ref} hidden />
}

/** Seitenbreite der Fest-Einstellungen: bündig unter der Tab-Leiste statt zentriert. */
export const FEST_PAGE_CLASS = 'mx-0'
