/**
 * Bausteine der Auswertung: Kennzahl-Kachel, Abschnittskarte, dezenter CSS-Balken.
 */
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export function StatTile({
  label,
  value,
  sub,
  icon: Icon,
  emphasis = false,
  testId
}: {
  label: string
  value: string
  sub?: string
  icon: LucideIcon
  emphasis?: boolean
  testId?: string
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-1 rounded-xl border bg-card p-4 shadow-xs',
        emphasis && 'border-primary/30 bg-primary/5 dark:bg-primary/10'
      )}
      data-testid={testId}
    >
      <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span className="truncate">{label}</span>
        <Icon className={cn('size-4 shrink-0', emphasis && 'text-primary')} aria-hidden />
      </div>
      <div className="truncate text-[1.375rem] leading-tight font-semibold tracking-tight tabular-nums" title={value} data-value>
        {value}
      </div>
      {sub ? <div className="truncate text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  )
}

export function Section({
  title,
  description,
  action,
  children,
  className,
  testId
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  testId?: string
}) {
  return (
    <section className={cn('flex min-w-0 flex-col rounded-xl border bg-card shadow-xs', className)} data-testid={testId}>
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 border-b px-4 py-3">
        <div className="min-w-0 space-y-0.5">
          <h2 className="font-semibold">{title}</h2>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </header>
      <div className="min-w-0 flex-1">{children}</div>
    </section>
  )
}

/** Dezenter Balken: Anteil `value` an `max` (negativ = rot). */
export function ShareBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (Math.abs(value) / max) * 100) : 0
  return (
    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted" title={label} aria-hidden>
      <div
        className={cn('h-full rounded-full', value < 0 ? 'bg-destructive/70' : 'bg-primary/70')}
        style={{ width: `${pct > 0 ? Math.max(pct, 1.5) : 0}%` }}
      />
    </div>
  )
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>
}
