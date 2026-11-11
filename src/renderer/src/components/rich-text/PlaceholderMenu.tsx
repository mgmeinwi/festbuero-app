/**
 * Dropdown „Feld einfügen“: alle Platzhalter aus `PLACEHOLDERS`, gruppiert (Rechnung, Datum, Kunde, Fest).
 * Datumsfelder haben ein Untermenü für die Varianten. Liefert das Token ohne Klammern, z. B.
 * `Rechnungsdatum_DE`, an `onInsert`.
 */
import { Braces } from 'lucide-react'
import { PLACEHOLDER_GROUPS, PLACEHOLDERS, type PlaceholderDefinition } from '@shared/placeholders'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export interface PlaceholderMenuProps {
  /** Feld ohne Klammern, z. B. "Rechnungsnummer" oder "Rechnungsdatum_DE" */
  onInsert(field: string): void
  disabled?: boolean
  /** nur Symbol anzeigen (sehr schmale Werkzeugleisten) */
  iconOnly?: boolean
  className?: string
  /** Fokus nach dem Schließen nicht auf den Auslöser zurücksetzen (Editor fokussiert selbst) */
  preventFocusReturn?: boolean
}

function stripBraces(token: string): string {
  return token.replace(/^\{/, '').replace(/\}$/, '')
}

/** Datumsfelder: Standard + Varianten unter einem Eintrag zusammenfassen. */
function groupDateFields(defs: readonly PlaceholderDefinition[]): Array<{ field: string; items: PlaceholderDefinition[] }> {
  const map = new Map<string, PlaceholderDefinition[]>()
  for (const d of defs) {
    const list = map.get(d.field) ?? []
    list.push(d)
    map.set(d.field, list)
  }
  return [...map.entries()].map(([field, items]) => ({ field, items }))
}

export function PlaceholderMenu({ onInsert, disabled, iconOnly, className, preventFocusReturn }: PlaceholderMenuProps) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn('h-8 gap-1.5 px-2 text-xs', className)}
          aria-label="Feld einfügen"
          title="Feld (Platzhalter) einfügen"
        >
          <Braces className="size-4" aria-hidden />
          {iconOnly ? null : <span>Feld einfügen</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] w-64 overflow-y-auto"
        onCloseAutoFocus={preventFocusReturn ? (e) => e.preventDefault() : undefined}
      >
        {PLACEHOLDER_GROUPS.map((group, gi) => {
          const defs = PLACEHOLDERS.filter((p) => p.group === group)
          if (defs.length === 0) return null
          return (
            <DropdownMenuGroup key={group}>
              {gi > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuLabel className="text-xs text-muted-foreground">{group}</DropdownMenuLabel>
              {group === 'Datum'
                ? groupDateFields(defs).map(({ field, items }) => {
                    const main = items.find((i) => i.variant === undefined) ?? items[0]!
                    return (
                      <DropdownMenuSub key={field}>
                        <DropdownMenuSubTrigger>{main.label}</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-60">
                          {items.map((item) => (
                            <DropdownMenuItem key={item.token} onSelect={() => onInsert(stripBraces(item.token))}>
                              <span className="min-w-0 flex-1 truncate">
                                {item.variant ? item.label.replace(`${main.label} `, '') : 'Standard'}
                              </span>
                              <span className="ml-2 shrink-0 text-xs text-muted-foreground tabular-nums">{item.example}</span>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    )
                  })
                : defs.map((item) => (
                    <DropdownMenuItem key={item.token} onSelect={() => onInsert(stripBraces(item.token))}>
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      <span className="ml-2 max-w-24 shrink-0 truncate text-xs text-muted-foreground">{item.example}</span>
                    </DropdownMenuItem>
                  ))}
            </DropdownMenuGroup>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
