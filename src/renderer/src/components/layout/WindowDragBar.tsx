import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Leiste in Höhe der Titelleiste für Seiten ohne App-Kopfleiste (z. B. Ersteinrichtung):
 * Fenster lässt sich dort ziehen, Platz für macOS-Ampel bzw. Windows-Fensterknöpfe ist reserviert.
 */
export function WindowDragBar({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <div className={cn('app-titlebar app-drag flex h-12 shrink-0 items-center gap-2', className)} data-testid="window-drag-bar">
      {children}
    </div>
  )
}
