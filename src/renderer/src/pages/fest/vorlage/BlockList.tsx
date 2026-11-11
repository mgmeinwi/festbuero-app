/**
 * Blockliste in Seitenreihenfolge (links, ab lg) bzw. Auswahlfeld (schmale Fenster).
 * Liste: Pfeiltasten hoch/runter wechseln den Block.
 */
import { useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { TemplateConfig } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { BLOCKS, type BlockKey } from './blocks'

export function BlockList({
  selected,
  onSelect,
  config
}: {
  selected: BlockKey
  onSelect(key: BlockKey): void
  config: TemplateConfig
}) {
  const listRef = useRef<HTMLUListElement>(null)
  return (
    <nav aria-label="Blöcke der Vorlage" className="p-2">
      <ul ref={listRef} className="space-y-0.5" data-testid="vorlage-block-list">
        {BLOCKS.map((b, index) => {
          const Icon = b.icon
          const active = b.key === selected
          return (
            <li key={b.key}>
              <button
                type="button"
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left outline-none transition-colors',
                  'hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60',
                  active && 'bg-accent text-accent-foreground'
                )}
                onClick={() => onSelect(b.key)}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
                  e.preventDefault()
                  const next = BLOCKS[(index + (e.key === 'ArrowDown' ? 1 : -1) + BLOCKS.length) % BLOCKS.length]!
                  onSelect(next.key)
                  const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('button')
                  buttons?.[BLOCKS.indexOf(next)]?.focus()
                }}
              >
                <Icon className={cn('mt-0.5 size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{b.label}</span>
                  <span className="block truncate text-xs text-muted-foreground" title={b.summary(config)}>
                    {b.summary(config)}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** Kompakte Blockauswahl für schmale Fenster (< lg): Auswahlfeld + vor/zurück. */
export function BlockPicker({ selected, onSelect }: { selected: BlockKey; onSelect(key: BlockKey): void }) {
  const index = BLOCKS.findIndex((b) => b.key === selected)
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Vorheriger Block"
        disabled={index <= 0}
        onClick={() => onSelect(BLOCKS[index - 1]!.key)}
      >
        <ChevronLeft aria-hidden />
      </Button>
      <Select value={selected} onValueChange={(v) => onSelect(v as BlockKey)}>
        <SelectTrigger className="h-9 min-w-0 flex-1" aria-label="Block auswählen">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {BLOCKS.map((b, i) => (
            <SelectItem key={b.key} value={b.key}>
              {i + 1}. {b.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Nächster Block"
        disabled={index >= BLOCKS.length - 1}
        onClick={() => onSelect(BLOCKS[index + 1]!.key)}
      >
        <ChevronRight aria-hidden />
      </Button>
    </div>
  )
}
