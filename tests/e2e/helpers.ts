/**
 * Helfer für E2E-Tests (Playwright + Electron).
 *
 *   const ctx = await launchApp()                 // isolierte Daten, Druck nur simuliert
 *   const festival = await prepareFestival(ctx.page)
 *   await setWindowSize(ctx.app, ...VIEWPORTS.min)
 *   await screenshot(ctx.page, 'vorlage-editor-min')
 *   await closeApp(ctx)
 *
 * Voraussetzung: gebaute App (`npm run build` bzw. `npm run test:e2e`).
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import type { ApiChannel, ApiParams, ApiResult } from '../../src/shared/ipc-channels'
import type { Festival, FestivalCreateInput } from '../../src/shared/types'

export const PROJECT_ROOT = resolve(__dirname, '../..')
/** Build-Ordner (Standard `out/`, mit FESTBUERO_OUT_DIR eigener Ordner pro Agent). */
export const OUT_DIR = resolve(PROJECT_ROOT, process.env.FESTBUERO_OUT_DIR || 'out')
export const MAIN_ENTRY = join(OUT_DIR, 'main', 'index.js')
export const SCREENSHOT_DIR = join(PROJECT_ROOT, 'test-results', 'screenshots')

/**
 * Fenstergrößen für Responsive-Prüfungen [Breite, Höhe] (Fenstergröße inkl. Titelleiste):
 * min = kleinste erlaubte Größe, split = halber Laptop-Bildschirm, laptop, large.
 */
export const VIEWPORTS = {
  min: [600, 560],
  split: [740, 900],
  laptop: [1280, 800],
  large: [1440, 900]
} as const satisfies Record<string, readonly [number, number]>
export type ViewportName = keyof typeof VIEWPORTS

export interface AppContext {
  app: ElectronApplication
  page: Page
  /** temporäres App-Datenverzeichnis (FESTBUERO_USER_DATA) */
  userDataDir: string
  /** temporärer Dokumentenordner (wird von prepareFestival gesetzt) */
  documentsDir: string
}

export interface LaunchOptions {
  /** vorhandenes Datenverzeichnis weiterverwenden (z. B. Neustart-Tests) */
  userDataDir?: string
  documentsDir?: string
  /** zusätzliche Umgebungsvariablen, z. B. { FESTBUERO_FAKE_PRINT_FAIL: '1' } */
  env?: Record<string, string>
  /** Startgröße des Fensters */
  viewport?: ViewportName | readonly [number, number]
}

/**
 * Polling per Intervall statt requestAnimationFrame: Testfenster öffnen inaktiv und können verdeckt
 * sein – dann feuert rAF nicht und `waitForFunction` würde erst am Timeout zurückkehren.
 * Eigene Tests sollten `page.waitForFunction(fn, arg, POLL)` ebenso verwenden.
 */
export const POLL = { polling: 100 } as const

const documentsDirByPage = new WeakMap<Page, string>()
const tempDirsByApp = new WeakMap<ElectronApplication, string[]>()

/**
 * Umgebung für einen App-Start im Test: isoliertes Datenverzeichnis, Druck nur simuliert,
 * E2E-Modus (Fenster ohne Fokus, keine fremden Programme). Entfernt gefährliche Variablen.
 */
export function buildAppEnv(userDataDir: string, extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  Object.assign(env, {
    FESTBUERO_USER_DATA: userDataDir,
    FESTBUERO_PRINT_DRY_RUN: '1',
    FESTBUERO_DISABLE_SHELL: '1',
    FESTBUERO_E2E: '1',
    ...extra
  })
  // Niemals echt drucken, nie im Node-Modus starten, nie den Dev-Server laden
  delete env.FESTBUERO_REAL_PRINT
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  return env
}

/** Startet die gebaute App mit isolierten Daten und simuliertem Druck. Immer mit `closeApp()` beenden. */
export async function launchApp(opts: LaunchOptions = {}): Promise<AppContext> {
  if (!existsSync(MAIN_ENTRY)) {
    throw new Error(`Build nicht gefunden: ${MAIN_ENTRY}. Bitte zuerst "npm run build" ausführen (oder "npm run test:e2e").`)
  }
  const created: string[] = []
  const userDataDir = opts.userDataDir ?? mkdtempSync(join(tmpdir(), 'festbuero-e2e-data-'))
  if (!opts.userDataDir) created.push(userDataDir)
  const documentsDir = opts.documentsDir ?? mkdtempSync(join(tmpdir(), 'festbuero-e2e-docs-'))
  if (!opts.documentsDir) created.push(documentsDir)

  const env = buildAppEnv(userDataDir, opts.env)

  const app = await electron.launch({ args: [MAIN_ENTRY], env, cwd: PROJECT_ROOT })
  tempDirsByApp.set(app, created)
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => typeof window.festbuero?.invoke === 'function', undefined, POLL)
  documentsDirByPage.set(page, documentsDir)

  if (opts.viewport) {
    const [w, h] = typeof opts.viewport === 'string' ? VIEWPORTS[opts.viewport] : opts.viewport
    await setWindowSize(app, w, h, page)
  }
  return { app, page, userDataDir, documentsDir }
}

