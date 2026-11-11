import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Info, LoaderCircle, Printer, RefreshCw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { PrinterInfo } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { queryKeys } from '@/hooks/query-keys'
import { useAppInfo, useAppSettings } from '@/hooks/use-app-settings'
import { usePrinters } from '@/hooks/use-printers'
import { cn, errorMessage } from '@/lib/utils'
import { StepActions, StepHeading } from './wizard'

interface PrinterStepProps {
  /** gewählter Drucker; undefined = noch keine Auswahl getroffen (Vorbelegung aus Einstellungen/System) */
  value: string | null | undefined
  onChange: (printer: string) => void
  onDone: () => void
}

/** Vorbelegung: gespeicherter Drucker, sonst Systemstandard. */
export function initialPrinter(saved: string | null | undefined, printers: PrinterInfo[]): string | null {
  if (saved) return saved
  return printers.find((p) => p.isDefault)?.name ?? null
}

export function PrinterStep({ value, onChange, onDone }: PrinterStepProps) {
  const queryClient = useQueryClient()
  const { settings, updateSettings } = useAppSettings()
  const { data: info } = useAppInfo()
  const { data: printers = [], isLoading, isError, isFetching } = usePrinters()
  const [saving, setSaving] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  const selected = value !== undefined ? value : initialPrinter(settings?.defaultPrinter, printers)
  const selectedMissing = !!selected && !isLoading && !printers.some((p) => p.name === selected)

  // Fokus auf den gewählten Drucker, sobald die Liste da ist (Pfeiltasten wählen, Enter = weiter)
  useEffect(() => {
    if (isLoading) return
    const radio =
      listRef.current?.querySelector<HTMLButtonElement>('[role="radio"][data-state="checked"]') ??
      listRef.current?.querySelector<HTMLButtonElement>('[role="radio"]')
    radio?.focus({ preventScroll: true })
  }, [isLoading])

  async function save() {
    if (saving) return
    if (!selected || selected === settings?.defaultPrinter) {
      onDone()
      return
    }
    setSaving(true)
    try {
      await updateSettings({ defaultPrinter: selected })
      onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <StepHeading
        icon={<Printer aria-hidden />}
        title="Mit welchem Drucker wird gedruckt?"
        description="Nach dem Abschließen druckt die App jede Rechnung ohne Druckdialog auf diesem Drucker. Er lässt sich jederzeit oben in der Kopfleiste wechseln."
      />

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium" id="setup-printer-label">
            Installierte Drucker
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void queryClient.invalidateQueries({ queryKey: queryKeys.printers })}
            disabled={isFetching}
          >
            <RefreshCw className={cn(isFetching && 'animate-spin')} aria-hidden />
            Aktualisieren
          </Button>
        </div>

        {isLoading ? (
          <p className="flex items-center gap-2 rounded-lg border p-4 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            Drucker werden gesucht …
          </p>
        ) : isError ? (
          <p className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive" role="alert">
            Die Druckerliste ist nicht verfügbar. Sie können diesen Schritt überspringen.
          </p>
        ) : printers.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground" data-testid="setup-no-printers">
            Kein Drucker gefunden. Richten Sie den Festdrucker im Betriebssystem ein und klicken Sie auf
            „Aktualisieren“ – oder überspringen Sie diesen Schritt und wählen Sie den Drucker später.
          </p>
        ) : (
          <div ref={listRef}>
            <RadioGroup
              value={selected ?? ''}
              onValueChange={onChange}
              aria-labelledby="setup-printer-label"
              className="max-h-64 gap-2 overflow-auto p-0.5"
              data-testid="setup-printer-list"
            >
              {printers.map((p) => {
                const checked = p.name === selected
                return (
                  <label
                    key={p.name}
                    className={cn(
                      'flex min-w-0 cursor-pointer items-center gap-3 rounded-lg border bg-background p-3 transition-colors hover:bg-accent/50',
                      checked && 'border-primary bg-primary/5 hover:bg-primary/10'
                    )}
                    title={p.displayName}
                  >
                    <RadioGroupItem value={p.name} aria-label={p.displayName} />
                    <Printer className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.displayName}</span>
                    {p.isDefault ? <Badge variant="outline">Systemstandard</Badge> : null}
                  </label>
                )
              })}
            </RadioGroup>
          </div>
        )}
        {selectedMissing ? (
          <p className="text-sm text-warning-foreground dark:text-warning" role="status">
            Der gespeicherte Drucker „{selected}“ ist derzeit nicht verfügbar.
          </p>
        ) : null}
      </div>

      {info?.printDryRun ? (
        <p className="flex gap-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          In dieser Umgebung wird der Druck nur simuliert – es wird nichts an den Drucker gesendet.
        </p>
      ) : null}

      <StepActions onPrimary={() => void save()}>
        <Button variant="ghost" onClick={onDone} data-testid="setup-skip">
          Überspringen
        </Button>
        <Button onClick={() => void save()} disabled={saving} data-testid="setup-next">
          {saving ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          Weiter
          {saving ? null : <ArrowRight aria-hidden />}
        </Button>
      </StepActions>
    </div>
  )
}
