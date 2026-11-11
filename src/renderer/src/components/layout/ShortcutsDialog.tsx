import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getPlatform } from '@/lib/platform'

interface Shortcut {
  label: string
  mac: string
  other: string
}

/** Tastenkürzel laut Anwendungsmenü (src/main/menu.ts). */
export const SHORTCUT_GROUPS: Array<{ title: string; items: Shortcut[] }> = [
  {
    title: 'Rechnungen',
    items: [
      { label: 'Neue Rechnung', mac: '⌘N', other: 'Strg+N' },
      { label: 'Neue Einzelrechnung', mac: '⇧⌘N', other: 'Strg+Umschalt+N' },
      { label: 'Abschließen & drucken', mac: '⌘↩', other: 'Strg+Enter' },
      { label: 'Letzte Rechnung erneut drucken', mac: '⌘P', other: 'Strg+P' },
      { label: 'PDF der letzten Rechnung öffnen', mac: '⇧⌘O', other: 'Strg+Umschalt+O' },
      { label: 'Suchen', mac: '⌘F', other: 'Strg+F' }
    ]
  },
  {
    title: 'Import & Export',
    items: [
      { label: 'Vereine aus Excel importieren', mac: '⌘I', other: 'Strg+I' },
      { label: 'Auswertung nach Excel exportieren', mac: '⇧⌘E', other: 'Strg+Umschalt+E' }
    ]
  },
  {
    title: 'Navigation',
    items: [
      { label: 'Festbüro', mac: '⌘1', other: 'Strg+1' },
      { label: 'Rechnungen', mac: '⌘2', other: 'Strg+2' },
      { label: 'Auswertung', mac: '⌘3', other: 'Strg+3' },
      { label: 'Fest-Einstellungen', mac: '⌘4', other: 'Strg+4' },
      { label: 'App-Einstellungen', mac: '⌘,', other: 'Strg+,' }
    ]
  },
  {
    title: 'Ansicht',
    items: [
      { label: 'Vorschau ein-/ausblenden', mac: '⌥⌘P', other: 'Strg+Alt+P' },
      { label: 'Navigation ein-/ausblenden', mac: '⌃⌘S', other: 'Strg+Umschalt+B' },
      { label: 'Vollbild', mac: '⌃⌘F', other: 'F11' },
      { label: 'Tastaturkurzbefehle', mac: '⌘/', other: 'Strg+/' }
    ]
  }
]

/** Dialog „Tastaturkurzbefehle“ (Hilfe-Menü, ⌘/ bzw. Strg+/). */
export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const mac = getPlatform() === 'darwin'
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Tastaturkurzbefehle</DialogTitle>
          <DialogDescription>Alle Funktionen sind auch über das Menü erreichbar.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 sm:grid-cols-2">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title} className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground">{group.title}</h3>
              <dl className="space-y-1.5">
                {group.items.map((s) => (
                  <div key={s.label} className="flex items-center justify-between gap-3 text-sm">
                    <dt className="min-w-0 truncate" title={s.label}>
                      {s.label}
                    </dt>
                    <dd>
                      <kbd className="rounded border bg-muted px-1.5 py-0.5 font-sans text-xs whitespace-nowrap">
                        {mac ? s.mac : s.other}
                      </kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