/**
 * Beendet die App sauber über `app.close()` (nie per kill – sonst drohen Absturzberichte) und löscht
 * die temporären Ordner (außer FESTBUERO_KEEP_E2E_DATA=1).
 */
export async function closeApp(ctx: AppContext | ElectronApplication): Promise<void> {
  const app = 'app' in ctx ? ctx.app : ctx
  await app.close().catch((err: unknown) => console.warn('[e2e] app.close() fehlgeschlagen:', err))
  if (process.env.FESTBUERO_KEEP_E2E_DATA === '1') return
  for (const dir of tempDirsByApp.get(app) ?? []) {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Ruft einen IPC-Kanal im Renderer auf (über `window.festbuero.invoke`). */
export async function invoke<C extends ApiChannel>(page: Page, channel: C, ...args: ApiParams<C>): Promise<ApiResult<C>> {
  return (await page.evaluate(
    ([c, a]) => (window.festbuero.invoke as unknown as (ch: string, ...x: unknown[]) => Promise<unknown>)(c, ...a),
    [channel, args] as [string, unknown[]]
  )) as ApiResult<C>
}

export interface PrepareFestivalOptions {
  /** Standard: temporärer Dokumentenordner aus launchApp */
  documentsDir?: string
  festival?: Partial<FestivalCreateInput>
  /** Route nach dem Neuladen (Standard '/festbuero') */
  route?: string
  /**
   * Standarddrucker. Standard: der simulierte `E2E-Testdrucker` (erscheint nur unter Playwright in der
   * Druckerliste; gedruckt wird per Dry-Run). `null` = keinen Drucker setzen (Fall „Kein Drucker ausgewählt“).
   */
  printer?: string | null
}

/** Simulierter Drucker, den die App unter Playwright zusätzlich anbietet (siehe services/printing.ts). */
export const E2E_TEST_PRINTER = 'E2E-Testdrucker'

/**
 * Richtet die App für Tests ein: Dokumentenordner = temp, Ersteinrichtung abgeschlossen,
 * ein Fest angelegt und aktiv. Lädt den Renderer neu und wartet auf die Kopfleiste.
 */
export async function prepareFestival(page: Page, opts: PrepareFestivalOptions = {}): Promise<Festival> {
  let documentsDir = opts.documentsDir ?? documentsDirByPage.get(page)
  if (!documentsDir) {
    documentsDir = mkdtempSync(join(tmpdir(), 'festbuero-e2e-docs-'))
    documentsDirByPage.set(page, documentsDir)
  }
  const festival = await invoke(page, 'festivals.create', {
    name: 'Testfest 2025',
    festivalDate: '2025-06-01',
    numberPrefix: '2025-',
    numberStart: 1,
    numberDigits: 3,
    ...opts.festival
  })
  const defaultPrinter = opts.printer === undefined ? E2E_TEST_PRINTER : opts.printer
  await invoke(page, 'app.updateSettings', { documentsDir, setupCompleted: true, lastFestivalId: festival.id, defaultPrinter })
  await gotoRoute(page, opts.route ?? '/festbuero', { reload: true })
  await expect(page.getByTestId('app-header')).toBeVisible()
  return festival
}

/** Navigiert per Hash-Route; `reload: true` lädt den Renderer neu (frischer Query-Cache). */
export async function gotoRoute(page: Page, route: string, opts: { reload?: boolean } = {}): Promise<void> {
  if (opts.reload) {
    await page.reload()
    await page.waitForFunction(() => typeof window.festbuero?.invoke === 'function', undefined, POLL)
  }
  await page.evaluate((r) => {
    window.location.hash = `#${r}`
  }, route)
  await page.waitForFunction(
    (r) => window.location.hash === `#${r}` || window.location.hash.startsWith(`#${r}?`),
    route,
    POLL
  )
}

/**
 * Setzt die Fenstergröße (inkl. Titelleiste, wie minWidth/minHeight) und wartet, bis der Renderer
 * die neue Breite übernommen hat. Liefert die tatsächliche Inhaltsgröße.
 */
export async function setWindowSize(
  app: ElectronApplication,
  width: number,
  height: number,
  page?: Page
): Promise<{ width: number; height: number }> {
  const [cw, ch] = await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) throw new Error('Kein Fenster')
    if (win.isMaximized()) win.unmaximize()
    if (win.isFullScreen()) win.setFullScreen(false)
    win.setSize(w, h)
    return win.getContentSize()
  }, [width, height] as const)
  const target = page ?? (await app.firstWindow())
  await target.waitForFunction((w) => window.innerWidth === w, cw, POLL)
  // ein Frame für Layout/ResizeObserver
  await nextFrames(target)
  return { width: cw!, height: ch! }
}

