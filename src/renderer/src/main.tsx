import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import './styles/globals.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { applyThemeClass } from './hooks/use-theme'
import { detectPlatform } from './lib/platform'

// Bis die Einstellungen geladen sind, dem Betriebssystem folgen (kein Aufblitzen).
applyThemeClass(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
// Plattform für CSS (Ampel links auf macOS, Fensterknöpfe rechts auf Windows/Linux)
document.documentElement.dataset.platform = detectPlatform()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
