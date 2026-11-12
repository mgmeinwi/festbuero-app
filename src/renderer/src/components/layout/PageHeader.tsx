import type { ReactNode } from 'react'
import { Construction } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  description?: ReactNode
  /** Aktionen rechts (Buttons); brechen bei schmalen Fenstern unter den Titel um */
  actions?: ReactNode
  className?: string
}

/**
 * Einheitlicher Seitenkopf (Titel, Beschreibung, Aktionen). Die Aktionen bleiben rechts neben dem Titel,
 * solange daneben mindestens 16rem für Titel/Beschreibung frei sind (lange Beschreibungen brechen dann um);
 * erst bei schmalen Fenstern rutschen sie unter den Titel.
 */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-3', className)}>
      <div className="min-w-0 grow basis-64 space-y-1">
        <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl" title={title}>
          {title}
        </h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

/** Standard-Innenabstand einer Seite (responsive). */
export function PageContainer({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6', className)}>{children}</div>
}

/** Platzhalter für Seiten, die ein anderer Bereich noch umsetzt. */
export function PagePlaceholder({ title, area, description }: { title: string; area: string; description?: string }) {
  return (
    <PageContainer>
      <PageHeader title={title} description={description} />
      <div
        className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center text-muted-foreground"
        data-testid="page-placeholder"
      >
        <Construction className="size-8" aria-hidden />
        <p className="text-sm">
          Diese Seite wird gerade umgesetzt (Bereich „{area}“).
        </p>
      </div>
    </PageContainer>
  )
}
