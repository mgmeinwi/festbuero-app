import { useEffect, useId, useState } from 'react'
import { FileSpreadsheet, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { plural } from './club-list'

interface ExportTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  clubCount: number
  /** öffnet den Speichern-Dialog und schreibt die Datei; liefert false bei Abbruch */
  onExport: (prefill: boolean) => Promise<boolean>
}

const COLUMNS = ['Name', 'Verein', 'Straße', 'PLZ', 'Ort', 'ang. Personen']

/** „Anmelde-Vorlage exportieren“: Erklärung, Option „vorausfüllen“, Speichern-Dialog. */
export function ExportTemplateDialog({ open, onOpenChange, clubCount, onExport }: ExportTemplateDialogProps) {
  const id = useId()
  const [prefill, setPrefill] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) setPrefill(false)
  }, [open])

  const handleExport = async () => {
    setBusy(true)
    try {
      if (await onExport(prefill && clubCount > 0)) onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="transition-none sm:max-w-lg" data-testid="club-export-dialog">
        <DialogHeader className="text-left">
          <DialogTitle>Anmelde-Vorlage exportieren</DialogTitle>
          <DialogDescription>
            Excel-Datei zum Sammeln der Anmeldungen, z. B. durch den Vorstand. Die ausgefüllte Datei lässt sich hier
            direkt wieder importieren.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 rounded-lg border bg-muted/40 p-3 text-sm">
          <div className="flex items-start gap-2.5">
            <FileSpreadsheet className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            <div className="min-w-0 space-y-2">
              <p>
                <span className="font-medium">Blatt „Anmeldungen“</span> mit den Spalten:
              </p>
              <ul className="flex flex-wrap gap-1.5" aria-label="Spalten der Vorlage">
                {COLUMNS.map((c) => (
                  <li key={c} className="rounded-md border bg-background px-2 py-0.5 text-xs font-medium">
                    {c}
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">Blatt „Hinweise“</span> mit einer kurzen Ausfüllanleitung.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-3">
          <div className="min-w-0 space-y-1">
            <Label htmlFor={`${id}-prefill`} className="cursor-pointer">
              Mit den aktuellen Vereinen vorausfüllen
            </Label>
            <p id={`${id}-prefill-hint`} className="text-xs text-muted-foreground">
              {clubCount > 0
                ? `${plural(clubCount, 'Verein wird', 'Vereine werden')} eingetragen und können ergänzt werden.`
                : 'Noch keine Vereine vorhanden – die Vorlage ist leer.'}
            </p>
          </div>
          <Switch
            id={`${id}-prefill`}
            checked={prefill && clubCount > 0}
            onCheckedChange={setPrefill}
            disabled={clubCount === 0}
            aria-describedby={`${id}-prefill-hint`}
          />
        </div>

        <DialogFooter className="flex-row justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Abbrechen
          </Button>
          <Button type="button" onClick={handleExport} disabled={busy} autoFocus>
            {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
            Speichern unter …
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
