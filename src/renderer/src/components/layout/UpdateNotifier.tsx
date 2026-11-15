import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useUpdateStatus } from '@/hooks/use-updates'

const SETTINGS_PATH = '/einstellungen'

/**
 * Meldet eine neu gefundene Version einmal als Hinweis (unten rechts) mit Sprung zu den
 * App-Einstellungen. Auf der Einstellungsseite selbst ist der Hinweis überflüssig.
 */
export function UpdateNotifier() {
  const { data: status } = useUpdateStatus()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const notified = useRef<string | null>(null)

  useEffect(() => {
    if (status?.phase !== 'available' || !status.latestVersion) return
    if (notified.current === status.latestVersion) return
    notified.current = status.latestVersion
    if (pathname === SETTINGS_PATH) return
    toast.info(`Festbüro ${status.latestVersion} ist verfügbar`, {
      id: 'update-available',
      description: 'Das Update lässt sich in den App-Einstellungen installieren.',
      duration: 15_000,
      action: { label: 'Ansehen', onClick: () => void navigate(SETTINGS_PATH) }
    })
  }, [status?.phase, status?.latestVersion, pathname, navigate])

  return null
}
