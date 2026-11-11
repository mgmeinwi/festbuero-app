import { useState, type ReactNode } from 'react'
import { PartyPopper, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useActiveFestival } from '@/hooks/use-active-festival'
import { NewFestivalDialog } from './NewFestivalDialog'

/** Hinweis „Bitte zuerst ein Gründungsfest anlegen“ mit Button zum Anlegen. */
export function NoFestivalNotice() {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex h-full min-h-[16rem] items-center justify-center p-6" data-testid="no-festival">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-accent text-primary">
          <PartyPopper className="size-7" aria-hidden />
        </span>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Bitte zuerst ein Gründungsfest anlegen</h2>
          <p className="text-sm text-muted-foreground">
            Rechnungen, Produkte und Vereine gehören immer zu einem Gründungsfest.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus aria-hidden />
          Gründungsfest anlegen
        </Button>
      </div>
      <NewFestivalDialog open={open} onOpenChange={setOpen} />
    </div>
  )
}

/**
 * Rendert `children` nur, wenn ein aktives Fest existiert – sonst den Hinweis.
 * In App.tsx um alle festbezogenen Seiten gelegt; Seiten können daher mit
 * `useActiveFestival().festivalId!` arbeiten.
 */
export function RequireFestival({ children }: { children: ReactNode }) {
  const { festival, isLoading } = useActiveFestival()
  if (isLoading) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }
  if (!festival) return <NoFestivalNotice />
  return <>{children}</>
}
