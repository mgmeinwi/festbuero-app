import { Monitor, Moon, Sun } from 'lucide-react'
import { toast } from 'sonner'
import type { ThemePreference } from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useAppSettings } from '@/hooks/use-app-settings'
import { useResolvedTheme } from '@/hooks/use-theme'
import { errorMessage } from '@/lib/utils'

const OPTIONS: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Hell', icon: Sun },
  { value: 'dark', label: 'Dunkel', icon: Moon },
  { value: 'system', label: 'Wie System', icon: Monitor }
]

/** Hell/Dunkel/System (speichert `theme` in den App-Einstellungen). */
export function ThemeMenu() {
  const { settings, updateSettings } = useAppSettings()
  const resolved = useResolvedTheme()
  const Icon = resolved === 'dark' ? Moon : Sun
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" title="Darstellung" aria-label="Darstellung (hell/dunkel)" data-testid="theme-menu">
          <Icon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>Darstellung</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={settings?.theme ?? 'system'}
          onValueChange={(value) => {
            updateSettings({ theme: value as ThemePreference }).catch((err) => toast.error(errorMessage(err)))
          }}
        >
          {OPTIONS.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value}>
              <o.icon aria-hidden />
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
