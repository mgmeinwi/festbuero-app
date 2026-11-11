import { Ban, CircleCheck, Undo2 } from 'lucide-react'
import type { InvoiceListItem } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { STATUS_LABELS, statusKey } from './list-utils'

/** Status-Badge (abgeschlossen / storniert / Storno) mit Bezug „zu Nr. …“ bzw. „→ Nr. …“. */
export function StatusBadge({
  item,
  showReference = true,
  className
}: {
  item: Pick<InvoiceListItem, 'type' | 'status' | 'originalNumber' | 'stornoNumber'>
  showReference?: boolean
  className?: string
}) {
  const key = statusKey(item)
  const reference =
    key === 'storno' && item.originalNumber
      ? `zu Nr. ${item.originalNumber}`
      : key === 'storniert' && item.stornoNumber
        ? `durch Nr. ${item.stornoNumber}`
        : null
  return (
    <div className={cn('flex min-w-0 flex-col items-start gap-0.5', className)}>
      {key === 'abgeschlossen' ? (
        <Badge variant="success">
          <CircleCheck aria-hidden />
          {STATUS_LABELS.abgeschlossen}
        </Badge>
      ) : key === 'storniert' ? (
        <Badge variant="warning">
          <Ban aria-hidden />
          {STATUS_LABELS.storniert}
        </Badge>
      ) : (
        <Badge variant="outline" className="border-destructive/40 text-destructive dark:border-destructive/50">
          <Undo2 aria-hidden />
          {STATUS_LABELS.storno}
        </Badge>
      )}
      {showReference && reference ? (
        <span className="text-xs text-muted-foreground tabular-nums">{reference}</span>
      ) : null}
    </div>
  )
}
