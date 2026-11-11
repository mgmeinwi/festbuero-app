import { Braces } from 'lucide-react'
import { PLACEHOLDER_GROUPS, type PlaceholderDefinition } from '@shared/placeholders'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

/** Dropdown „Feld einfügen“ – fügt den Platzhalter-Token über `onInsert` ein. */
export function PlaceholderMenu({
  placeholders,
  onInsert,
  label = 'Feld einfügen',
  disabled,
  size = 'sm'
}: {
  placeholders: readonly PlaceholderDefinition[]
  onInsert: (token: string) => void
  label?: string
  disabled?: boolean
  size?: 'sm' | 'default'
}) {
  const groups = PLACEHOLDER_GROUPS.map((group) => ({
    group,
    items: placeholders.filter((p) => p.group === group)
  })).filter((g) => g.items.length > 0)

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size={size} disabled={disabled}>
          <Braces aria-hidden />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(20rem,calc(100vw-2rem))]">
        {groups.map(({ group, items }, index) => (
          <DropdownMenuGroup key={group}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel>{group}</DropdownMenuLabel>
            {items.map((p) => (
              <DropdownMenuItem key={p.token} onSelect={() => onInsert(p.token)} title={p.token}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{p.label}</span>
                  <span className="truncate text-xs text-muted-foreground">z. B. {p.example}</span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Fügt `token` an der Cursorposition eines Eingabefelds ein und setzt den Cursor dahinter.
 * Liefert den neuen Wert (für kontrollierte Felder).
 */
export function insertAtCursor(
  element: HTMLInputElement | HTMLTextAreaElement | null,
  value: string,
  token: string
): { value: string; caret: number } {
  const start = element?.selectionStart ?? value.length
  const end = element?.selectionEnd ?? value.length
  const next = value.slice(0, start) + token + value.slice(end)
  return { value: next, caret: start + token.length }
}

/** Setzt nach dem nächsten Rendern Fokus und Cursor (Timeout statt rAF: funktioniert auch im verdeckten Fenster). */
export function focusAt(element: HTMLInputElement | HTMLTextAreaElement | null, caret: number): void {
  if (!element) return
  setTimeout(() => {
    element.focus()
    element.setSelectionRange(caret, caret)
  }, 0)
}
