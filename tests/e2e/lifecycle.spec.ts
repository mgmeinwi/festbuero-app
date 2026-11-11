import { spawn } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { buildAppEnv, closeApp, countCrashReports, invoke, launchApp, MAIN_ENTRY, PROJECT_ROOT } from './helpers'

/** Pfad zur Electron-Binärdatei (das npm-Paket `electron` exportiert ihn in Node). */
const electronBinary = require('electron') as unknown as string

test.describe.serial('Lebenszyklus: sauberes Beenden ohne Absturz', () => {
  const crashesBefore = countCrashReports()

  test('App beendet sich über app.close() mit Exit-Code 0', async () => {
    const ctx = await launchApp()
    const proc = ctx.app.process()
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
      proc.once('exit', (code, signal) => resolve({ code, signal }))
    )
    expect((await invoke(ctx.page, 'app.getSettings')).setupCompleted).toBe(false)
    // Fenster im E2E-Modus sichtbar, aber ohne Fokus geöffnet (showInactive)
    expect(await ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(true)
    await closeApp(ctx)
    expect(await exited).toEqual({ code: 0, signal: null })
  })

  test('zweite Instanz mit demselben Datenverzeichnis beendet sich sauber', async () => {
    const ctx = await launchApp()
    const second = spawn(electronBinary, [MAIN_ENTRY], {
      cwd: PROJECT_ROOT,
      env: buildAppEnv(ctx.userDataDir),
      stdio: 'ignore'
    })
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('zweite Instanz hat sich nicht beendet')), 20_000)
      second.once('exit', (code, signal) => {
        clearTimeout(timer)
        resolve({ code, signal })
      })
    })
    expect(result).toEqual({ code: 0, signal: null })
    // erste Instanz läuft weiter
    expect((await invoke(ctx.page, 'app.getInfo')).printDryRun).toBe(true)
    await closeApp(ctx)
  })

  test('keine neuen Absturzberichte', async () => {
    // macOS schreibt Berichte mit kurzer Verzögerung
    await new Promise((r) => setTimeout(r, 3000))
    expect(countCrashReports()).toBe(crashesBefore)
  })
})
