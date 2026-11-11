import { useState, type ReactNode } from 'react'
import { CircleAlert, FileSpreadsheet, Info, LoaderCircle, TriangleAlert } from 'lucide-react'
import type { ClubImportPreview, ClubImportRow } from '@shared/types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { fileNameOf, formatNumber, importNeedsConfirmation, plural } from './club-list'

interface ImportPreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  filePath: string | null
  /** null, solange die Datei geprüft wird */
  preview: ClubImportPreview | null
  /** importiert (Fehler zeigt der Aufrufer als Toast); liefert true bei Erfolg */
  onImport: () => Promise<boolean>
}

/** Vorschau vor dem Import: Zahlen, fehlende Spalten, Fehlerzeilen, was ersetzt wird. */
export function ImportPreviewDialog({ open, onOpenChange, filePath, preview, onImport }: ImportPreviewDialogProps) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const canImport = !!preview && preview.missingColumns.length === 0 && preview.validRows > 0
  const errorRows = preview?.rows.filter((r) => r.errors.length > 0) ?? []
  const warningRows = preview?.rows.filter((r) => r.errors.length === 0 && (r.warnings?.length ?? 0) > 0) ?? []

  const runImport = async () => {
    setBusy(true)
    try {
      if (await onImport()) setConfirmOpen(false)
    } finally {
      setBusy(false)
    }
  }

  const handleImportClick = () => {
    if (!preview || !canImport) return
    if (importNeedsConfirmation(preview)) setConfirmOpen(true)
    else void runImport()
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
        <DialogContent
          className="flex max-h-[calc(100vh-6rem)] flex-col gap-0 overflow-hidden p-0 transition-none sm:max-w-2xl"
          data-testid="club-import-dialog"
        >
          <DialogHeader className="border-b px-6 pt-6 pb-4 pr-12 text-left">
            <DialogTitle>Vereine importieren</DialogTitle>
            <DialogDescription className="flex min-w-0 items-center gap-1.5">
              <FileSpreadsheet className="size-4 shrink-0" aria-hidden />
              <span className="truncate" title={filePath ?? undefined} data-testid="club-import-file">
                {filePath ? fileNameOf(filePath) : ''}
              </span>
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
            {!preview ? (
              <div className="flex items-center gap-3 py-8 text-sm text-muted-foreground" role="status">
                <LoaderCircle className="size-5 animate-spin" aria-hidden />
                Datei wird geprüft …
              </div>
            ) : (
              <PreviewBody preview={preview} errorRows={errorRows} warningRows={warningRows} canImport={canImport} />
            )}
          </div>

          <DialogFooter className="flex-row justify-end border-t px-6 py-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Abbrechen
            </Button>
            <Button type="button" onClick={handleImportClick} disabled={!canImport || busy} data-testid="club-import-submit">
              {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
              {preview && canImport ? `${plural(preview.validRows, 'Verein', 'Vereine')} importieren` : 'Importieren'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={(next) => !busy && setConfirmOpen(next)}>
        <AlertDialogContent className="transition-none" data-testid="club-import-confirm">
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle>Vereinsstamm ersetzen?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {preview ? <ReplacementSummary preview={preview} /> : null}
                <p>Bereits erstellte Rechnungen bleiben unverändert.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row justify-end">
            <AlertDialogCancel disabled={busy}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                void runImport()
              }}
            >
              Ersetzen und importieren
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function ReplacementSummary({ preview }: { preview: ClubImportPreview }) {
  return (
    <>
      {preview.existingImportedCount > 0 ? (
        <p>
          {preview.existingImportedCount === 1 ? (
            <>
              Der <strong className="text-foreground">bisher importierte Verein</strong> wird
            </>
          ) : (
            <>
              Die <strong className="text-foreground">{formatNumber(preview.existingImportedCount)} bisher importierten Vereine</strong>{' '}
              werden
            </>
          )}{' '}
          durch {plural(preview.validRows, 'Verein', 'Vereine')} aus der Datei ersetzt.
        </p>
      ) : (
        <p>Es werden {plural(preview.validRows, 'Verein', 'Vereine')} aus der Datei importiert.</p>
      )}
      {preview.replacedManualClubs.length > 0 ? (
        <p>
          {preview.replacedManualClubs.length === 1
            ? 'Ein manuell angelegter Verein hat denselben Namen und wird ersetzt: '
            : `${formatNumber(preview.replacedManualClubs.length)} manuell angelegte Vereine haben denselben Namen und werden ersetzt: `}
          <strong className="break-words text-foreground">{preview.replacedManualClubs.map((name) => `„${name}“`).join(', ')}</strong>.
        </p>
      ) : null}
    </>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'success' | 'destructive' | 'muted' }) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-lg border px-3 py-2.5',
        tone === 'success' && 'border-success/30 bg-success/10',
        tone === 'destructive' && 'border-destructive/30 bg-destructive/10'
      )}
    >
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          'text-2xl font-semibold tabular-nums',
          tone === 'success' && 'text-success',
          tone === 'destructive' && 'text-destructive'
        )}
      >
        {formatNumber(value)}
      </div>
    </div>
  )
}

