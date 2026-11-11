import { useEffect, type ReactNode } from 'react'
import type { AppSettings } from '@shared/types'
import { QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HashRouter, Navigate, Route, Routes } from 'react-router'
import { AppShell } from '@/components/layout/AppShell'
import { FestSettingsLayout } from '@/components/layout/FestSettingsLayout'
import { RequireFestival } from '@/components/layout/RequireFestival'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { queryKeys } from '@/hooks/query-keys'
import { useAppSettings } from '@/hooks/use-app-settings'
import { useApplyTheme } from '@/hooks/use-theme'
import { onMainEvent } from '@/lib/api'
import { queryClient } from '@/lib/query-client'
import AuswertungPage from '@/pages/auswertung'
import EinstellungenPage from '@/pages/einstellungen'
import FestAllgemeinPage from '@/pages/fest/allgemein'
import FestNummernPage from '@/pages/fest/nummern'
import FestProduktePage from '@/pages/fest/produkte'
import FestVereinePage from '@/pages/fest/vereine'
import FestVorlagePage from '@/pages/fest/vorlage'
import FestZahlartenPage from '@/pages/fest/zahlarten'
import FestbueroPage from '@/pages/festbuero'
import RechnungenPage from '@/pages/rechnungen'
import SetupPage from '@/pages/setup'

function ThemeController() {
  useApplyTheme()
  return null
}

/** Übernimmt Änderungen aus dem Main-Prozess (Menü: Fest/Drucker/Theme, Vollbild). */
function MainEventsBridge() {
  useEffect(() => {
    const offSettings = onMainEvent('app.settingsChanged', (settings) => {
      const previous = queryClient.getQueryData<AppSettings>(queryKeys.settings)
      queryClient.setQueryData(queryKeys.settings, settings)
      void queryClient.invalidateQueries({ queryKey: queryKeys.printerStatus })
      // Fest über das Menü gewechselt (evtl. ein Fest, das die Liste noch nicht kennt)
      if (previous?.lastFestivalId !== settings.lastFestivalId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.festivals })
      }
    })
    const offPrinters = onMainEvent('printing.statusChanged', (status) => {
      queryClient.setQueryData(queryKeys.printerStatus, status)
      void queryClient.invalidateQueries({ queryKey: queryKeys.printers })
    })
    const offWindow = onMainEvent('window.state', ({ fullscreen }) => {
      document.documentElement.dataset.fullscreen = fullscreen ? 'true' : 'false'
    })
    // Hilfsfunktionen für E2E-Tests (harmlos, ohne Datenzugriff)
    ;(window as unknown as { __festbuero?: object }).__festbuero = { dismissToasts: () => toast.dismiss() }
    return () => {
      offSettings()
      offPrinters()
      offWindow()
    }
  }, [])
  return null
}

function Splash() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground" data-testid="splash">
      Festbüro wird geladen …
    </div>
  )
}

/** Leitet auf /setup um, solange die Ersteinrichtung nicht abgeschlossen ist. */
function SetupGuard({ children }: { children: ReactNode }) {
  const { settings, isLoading, error } = useAppSettings()
  if (isLoading) return <Splash />
  if (error || !settings) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-destructive" role="alert">
        Einstellungen konnten nicht geladen werden: {error instanceof Error ? error.message : 'unbekannter Fehler'}
      </div>
    )
  }
  if (!settings.setupCompleted) return <Navigate to="/setup" replace />
  return <>{children}</>
}

function withFestival(page: ReactNode): ReactNode {
  return <RequireFestival>{page}</RequireFestival>
}

/** Routen laut docs/architecture.md §9. */
function AppRoutes() {
  return (
    <Routes>
      <Route path="/setup" element={<SetupPage />} />
      <Route
        element={
          <SetupGuard>
            <AppShell />
          </SetupGuard>
        }
      >
        <Route index element={<Navigate to="/festbuero" replace />} />
        <Route path="/festbuero" element={withFestival(<FestbueroPage />)} />
        <Route path="/rechnungen" element={withFestival(<RechnungenPage />)} />
        <Route path="/auswertung" element={withFestival(<AuswertungPage />)} />
        <Route path="/fest" element={withFestival(<FestSettingsLayout />)}>
          <Route index element={<Navigate to="/fest/allgemein" replace />} />
          <Route path="allgemein" element={<FestAllgemeinPage />} />
          <Route path="nummern" element={<FestNummernPage />} />
          <Route path="produkte" element={<FestProduktePage />} />
          <Route path="zahlarten" element={<FestZahlartenPage />} />
          <Route path="vereine" element={<FestVereinePage />} />
          <Route path="vorlage" element={<FestVorlagePage />} />
        </Route>
        <Route path="/einstellungen" element={<EinstellungenPage />} />
        <Route path="*" element={<Navigate to="/festbuero" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeController />
        <MainEventsBridge />
        <HashRouter>
          <AppRoutes />
        </HashRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
