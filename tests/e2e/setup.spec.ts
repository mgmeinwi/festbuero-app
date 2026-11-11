/**
 * E2E: Ersteinrichtungs-Assistent und App-Einstellungen (Bereich „Setup & Auslieferung“).
 *
 *   FESTBUERO_OUT_DIR=out/setup npm run test:e2e -- tests/e2e/setup.spec.ts
 *
 * Screenshots: test-results/screenshots/setup-*.png (hell, alle vier Größen; dunkel ausgewählt).
 */
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  closeApp,
  countCrashReports,
  dismissToasts,
  E2E_TEST_PRINTER,
  expectNoHorizontalOverflow,
  gotoRoute,
  invoke,
  launchApp,
  POLL,
  prepareFestival,
  screenshot,
  setWindowSize,
  stubDialogs,
  VIEWPORTS,
  type AppContext,
  type ViewportName
} from './helpers'

const VIEWPORT_NAMES = Object.keys(VIEWPORTS) as ViewportName[]

async function hash(page: Page): Promise<string> {
  return page.evaluate(() => window.location.hash)
}

/** Theme über die Einstellungen setzen (der Assistent hat keine Kopfleiste mit Theme-Menü). */
async function applyTheme(ctx: AppContext, theme: 'light' | 'dark'): Promise<void> {
  await invoke(ctx.page, 'app.updateSettings', { theme })
  await ctx.page.waitForFunction((t) => document.documentElement.classList.contains('dark') === (t === 'dark'), theme, POLL)
}

/** Alle vier Größen: kein horizontaler Overflow, Aktionsleiste sichtbar, Screenshot. */
async function captureAllSizes(ctx: AppContext, name: string, opts: { actionTestId?: string } = {}): Promise<void> {
  for (const vp of VIEWPORT_NAMES) {
    const size = await setWindowSize(ctx.app, VIEWPORTS[vp][0], VIEWPORTS[vp][1], ctx.page)
    await expectNoHorizontalOverflow(ctx.page)
    if (opts.actionTestId) {
      const box = await ctx.page.getByTestId(opts.actionTestId).boundingBox()
      expect(box, `${opts.actionTestId} sichtbar bei ${vp}`).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 0.5)
      expect(box!.y + box!.height).toBeLessThanOrEqual(size.height + 0.5)
    }
    await screenshot(ctx.page, `setup-${name}-${vp}`, { hideToasts: true })
  }
  await setWindowSize(ctx.app, VIEWPORTS.laptop[0], VIEWPORTS.laptop[1], ctx.page)
}

/** Dunkelmodus-Screenshot bei einer Größe. */
async function captureDark(ctx: AppContext, name: string, vp: ViewportName = 'min'): Promise<void> {
  await applyTheme(ctx, 'dark')
  await setWindowSize(ctx.app, VIEWPORTS[vp][0], VIEWPORTS[vp][1], ctx.page)
  await expectNoHorizontalOverflow(ctx.page)
  await screenshot(ctx.page, `setup-${name}-${vp}-dark`, { hideToasts: true })
  await applyTheme(ctx, 'light')
  await setWindowSize(ctx.app, VIEWPORTS.laptop[0], VIEWPORTS.laptop[1], ctx.page)
}

let crashesBefore = 0
test.beforeAll(() => {
  crashesBefore = countCrashReports()
})
test.afterAll(() => {
  expect(countCrashReports(), 'keine neuen Absturzberichte').toBe(crashesBefore)
})

