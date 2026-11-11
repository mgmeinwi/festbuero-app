import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface StepSectionProps {
  id: string
  step: number
  title: string
  done?: boolean
  /** rechts in der Kopfzeile (z. B. Hinweise, kleine Aktionen) */
  aside?: ReactNode
  children: ReactNode
  className?: string
}

/** Ein Schritt der Maske mit Nummer und Titel. */
export function StepSection({ id, step, title, done, aside, children, className }: StepSectionProps) {
  return (
    <section aria-labelledby={`${id}-title`} data-testid={`step-${id}`} className={cn('space-y-2.5', className)}>
      <header className="flex min-h-7 items-center gap-2.5">
        <span
          aria-hidden
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
            done ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground ring-1 ring-border'
          )}
        >
          {done ? <Check className="size-3.5" strokeWidth={3} /> : step}
        </span>
        <h2 id={`${id}-title`} className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          <span className="sr-only">Schritt {step}: </span>
          {title}
        </h2>
        {aside ? <div className="ml-auto flex min-w-0 items-center gap-2">{aside}</div> : null}
      </header>
      {children}
    </section>
  )
}
