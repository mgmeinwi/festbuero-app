import type { CSSProperties, ReactNode } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ArrowDown,
  ArrowUp,
  Ellipsis,
  Eye,
  EyeOff,
  GripVertical,
  Pencil,
  Trash2
} from 'lucide-react'
import { formatEuro } from '@shared/money'
import type { Product } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { MODE_LABELS, modeSummary } from './product-format'

/** Gemeinsame Spaltenaufteilung für Kopfzeile und Zeilen (Container-Query @3xl = volle Breite). */
export const ROW_GRID =
  'grid grid-cols-[2.25rem_minmax(0,1fr)_auto_2.25rem] items-center gap-x-2 @3xl:grid-cols-[2.25rem_minmax(0,1fr)_4rem_9.5rem_6.5rem_13rem] @3xl:gap-x-3'

export const USED_HINT = 'Wurde bereits in Rechnungen verwendet und kann nur deaktiviert werden.'

export interface ProductRowActions {
  onEdit: (product: Product) => void
  onMove: (product: Product, direction: -1 | 1) => void
  onToggleActive: (product: Product) => void
  onDelete: (product: Product) => void
}

interface ProductRowProps extends ProductRowActions {
  product: Product
  index: number
  count: number
}

/** Eine sortierbare Produktzeile (Ziehgriff mit Maus oder Tastatur, Hoch/Runter-Buttons, Aktionen). */
export function ProductRow({ product, index, count, onEdit, onMove, onToggleActive, onDelete }: ProductRowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: product.id
  })
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition
  }
  const isFirst = index === 0
  const isLast = index === count - 1
  const muted = !product.active

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        ROW_GRID,
        'relative bg-card px-2 py-2 sm:px-3',
        isDragging && 'z-10 rounded-lg shadow-lg ring-2 ring-ring/40'
      )}
      data-testid="product-row"
      data-product-id={product.id}
      data-active={product.active ? 'true' : 'false'}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`„${product.name}“ verschieben (Position ${index + 1} von ${count})`}
        aria-roledescription="sortierbar"
        className="flex size-9 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60 active:cursor-grabbing"
      >
        <GripVertical className="size-4" aria-hidden />
      </button>

      <div className={cn('min-w-0', muted && 'opacity-60')}>
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('truncate text-sm font-medium', muted && 'line-through decoration-muted-foreground/60')} title={product.name}>
            {product.name}
          </span>
          {muted ? (
            <Badge variant="outline" className="shrink-0">
              inaktiv
            </Badge>
          ) : null}
        </div>
        <p className="truncate text-xs text-muted-foreground @3xl:hidden">
          {product.vatRate} % · {modeSummary(product)}
        </p>
      </div>

      <div className={cn('hidden text-sm tabular-nums @3xl:block', muted && 'opacity-60')}>{product.vatRate} %</div>
      <div className={cn('hidden min-w-0 text-sm @3xl:block', muted && 'opacity-60')}>
        <span className="block truncate" title={MODE_LABELS[product.mode]}>
          {modeSummary(product)}
        </span>
      </div>
      <div className={cn('text-right text-sm font-medium tabular-nums', muted && 'opacity-60')}>{formatEuro(product.priceCents)}</div>

      {/* volle Breite: Aktionen als Buttons */}
      <div className="hidden items-center justify-end gap-0.5 @3xl:flex">
        <IconAction label={`„${product.name}“ nach oben`} onClick={() => onMove(product, -1)} disabled={isFirst}>
          <ArrowUp />
        </IconAction>
        <IconAction label={`„${product.name}“ nach unten`} onClick={() => onMove(product, 1)} disabled={isLast}>
          <ArrowDown />
        </IconAction>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <IconAction label={`„${product.name}“ bearbeiten`} onClick={() => onEdit(product)}>
          <Pencil />
        </IconAction>
        <IconAction
          label={product.active ? `„${product.name}“ deaktivieren` : `„${product.name}“ aktivieren`}
          onClick={() => onToggleActive(product)}
        >
          {product.active ? <EyeOff /> : <Eye />}
        </IconAction>
        {product.usedInInvoices ? (
          <Tooltip>
            <TooltipTrigger asChild>
              {/* deaktivierte Buttons lösen keine Hover-/Fokus-Ereignisse aus → Wrapper trägt den Tooltip */}
              <span tabIndex={0} className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60" aria-label={`„${product.name}“ löschen nicht möglich. ${USED_HINT}`}>
                <Button type="button" variant="ghost" size="icon-sm" disabled aria-hidden tabIndex={-1}>
                  <Trash2 />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="left">
              {USED_HINT} {product.active ? 'Stattdessen „Deaktivieren“ verwenden.' : ''}
            </TooltipContent>
          </Tooltip>
        ) : (
          <IconAction label={`„${product.name}“ löschen`} onClick={() => onDelete(product)} destructive>
            <Trash2 />
          </IconAction>
        )}
      </div>

      {/* schmal: Aktionen im „…“-Menü */}
      <div className="flex justify-end @3xl:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Aktionen für „${product.name}“`}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="truncate">{product.name}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => onEdit(product)}>
              <Pencil aria-hidden />
              Bearbeiten
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onMove(product, -1)} disabled={isFirst}>
              <ArrowUp aria-hidden />
              Nach oben
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onMove(product, 1)} disabled={isLast}>
              <ArrowDown aria-hidden />
              Nach unten
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onToggleActive(product)}>
              {product.active ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
              {product.active ? 'Deaktivieren' : 'Aktivieren'}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => onDelete(product)}
              disabled={product.usedInInvoices}
              className="items-start"
            >
              <Trash2 aria-hidden className="mt-0.5" />
              <span className="grid gap-0.5">
                <span>Löschen …</span>
                {product.usedInInvoices ? (
                  <span className="text-xs text-muted-foreground">In Rechnungen verwendet – nur deaktivierbar</span>
                ) : null}
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  )
}

function IconAction({
  label,
  onClick,
  disabled,
  destructive,
  children
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  destructive?: boolean
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
          className={cn(destructive && 'text-destructive hover:bg-destructive/10 hover:text-destructive')}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
