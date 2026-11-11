import { useState } from 'react'
import { ArrowRight, Folder, FolderOpen, LoaderCircle, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useAppSettings } from '@/hooks/use-app-settings'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/utils'
import { PathText } from '../einstellungen/PathText'
import { StepActions, StepHeading } from './wizard'

interface DocumentsStepProps {
  /** aktuell gewählter Ordner (noch nicht gespeichert) */
  value: string | null
  /** Vorschlag `<Dokumente>/Festbüro` */
  suggestion: string | undefined
  onChange: (dir: string) => void
  onDone: () => void
}

export function DocumentsStep({ value, suggestion, onChange, onDone }: DocumentsStepProps) {
  const { updateSettings } = useAppSettings()
  const [saving, setSaving] = useState(false)
  const dir = value ?? suggestion ?? null

  async function pick() {
    try {
      const picked = await api.app.pickDirectory({
        title: 'Dokumentenordner für Rechnungs-PDFs wählen',
        defaultPath: dir ?? undefined
      })
      if (picked) onChange(picked)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  async function save() {
    if (!dir || saving) return
    setSaving(true)
    try {
      // legt den Ordner bei Bedarf an
      await updateSettings({ documentsDir: dir })
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
        icon={<FolderOpen aria-hidden />}
        title="Wo sollen die Rechnungen abgelegt werden?"
        description="Die App speichert jede Rechnung als PDF in diesem Ordner – pro Fest in einem eigenen Unterordner."
      />

      <div className="space-y-3">
        <div className="flex min-w-0 items-center gap-3 rounded-lg border bg-background p-3">
          <Folder className="size-5 shrink-0 text-primary" aria-hidden />
          {dir ? (
            <PathText path={dir} className="flex-1 font-mono text-sm" data-testid="setup-documents-dir" />
          ) : (
            <span className="flex-1 text-sm text-muted-foreground">Wird ermittelt …</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void pick()}>
            <FolderOpen aria-hidden />
            Anderen Ordner wählen …
          </Button>
          {suggestion && dir !== suggestion ? (
            <Button variant="ghost" onClick={() => onChange(suggestion)}>
              <RotateCcw aria-hidden />
              Vorschlag verwenden
            </Button>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg border border-dashed p-3 text-sm">
        <p className="mb-2 font-medium">So sieht die Ablage später aus</p>
        <ul className="space-y-1 font-mono text-xs text-muted-foreground">
          <li className="truncate">
            <Folder className="mr-1.5 inline size-3.5 align-[-2px]" aria-hidden />
            &lt;Festname&gt;/Rechnungen/2025-001.pdf
          </li>
          <li className="truncate">
            <Folder className="mr-1.5 inline size-3.5 align-[-2px]" aria-hidden />
            &lt;Festname&gt;/Stornos/
          </li>
          <li className="truncate">
            <Folder className="mr-1.5 inline size-3.5 align-[-2px]" aria-hidden />
            Datensicherungen/
          </li>
        </ul>
        <p className="mt-3 text-muted-foreground">Existiert der Ordner noch nicht, wird er angelegt.</p>
      </div>

      <StepActions onPrimary={() => void save()}>
        <Button onClick={() => void save()} disabled={!dir || saving} data-testid="setup-next">
          {saving ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          Weiter
          {saving ? null : <ArrowRight aria-hidden />}
        </Button>
      </StepActions>
    </div>
  )
}