test.describe.serial('Ersteinrichtung: Assistent komplett per Tastatur', () => {
  let ctx: AppContext
  let chosenDir: string

  test.beforeAll(async () => {
    ctx = await launchApp({ viewport: 'laptop' })
    chosenDir = join(ctx.documentsDir, 'Festbüro Rechnungen')
  })

  test.afterAll(async () => {
    if (ctx) await closeApp(ctx)
  })

  test('Schritt 1: Willkommen', async () => {
    await expect.poll(() => hash(ctx.page)).toBe('#/setup')
    await expect(ctx.page.getByRole('heading', { name: 'Willkommen im Festbüro' })).toBeVisible()
    await expect(ctx.page.getByTestId('setup-progress')).toContainText('Schritt 1 von 5')
    await expect(ctx.page.getByTestId('setup-close')).toHaveCount(0)
    await captureAllSizes(ctx, 'welcome', { actionTestId: 'setup-next' })
    await captureDark(ctx, 'welcome')

    // Enter = weiter
    await ctx.page.getByRole('heading', { name: 'Willkommen im Festbüro' }).focus()
    await ctx.page.keyboard.press('Enter')
    await expect(ctx.page.getByTestId('setup-step-documents')).toBeVisible()
  })

  test('Schritt 2: Dokumentenordner (Vorschlag, Auswahl per Dialog, wird angelegt)', async () => {
    const suggestion = await invoke(ctx.page, 'app.getDefaultDocumentsDir')
    // In Tests liegt der Vorschlag im isolierten Datenverzeichnis, nie in ~/Documents
    expect(suggestion).toBe(join(ctx.userDataDir, 'Dokumente', 'Festbüro'))
    await expect(ctx.page.getByTestId('setup-documents-dir')).toHaveText(suggestion)

    await captureAllSizes(ctx, 'documents', { actionTestId: 'setup-next' })
    await captureDark(ctx, 'documents')

    await stubDialogs(ctx.app, { open: [chosenDir] })
    await ctx.page.getByRole('button', { name: 'Anderen Ordner wählen …' }).click()
    await expect(ctx.page.getByTestId('setup-documents-dir')).toHaveText(chosenDir)
    await expect(ctx.page.getByRole('button', { name: 'Vorschlag verwenden' })).toBeVisible()
    expect(existsSync(chosenDir)).toBe(false)

    await ctx.page.getByRole('heading', { name: /Wo sollen die Rechnungen/ }).focus()
    await ctx.page.keyboard.press('Enter')
    await expect(ctx.page.getByTestId('setup-step-printer')).toBeVisible()
    expect((await invoke(ctx.page, 'app.getSettings')).documentsDir).toBe(chosenDir)
    expect(statSync(chosenDir).isDirectory()).toBe(true)
  })

  test('Schritt 3: Drucker (Auswahl, Enter speichert)', async () => {
    const printers = await invoke(ctx.page, 'printing.listPrinters')
    // unter Playwright bietet die App den simulierten „E2E-Testdrucker“ an
    expect(printers.some((p) => p.name === E2E_TEST_PRINTER)).toBe(true)
    await expect(ctx.page.getByTestId('setup-printer-list')).toBeVisible()
    await expect(ctx.page.getByRole('radio')).toHaveCount(printers.length)
    // Fokus liegt in der Druckerliste (Pfeiltasten wählen, Enter = weiter)
    await expect.poll(() => ctx.page.evaluate(() => document.activeElement?.getAttribute('role'))).toBe('radio')
    await captureAllSizes(ctx, 'printer', { actionTestId: 'setup-next' })
    await captureDark(ctx, 'printer')

    await ctx.page.getByRole('radio', { name: E2E_TEST_PRINTER }).click()
    await expect(ctx.page.getByRole('radio', { name: E2E_TEST_PRINTER })).toBeFocused()
    await ctx.page.keyboard.press('Enter')
    await expect(ctx.page.getByTestId('setup-step-festival')).toBeVisible()
    expect((await invoke(ctx.page, 'app.getSettings')).defaultPrinter).toBe(E2E_TEST_PRINTER)
  })

  test('Schritt 4: erstes Gründungsfest (Formular, Enter legt an)', async () => {
    const name = ctx.page.getByLabel('Name des Fests')
    await expect(name).toBeFocused()
    await expect(ctx.page.getByTestId('setup-sample-festival')).toBeVisible()
    await captureAllSizes(ctx, 'festival', { actionTestId: 'setup-next' })
    await captureDark(ctx, 'festival')

    await name.fill('Jubiläumsfest 2026')
    await ctx.page.getByLabel('Festdatum').fill('2026-07-04')
    await expect(ctx.page.getByLabel('Präfix')).toHaveValue('2026-')
    await expect(ctx.page.getByLabel('Startnummer')).toHaveValue('1')
    await expect(ctx.page.getByLabel('Stellenzahl')).toHaveValue('3')
    await expect(ctx.page.getByTestId('setup-step-festival')).toContainText('2026-001')
    await name.press('Enter')

    await expect(ctx.page.getByTestId('setup-step-done')).toBeVisible()
    const festivals = await invoke(ctx.page, 'festivals.list')
    expect(festivals).toHaveLength(1)
    expect(festivals[0]).toMatchObject({ name: 'Jubiläumsfest 2026', numberPrefix: '2026-', numberStart: 1, numberDigits: 3 })
    expect((await invoke(ctx.page, 'app.getSettings')).lastFestivalId).toBe(festivals[0]!.id)
  })

  test('Schritt 5: Zusammenfassung, Testseite, „Los geht’s“', async () => {
    const summary = ctx.page.getByTestId('setup-summary')
    await expect(summary).toContainText(chosenDir)
    await expect(summary).toContainText('Jubiläumsfest 2026')
    await expect(summary).toContainText('2026-001')
    await captureAllSizes(ctx, 'done', { actionTestId: 'setup-finish' })
    await captureDark(ctx, 'done')

    // zurück zu Schritt 3 über die Fortschrittsanzeige und wieder vor
    await ctx.page.getByRole('button', { name: 'Zurück zu Schritt 4: Fest' }).click()
    await expect(ctx.page.getByTestId('setup-festival-list')).toContainText('Jubiläumsfest 2026')
    await ctx.page.getByTestId('setup-next').click()
    await expect(ctx.page.getByTestId('setup-step-done')).toBeVisible()

    // Testseite (Dry-Run) → Erfolgsmeldung, Eintrag im Druckprotokoll
    await expect(summary).toContainText(E2E_TEST_PRINTER)
    await ctx.page.getByTestId('setup-test-page').click()
    await expect(
      ctx.page.locator('[data-sonner-toast]').filter({ hasText: `Testseite für „${E2E_TEST_PRINTER}“ simuliert` })
    ).toBeVisible()
    await expect.poll(() => existsSync(join(ctx.userDataDir, 'print-dry-run.log'))).toBe(true)
    await dismissToasts(ctx.page)

    await ctx.page.getByRole('heading', { name: 'Alles bereit!' }).focus()
    await ctx.page.keyboard.press('Enter')
    await expect.poll(() => hash(ctx.page)).toBe('#/festbuero')
    await expect(ctx.page.getByTestId('app-header')).toBeVisible()
    expect((await invoke(ctx.page, 'app.getSettings')).setupCompleted).toBe(true)
  })
})

