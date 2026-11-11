/**
 * Route: /setup – Ersteinrichtung.
 * Zuständig: Bereich „Setup & Auslieferung“ (ersetzt diesen vorläufigen Assistenten:
 * Dokumentenordner wählen → erstes Fest anlegen → Abschluss).
 */
import { useState } from 'react'
import { Check, FolderOpen, LoaderCircle, ReceiptText } from 'lucide-react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { NewFestivalForm } from '@/components/layout/NewFestivalForm'
import { WindowDragBar } from '@/components/layout/WindowDragBar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useActiveFestival } from '@/hooks/use-active-festival'
import { useAppSettings } from '@/hooks/use-app-settings'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/utils'

export default function SetupPage() {
  const navigate = useNavigate()
  const { settings, updateSettings } = useAppSettings()
  const { festivals } = useActiveFestival()
  const [finishing, setFinishing] = useState(false)

  const hasDir = !!settings?.documentsDir
  const hasFestival = festivals.length > 0

  async function pickDir() {
    try {
      const dir = await api.app.pickDirectory({ title: 'Dokumentenordner für Rechnungs-PDFs wählen' })
      if (dir) await updateSettings({ documentsDir: dir })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  async function finish() {
    setFinishing(true)
    try {
      await updateSettings({ setupCompleted: true })
      void navigate('/festbuero', { replace: true })
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setFinishing(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/40">
      <WindowDragBar />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 sm:p-8">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <ReceiptText className="size-5" aria-hidden />
            </span>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Willkommen im Festbüro</h1>
              <p className="text-sm text-muted-foreground">In zwei Schritten ist die App startklar.</p>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {hasDir ? <Check className="size-5 text-success" aria-hidden /> : <span className="text-muted-foreground">1.</span>}
                Dokumentenordner wählen
              </CardTitle>
              <CardDescription>Hier legt die App die Rechnungs-PDFs ab.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-2 text-sm" title={settings?.documentsDir ?? ''}>
                {settings?.documentsDir ?? 'Noch nicht gewählt'}
              </code>
              <Button variant={hasDir ? 'outline' : 'default'} onClick={() => void pickDir()}>
                <FolderOpen aria-hidden />
                Ordner wählen …
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {hasFestival ? <Check className="size-5 text-success" aria-hidden /> : <span className="text-muted-foreground">2.</span>}
                Erstes Gründungsfest anlegen
              </CardTitle>
              <CardDescription>
                {hasFestival
                  ? `Angelegt: ${festivals.map((f) => f.name).join(', ')}`
                  : 'Name, Festdatum und Rechnungsnummern – alles später änderbar.'}
              </CardDescription>
            </CardHeader>
            {!hasFestival ? (
              <CardContent>
                <NewFestivalForm
                  renderActions={({ submitting, formId }) => (
                    <div className="mt-4 flex justify-end">
                      <Button type="submit" form={formId} disabled={submitting}>
                        {submitting ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                        Fest anlegen
                      </Button>
                    </div>
                  )}
                />
              </CardContent>
            ) : null}
          </Card>

          <div className="flex justify-end">
            <Button size="lg" disabled={!hasDir || !hasFestival || finishing} onClick={() => void finish()}>
              Einrichtung abschließen
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