function Notice({ tone, children, testId }: { tone: 'destructive' | 'info' | 'warning'; children: ReactNode; testId?: string }) {
  const Icon = tone === 'destructive' ? CircleAlert : tone === 'warning' ? TriangleAlert : Info
  return (
    <div
      role={tone === 'destructive' ? 'alert' : undefined}
      data-testid={testId}
      className={cn(
        'flex gap-2.5 rounded-lg border px-3 py-2.5 text-sm',
        tone === 'destructive' && 'border-destructive/30 bg-destructive/10',
        tone === 'warning' && 'border-warning/40 bg-warning/10',
        tone === 'info' && 'bg-muted/50'
      )}
    >
      <Icon
        className={cn(
          'mt-0.5 size-4 shrink-0',
          tone === 'destructive' && 'text-destructive',
          tone === 'warning' && 'text-warning-foreground dark:text-warning',
          tone === 'info' && 'text-muted-foreground'
        )}
        aria-hidden
      />
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  )
}

function rowContext(row: ClubImportRow): string {
  return [row.clubName, row.contactName, [row.zip, row.city].filter(Boolean).join(' ')].filter(Boolean).join(' · ')
}

function RowList({ title, rows, kind, testId }: { title: string; rows: ClubImportRow[]; kind: 'error' | 'warning'; testId: string }) {
  return (
    <section className="space-y-2" aria-label={title} data-testid={testId}>
      <h3 className="text-sm font-medium">
        {title} <span className="text-muted-foreground">({formatNumber(rows.length)})</span>
      </h3>
      <ul className="divide-y rounded-lg border">
        {rows.map((row) => (
          <li key={row.rowNumber} className="flex gap-3 px-3 py-2 text-sm">
            <span
              className={cn(
                'mt-0.5 inline-flex h-6 shrink-0 items-center rounded-md px-2 text-xs font-medium tabular-nums whitespace-nowrap',
                kind === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-warning/20 text-warning-foreground dark:text-warning'
              )}
            >
              Zeile {row.rowNumber}
            </span>
            <div className="min-w-0 flex-1">
              {(kind === 'error' ? row.errors : (row.warnings ?? [])).map((message) => (
                <p key={message} className="break-words">
                  {message}
                </p>
              ))}
              {rowContext(row) ? (
                <p className="truncate text-xs text-muted-foreground" title={rowContext(row)}>
                  {rowContext(row)}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function PreviewBody({
  preview,
  errorRows,
  warningRows,
  canImport
}: {
  preview: ClubImportPreview
  errorRows: ClubImportRow[]
  warningRows: ClubImportRow[]
  canImport: boolean
}) {
  const noHeader = preview.headerRow === null || preview.headerRow === undefined
  return (
    <>
      <p className="text-sm text-muted-foreground" data-testid="club-import-sheet">
        Blatt „{preview.sheetName}“
        {!noHeader ? ` · Kopfzeile in Zeile ${preview.headerRow}` : ''}
      </p>

      <div className="grid grid-cols-3 gap-2 sm:gap-3" data-testid="club-import-stats">
        <Stat label="Zeilen gesamt" value={preview.totalRows} />
        <Stat label="Gültig" value={preview.missingColumns.length > 0 ? 0 : preview.validRows} tone="success" />
        <Stat label="Fehlerhaft" value={errorRows.length} tone={errorRows.length > 0 ? 'destructive' : 'muted'} />
      </div>

      {preview.missingColumns.length > 0 ? (
        <Notice tone="destructive" testId="club-import-missing">
          <p className="font-medium">
            {noHeader
              ? 'Keine passende Kopfzeile gefunden – Import nicht möglich.'
              : `Pflichtspalte${preview.missingColumns.length === 1 ? '' : 'n'} fehlt: ${preview.missingColumns.join(', ')} – Import nicht möglich.`}
          </p>
          <p className="text-muted-foreground">
            Erwartet wird eine Kopfzeile mit den Spalten Name, Verein, Straße, PLZ, Ort und ang. Personen (Pflicht: Verein
            und ang. Personen). Die Anmelde-Vorlage hat genau diesen Aufbau.
          </p>
        </Notice>
      ) : null}

      {!noHeader && preview.missingColumns.length === 0 && (preview.missingOptionalColumns?.length ?? 0) > 0 ? (
        <Notice tone="info" testId="club-import-optional">
          <p>
            Nicht gefunden (optional): {preview.missingOptionalColumns!.join(', ')}. Diese Angaben bleiben leer.
          </p>
        </Notice>
      ) : null}

      {canImport ? (
        <Notice tone={importNeedsConfirmation(preview) ? 'warning' : 'info'} testId="club-import-replace">
          <ReplacementSummary preview={preview} />
          <p className="text-muted-foreground">
            Andere manuell angelegte Vereine und bereits erstellte Rechnungen bleiben unverändert.
            {errorRows.length > 0
              ? ` ${plural(errorRows.length, 'fehlerhafte Zeile wird', 'fehlerhafte Zeilen werden')} übersprungen.`
              : ''}
          </p>
        </Notice>
      ) : preview.missingColumns.length === 0 ? (
        <Notice tone="destructive" testId="club-import-none">
          <p className="font-medium">Die Datei enthält keine gültigen Vereine – Import nicht möglich.</p>
        </Notice>
      ) : null}

      {errorRows.length > 0 && preview.missingColumns.length === 0 ? (
        <RowList title="Fehlerhafte Zeilen" rows={errorRows} kind="error" testId="club-import-errors" />
      ) : null}
      {warningRows.length > 0 ? (
        <RowList title="Hinweise" rows={warningRows} kind="warning" testId="club-import-warnings" />
      ) : null}
    </>
  )
}