/** Prüft, dass das Fenster nicht horizontal scrollt. Liefert die Maße zur Diagnose. */
export async function getHorizontalOverflow(page: Page): Promise<{ scrollWidth: number; clientWidth: number; overflow: boolean }> {
  return page.evaluate(() => {
    const el = document.documentElement
    const scrollWidth = Math.max(el.scrollWidth, document.body.scrollWidth)
    return { scrollWidth, clientWidth: el.clientWidth, overflow: scrollWidth > el.clientWidth }
  })
}

/** Erwartet: kein horizontaler Fenster-Scroll. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const m = await getHorizontalOverflow(page)
  expect(m.scrollWidth, `horizontaler Overflow: scrollWidth ${m.scrollWidth} > clientWidth ${m.clientWidth}`).toBeLessThanOrEqual(
    m.clientWidth
  )
}

/** Wartet zwei Frames (mit Zeitlimit, falls das Fenster verdeckt ist und rAF gedrosselt wird). */
export async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 250)
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            clearTimeout(timer)
            resolve()
          })
        )
      })
  )
}

/** Wartet, bis React gerendert hat (2 Frames), Schriften geladen und Rechnungsvorschauen fertig sind. */
export async function waitForStableUi(page: Page, timeoutMs = 5000): Promise<void> {
  await nextFrames(page)
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await page
    .waitForFunction(
      () => document.querySelectorAll('[data-testid="invoice-preview"][data-rendered="false"]').length === 0,
      undefined,
      { ...POLL, timeout: timeoutMs }
    )
    .catch(() => undefined)
}

/** Schließt alle offenen Toasts (z. B. vor Screenshots). */
export async function dismissToasts(page: Page): Promise<void> {
  await page.evaluate(() => {
    const hook = (window as unknown as { __festbuero?: { dismissToasts?: () => void } }).__festbuero
    if (hook?.dismissToasts) hook.dismissToasts()
    else document.querySelectorAll<HTMLButtonElement>('[data-sonner-toast] [data-close-button]').forEach((b) => b.click())
  })
  await page
    .waitForFunction(() => document.querySelectorAll('[data-sonner-toast]').length === 0, undefined, {
      ...POLL,
      timeout: 2000
    })
    .catch(() => undefined)
}

export interface ScreenshotOptions {
  /** offene Toasts vorher schließen (Standard false) */
  hideToasts?: boolean
  /** ganze Seite statt nur Fensterinhalt (Standard false) */
  fullPage?: boolean
}

/**
 * Speichert einen Screenshot nach `test-results/screenshots/<name>.png` und liefert den Pfad.
 * Wartet vorher auf stabile Darstellung; CSS-Animationen werden auf den Endzustand gesetzt.
 * Namenskonvention: `<bereich>-<ansicht>-<viewport>`, z. B. `vorlage-editor-min`.
 */
export async function screenshot(page: Page, name: string, opts: ScreenshotOptions = {}): Promise<string> {
  mkdirSync(SCREENSHOT_DIR, { recursive: true })
  const file = join(SCREENSHOT_DIR, `${name.replace(/[^a-zA-Z0-9._-]+/g, '-')}.png`)
  if (opts.hideToasts) await dismissToasts(page)
  await waitForStableUi(page)
  await page.screenshot({ path: file, animations: 'disabled', fullPage: opts.fullPage ?? false })
  return file
}

/** Setzt das Theme (light/dark/system) über die Einstellungen und wartet auf die Klasse am <html>. */
export async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.getByTestId('theme-menu').click()
  await page.getByRole('menuitemradio', { name: theme === 'dark' ? 'Dunkel' : 'Hell' }).click()
  await page.waitForFunction((t) => document.documentElement.classList.contains('dark') === (t === 'dark'), theme, POLL)
}

/**
 * Ersetzt native Datei-/Ordnerdialoge im Main-Prozess (für Tests von Import/Export).
 *   await stubDialogs(app, { open: ['/pfad/datei.xlsx'], save: '/tmp/ziel.xlsx' })
 * `null` simuliert „Abbrechen“.
 */
export async function stubDialogs(
  app: ElectronApplication,
  responses: { open?: string[] | null; save?: string | null }
): Promise<void> {
  await app.evaluate(({ dialog }, r) => {
    if ('open' in r) {
      const result = r.open ? { canceled: false, filePaths: r.open } : { canceled: true, filePaths: [] }
      dialog.showOpenDialog = (async () => result) as typeof dialog.showOpenDialog
    }
    if ('save' in r) {
      const result = r.save ? { canceled: false, filePath: r.save } : { canceled: true, filePath: '' }
      dialog.showSaveDialog = (async () => result) as typeof dialog.showSaveDialog
    }
  }, responses)
}

/**
 * Anzahl der macOS-Absturzberichte von Electron/Festbüro (nur lesen; andere Systeme → 0).
 * Vor/nach einem Testlauf vergleichen: Die Zahl darf nicht steigen.
 */
export function countCrashReports(): number {
  if (process.platform !== 'darwin') return 0
  const dir = join(homedir(), 'Library', 'Logs', 'DiagnosticReports')
  try {
    return readdirSync(dir).filter((f) => /^(electron|festb)/i.test(f.normalize('NFC'))).length
  } catch {
    return 0
  }
}
