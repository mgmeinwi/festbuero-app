/**
 * Route: /einstellungen – App-Einstellungen.
 * Zuständig: Bereich „Setup & Auslieferung“ (ersetzt diesen vorläufigen Stand: Dokumentenordner,
 * Darstellung, App-Infos; es fehlen Drucker-Testseite, Datensicherung, Beispieldaten).
 */
import { FolderOpen } from 'lucide-react'
import { toast } from 'sonner'
import type { ThemePreference } from '@shared/types'
import { PageContainer, PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useAppInfo, useAppSettings } from '@/hooks/use-app-settings'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/utils'

export default function EinstellungenPage() {
  const { settings, updateSettings } = useAppSettings()
  const { data: info } = useAppInfo()

  async function pickDocumentsDir() {
    try {
      const dir = await api.app.pickDirectory({
        title: 'Dokumentenordner für Rechnungs-PDFs wählen',
        defaultPath: settings?.documentsDir ?? undefined
      })
      if (!dir) return
      await updateSettings({ documentsDir: dir })
      toast.success('Dokumentenordner gespeichert.')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <PageContainer className="max-w-3xl">
      <PageHeader title="App-Einstellungen" description="Gelten für diesen Rechner." />

      <Card>
        <CardHeader>
          <CardTitle>Dokumentenordner</CardTitle>
          <CardDescription>Hier werden die Rechnungs-PDFs abgelegt (pro Fest ein Unterordner).</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <code
            className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-2 text-sm"
            title={settings?.documentsDir ?? ''}
            data-testid="documents-dir"
          >
            {settings?.documentsDir ?? 'Noch nicht gewählt'}
          </code>
          <Button variant="outline" onClick={() => void pickDocumentsDir()}>
            <FolderOpen aria-hidden />
            Ordner wählen …
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Darstellung</CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={settings?.theme ?? 'system'}
            onValueChange={(value) => {
              updateSettings({ theme: value as ThemePreference }).catch((err) => toast.error(errorMessage(err)))
            }}
            className="flex flex-wrap gap-6"
          >
            {(
              [
                ['light', 'Hell'],
                ['dark', 'Dunkel'],
                ['system', 'Wie System']
              ] as const
            ).map(([value, label]) => (
              <div key={value} className="flex items-center gap-2">
                <RadioGroupItem value={value} id={`theme-${value}`} />
                <Label htmlFor={`theme-${value}`}>{label}</Label>
              </div>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Über die App</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Version</dt>
            <dd>{info?.version ?? '–'}</dd>
            <dt className="text-muted-foreground">Datenverzeichnis</dt>
            <dd className="truncate" title={info?.userDataDir}>
              {info?.userDataDir ?? '–'}
            </dd>
            <dt className="text-muted-foreground">Druck</dt>
            <dd>{info ? (info.printDryRun ? 'simuliert (Entwicklung/Test)' : 'echt') : '–'}</dd>
          </dl>
        </CardContent>
      </Card>
    </PageContainer>
  )
}