test.describe.serial('Ersteinrichtung: Beispiel-Fest', () => {
  let ctx: AppContext

  test.beforeAll(async () => {
    ctx = await launchApp({ viewport: 'split' })
  })

  test.afterAll(async () => {
    if (ctx) await closeApp(ctx)
  })

  test('Beispiel-Fest anlegen und Vorschlag als Ordner übernehmen', async () => {
    await expect(ctx.page.getByTestId('setup-step-welcome')).toBeVisible()
    await ctx.page.getByTestId('setup-next').click()
    // Vorschlag übernehmen → Ordner wird angelegt (im isolierten Datenverzeichnis)
    const suggestion = await invoke(ctx.page, 'app.getDefaultDocumentsDir')
    await ctx.page.getByTestId('setup-next').click()
    await expect(ctx.page.getByTestId('setup-step-printer')).toBeVisible()
    expect(statSync(suggestion).isDirectory()).toBe(true)
    await ctx.page.getByTestId('setup-skip').click()

    await ctx.page.getByTestId('setup-sample-festival').click()
    await expect(ctx.page.getByTestId('setup-step-done')).toBeVisible()
    await expect(ctx.page.getByTestId('setup-summary')).toContainText('Beispiel-Gründungsfest')
    await expect(ctx.page.getByTestId('setup-summary')).toContainText('BSP-001')

    const festivals = await invoke(ctx.page, 'festivals.list')
    expect(festivals).toHaveLength(1)
    expect(festivals[0]).toMatchObject({ name: 'Beispiel-Gründungsfest', numberPrefix: 'BSP-', taxExempt: true })
    expect((await invoke(ctx.page, 'app.getSettings')).lastFestivalId).toBe(festivals[0]!.id)
    // Logo wurde inhaltsadressiert ins Datenverzeichnis kopiert
    const logos = readdirSync(join(ctx.userDataDir, 'logos'))
    expect(logos.some((f) => /^[0-9a-f]{64}\.svg$/.test(f))).toBe(true)

    await ctx.page.getByTestId('setup-finish').click()
    await expect.poll(() => hash(ctx.page)).toBe('#/festbuero')
  })
})

test.describe.serial('App-Einstellungen', () => {
  let ctx: AppContext
  let otherDocs: string

  test.beforeAll(async () => {
    ctx = await launchApp({ viewport: 'laptop' })
    await prepareFestival(ctx.page, { route: '/einstellungen' })
    otherDocs = mkdtempSync(join(tmpdir(), 'festbuero-e2e-docs2-'))
  })

  test.afterAll(async () => {
    if (ctx) await closeApp(ctx)
    if (otherDocs) rmSync(otherDocs, { recursive: true, force: true })
  })

  test('Seite bei allen Größen, hell und dunkel', async () => {
    await expect(ctx.page.getByRole('heading', { name: 'App-Einstellungen' })).toBeVisible()
    await expect(ctx.page.getByTestId('documents-dir')).toHaveText(ctx.documentsDir)
    await expect(ctx.page.getByTestId('settings-dry-run')).toBeVisible()
    await expect(ctx.page.getByTestId('settings-version')).not.toHaveText('–')
    await captureAllSizes(ctx, 'settings')
    await captureDark(ctx, 'settings', 'split')
    await captureDark(ctx, 'settings', 'large')

    // unterer Teil bei kleinster Größe (Seite scrollt intern)
    await setWindowSize(ctx.app, VIEWPORTS.min[0], VIEWPORTS.min[1], ctx.page)
    await ctx.page.getByTestId('settings-info').scrollIntoViewIfNeeded()
    await expectNoHorizontalOverflow(ctx.page)
    await screenshot(ctx.page, 'setup-settings-min-bottom')
    await applyTheme(ctx, 'dark')
    await screenshot(ctx.page, 'setup-settings-min-bottom-dark')
    await applyTheme(ctx, 'light')
    await setWindowSize(ctx.app, VIEWPORTS.laptop[0], VIEWPORTS.laptop[1], ctx.page)
  })

  test('Dokumentenordner ändern', async () => {
    const target = join(otherDocs, 'Neuer Ordner')
    await stubDialogs(ctx.app, { open: [target] })
    await ctx.page.getByRole('button', { name: 'Ändern …' }).click()
    await expect(ctx.page.getByTestId('documents-dir')).toHaveText(target)
    expect((await invoke(ctx.page, 'app.getSettings')).documentsDir).toBe(target)
    expect(statSync(target).isDirectory()).toBe(true)

    // Abbrechen ändert nichts
    await stubDialogs(ctx.app, { open: null })
    await ctx.page.getByRole('button', { name: 'Ändern …' }).click()
    await expect(ctx.page.getByTestId('documents-dir')).toHaveText(target)

    // „Im Finder öffnen“ wird in E2E nur protokolliert
    await ctx.page.getByRole('button', { name: /^Im (Finder|Explorer) öffnen$/ }).click()
    await expect.poll(() => existsSync(join(ctx.userDataDir, 'shell.log'))).toBe(true)
    await dismissToasts(ctx.page)
  })

  test('Darstellung umschalten', async () => {
    const theme = ctx.page.getByTestId('settings-theme')
    await theme.getByText('Dunkel', { exact: true }).click()
    await ctx.page.waitForFunction(() => document.documentElement.classList.contains('dark'), undefined, POLL)
    expect((await invoke(ctx.page, 'app.getSettings')).theme).toBe('dark')
    await expect(theme.getByRole('radio', { name: 'Dunkel' })).toHaveAttribute('data-state', 'checked')

    // per Tastatur: Pfeiltaste nach links → Hell (Radix wählt beim Fokuswechsel, solange die Taste gedrückt ist)
    await theme.getByRole('radio', { name: 'Dunkel' }).focus()
    await ctx.page.keyboard.down('ArrowLeft')
    await expect(theme.getByRole('radio', { name: 'Hell' })).toBeFocused()
    await ctx.page.keyboard.up('ArrowLeft')
    await ctx.page.waitForFunction(() => !document.documentElement.classList.contains('dark'), undefined, POLL)
    expect((await invoke(ctx.page, 'app.getSettings')).theme).toBe('light')

    await theme.getByText('System', { exact: true }).click()
    await expect.poll(async () => (await invoke(ctx.page, 'app.getSettings')).theme).toBe('system')
    await applyTheme(ctx, 'light')
  })

  test('Datensicherung erstellen (Button und Menü) → ZIP existiert', async () => {
    const settings = await invoke(ctx.page, 'app.getSettings')
    const backupDir = join(settings.documentsDir!, 'Datensicherungen')

    await ctx.page.getByTestId('settings-backup-create').click()
    const result = ctx.page.getByTestId('settings-backup-result')
    await expect(result).toBeVisible()
    await expect(result).toContainText(/^Festbuero-Datensicherung-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}(-\d+)?\.zip/)
    await expect(ctx.page.locator('[data-sonner-toast]').filter({ hasText: 'Datensicherung erstellt.' })).toBeVisible()
    await screenshot(ctx.page, 'setup-settings-backup-laptop')

    const zips = readdirSync(backupDir).filter((f) => f.endsWith('.zip'))
    expect(zips).toHaveLength(1)
    expect(statSync(join(backupDir, zips[0]!)).size).toBeGreaterThan(1000)

    // Menü „Ablage → Datensicherung erstellen …“
    await ctx.app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('app.backup')?.click())
    await expect.poll(() => readdirSync(backupDir).filter((f) => f.endsWith('.zip')).length).toBe(2)
    await dismissToasts(ctx.page)
  })

  test('Beispiel-Fest anlegen', async () => {
    await ctx.page.getByTestId('settings-sample-festival').click()
    await expect(
      ctx.page.locator('[data-sonner-toast]').filter({ hasText: '„Beispiel-Gründungsfest“ angelegt.' })
    ).toBeVisible()
    const festivals = await invoke(ctx.page, 'festivals.list')
    expect(festivals.map((f) => f.name).sort()).toEqual(['Beispiel-Gründungsfest', 'Testfest 2025'])
    // aktives Fest bleibt unverändert
    const active = festivals.find((f) => f.name === 'Testfest 2025')!
    expect((await invoke(ctx.page, 'app.getSettings')).lastFestivalId).toBe(active.id)
    await dismissToasts(ctx.page)
  })

  test('Testseite drucken (Button und Menü)', async () => {
    // prepareFestival() setzt den simulierten „E2E-Testdrucker“
    expect((await invoke(ctx.page, 'app.getSettings')).defaultPrinter).toBe(E2E_TEST_PRINTER)
    await expect(ctx.page.getByTestId('settings-printer-select')).toContainText(E2E_TEST_PRINTER)
    const success = ctx.page
      .locator('[data-sonner-toast]')
      .filter({ hasText: `Testseite für „${E2E_TEST_PRINTER}“ simuliert` })
    await ctx.page.getByTestId('settings-test-page').click()
    await expect(success).toBeVisible()
    await dismissToasts(ctx.page)

    await ctx.app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('printing.testPage')?.click())
    await expect(success).toBeVisible()
    await dismissToasts(ctx.page)
  })

  test('Drucker über die Auswahl wechseln', async () => {
    const printers = await invoke(ctx.page, 'printing.listPrinters')
    const other = printers.find((p) => p.name !== E2E_TEST_PRINTER)
    test.skip(!other, 'nur der simulierte Drucker vorhanden')
    await ctx.page.getByTestId('settings-printer-select').click()
    await ctx.page.getByRole('option', { name: other!.displayName }).click()
    await expect.poll(async () => (await invoke(ctx.page, 'app.getSettings')).defaultPrinter).toBe(other!.name)
    await invoke(ctx.page, 'app.updateSettings', { defaultPrinter: E2E_TEST_PRINTER })
    await dismissToasts(ctx.page)
  })

  test('Einrichtungsassistent erneut öffnen und schließen', async () => {
    await ctx.page.getByTestId('settings-open-setup').click()
    await expect.poll(() => hash(ctx.page)).toBe('#/setup')
    await expect(ctx.page.getByTestId('setup-close')).toBeVisible()
    await ctx.page.getByTestId('setup-next').click()
    // gespeicherter Ordner ist vorbelegt
    const settings = await invoke(ctx.page, 'app.getSettings')
    await expect(ctx.page.getByTestId('setup-documents-dir')).toHaveText(settings.documentsDir!)
    await ctx.page.getByTestId('setup-close').click()
    await expect.poll(() => hash(ctx.page)).toBe('#/einstellungen')
  })

  test('ohne Fest: Hinweis statt Testseite', async () => {
    const fresh = await launchApp({ viewport: 'min' })
    try {
      await invoke(fresh.page, 'app.updateSettings', { setupCompleted: true, documentsDir: fresh.documentsDir })
      await gotoRoute(fresh.page, '/einstellungen', { reload: true })
      await expect(fresh.page.getByTestId('settings-test-page')).toBeDisabled()
      await expect(fresh.page.getByTestId('settings-printer')).toContainText('Für die Testseite wird ein Gründungsfest benötigt')
      await expectNoHorizontalOverflow(fresh.page)
    } finally {
      await closeApp(fresh)
    }
  })
})
