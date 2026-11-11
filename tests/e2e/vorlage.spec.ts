/**
 * E2E: Vorlagen-Editor (/fest/vorlage) und Rechnungsvorschau.
 *
 * - Block bearbeiten, Feld einfügen, freien Hinweis hinzufügen/verschieben, Fußzeile 3 Spalten,
 *   Logo setzen (Dialog gestubbt), Schrift wechseln, automatisches Speichern, Zurücksetzen.
 * - Alle vier Fenstergrößen hell/dunkel (kein horizontaler Overflow, Screenshots `vorlage-…`).
 * - 40 Positionen → 2 Seiten (Vorschau + echtes PDF aus demselben HTML), Beispielrechnung als PDF.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import {
  closeApp,
  countCrashReports,
  expectNoHorizontalOverflow,
  gotoRoute,
  invoke,
  launchApp,
  POLL,
  prepareFestival,
  PROJECT_ROOT,
  screenshot,
  setTheme,
  setWindowSize,
  stubDialogs,
  VIEWPORTS,
  type AppContext,
  type ViewportName
} from './helpers'

const SAMPLE_LOGO = join(PROJECT_ROOT, 'resources', 'sample', 'beispiel-logo.svg')
const RESULTS_DIR = join(PROJECT_ROOT, 'test-results')

const ACTIVE_FRAME = '[data-testid="invoice-preview"] iframe[title="Rechnungsvorschau"]'

async function waitForPreview(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="invoice-preview"]')
      return el !== null && el.getAttribute('data-rendered') === 'true'
    },
    undefined,
    { ...POLL, timeout: 15_000 }
  )
}

/** Sichtbarer Text des aktuell angezeigten Rechnungsdokuments */
async function previewText(page: Page): Promise<string> {
  await waitForPreview(page)
  return page.frameLocator(ACTIVE_FRAME).locator('#fb-doc').innerText()
}

function blockButton(page: Page, name: RegExp) {
  return page.getByTestId('vorlage-block-list').getByRole('button', { name })
}

async function waitSaved(page: Page): Promise<void> {
  await expect(page.getByTestId('vorlage-save-status')).toHaveAttribute('data-status', 'saved', { timeout: 10_000 })
}

/** Druckt HTML in einem versteckten Fenster des Main-Prozesses zu PDF (wie services/pdf.ts). */
async function printHtmlToPdf(app: ElectronApplication, html: string): Promise<Buffer> {
  const b64 = await app.evaluate(async ({ BrowserWindow }, source) => {
    const win = new BrowserWindow({
      show: false,
      width: 794,
      height: 1123,
      webPreferences: { sandbox: true, backgroundThrottling: false }
    })
    try {
      await win.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(source, 'utf8').toString('base64')}`)
      for (let i = 0; i < 300; i++) {
        if (await win.webContents.executeJavaScript('window.__FESTBUERO_RENDER_DONE__ === true')) break
        await new Promise((r) => setTimeout(r, 50))
      }
      const pdf = await win.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        preferCSSPageSize: true
      })
      return pdf.toString('base64')
    } finally {
      win.destroy()
    }
  }, html)
  return Buffer.from(b64, 'base64')
}

function pdfPageCount(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length
}

async function activeSrcDoc(page: Page): Promise<string> {
  await waitForPreview(page)
  const html = await page.locator(ACTIVE_FRAME).getAttribute('srcdoc')
  expect(html).toBeTruthy()
  return html!
}

const crashesBefore = countCrashReports()

test.describe.serial('Vorlage: Editor', () => {
  let ctx: AppContext
  let festivalId: number

  test.beforeAll(async () => {
    ctx = await launchApp({ viewport: 'laptop' })
    festivalId = (await prepareFestival(ctx.page)).id
    await gotoRoute(ctx.page, '/fest/vorlage')
    await expect(ctx.page.getByTestId('vorlage-page')).toBeVisible()
  })

  test.afterAll(async () => {
    if (ctx) await closeApp(ctx)
  })

  test('Live-Vorschau zeigt Beispieldaten mit Fest-Einstellungen', async () => {
    const { page } = ctx
    await expect(page.getByTestId('vorlage-preview-pane')).toBeVisible()
    const text = await previewText(page)
    expect(text).toContain('Rechnung Nr. 2025-001')
    expect(text).toContain('Leistungen im Rahmen von „Testfest 2025“.')
    expect(text).toContain('Als Kleinunternehmer im Sinne von § 19 UStG')
    expect(text).toContain('670,20')
    expect(text).toContain('Betrag bar erhalten')

    // Umschalter Storno / Überweisung
    await page.getByRole('radiogroup', { name: 'Beleg in der Vorschau' }).getByRole('radio', { name: 'Storno' }).click()
    await expect.poll(() => previewText(page)).toContain('Stornorechnung Nr. 2025-002 zu Rechnung Nr. 2025-001')
    expect(await previewText(page)).not.toContain('Betrag bar erhalten')
    await page.getByRole('radiogroup', { name: 'Beleg in der Vorschau' }).getByRole('radio', { name: 'Rechnung' }).click()
    await page.getByRole('radiogroup', { name: 'Zahlungsart in der Vorschau' }).getByRole('radio', { name: 'Überweisung' }).click()
    await expect.poll(() => previewText(page)).toContain('Bitte überweisen Sie den Betrag von 670,20')
    await page.getByRole('radiogroup', { name: 'Zahlungsart in der Vorschau' }).getByRole('radio', { name: 'Bar' }).click()
  })

  test('Block bearbeiten und Feld einfügen', async () => {
    const { page } = ctx
    await blockButton(page, /^Betreff/).click()
    const editor = page.getByRole('textbox', { name: 'Betreff', exact: true })
    await editor.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' – Testtext ')
    await expect.poll(() => previewText(page)).toContain('Rechnung Nr. 2025-001 – Testtext')

    await page.getByTestId('vorlage-block-editor').getByRole('button', { name: 'Feld einfügen' }).click()
    await page.getByRole('menuitem', { name: /^Festname/ }).click()
    await expect(editor.locator('[data-placeholder="Festname"]')).toHaveText('Festname')
    await expect.poll(() => previewText(page)).toContain('Rechnung Nr. 2025-001 – Testtext Testfest 2025')

    await waitSaved(page)
    const saved = await invoke(page, 'templates.get', festivalId)
    expect(saved.config.subject.html).toContain('Testtext')
    expect(saved.config.subject.html).toContain('<span data-placeholder="Festname">{Festname}</span>')
  })

  test('freien Hinweis hinzufügen und verschieben', async () => {
    const { page } = ctx
    await blockButton(page, /^Hinweise/).click()
    await page.getByRole('button', { name: 'Hinweis hinzufügen' }).click()
    const editor = page.getByRole('textbox', { name: 'Hinweis 3', exact: true })
    await editor.click()
    await page.keyboard.type('Mein neuer Hinweis')
    await expect.poll(() => previewText(page)).toContain('Mein neuer Hinweis')
    let text = await previewText(page)
    expect(text.indexOf('Mein neuer Hinweis')).toBeGreaterThan(text.indexOf('durchlaufenden Posten'))

    await page.getByRole('button', { name: 'Hinweis 3 nach oben' }).click()
    await page.getByRole('button', { name: 'Hinweis 2 nach oben' }).click()
    await expect(page.getByRole('textbox', { name: 'Hinweis 1', exact: true })).toContainText('Mein neuer Hinweis')
    await expect
      .poll(async () => {
        const t = await previewText(page)
        return t.indexOf('Mein neuer Hinweis') < t.indexOf('durchlaufenden Posten')
      })
      .toBe(true)
    text = await previewText(page)
    // Steuerhinweis bleibt automatisch der erste Hinweis
    expect(text.indexOf('Kleinunternehmer')).toBeLessThan(text.indexOf('Mein neuer Hinweis'))
    await waitSaved(page)
    const saved = await invoke(page, 'templates.get', festivalId)
    expect(saved.config.slots.notes).toHaveLength(3)
    expect(saved.config.slots.notes[0]!.html).toContain('Mein neuer Hinweis')
  })

  test('Fußzeile auf 3 Spalten', async () => {
    const { page } = ctx
    await blockButton(page, /^Fußzeile/).click()
    await page.getByRole('radiogroup', { name: 'Anzahl Spalten der Fußzeile' }).getByRole('radio', { name: '3' }).click()
    await page.getByRole('textbox', { name: 'Fußzeile Spalte 2' }).click()
    await page.keyboard.type('Spalte Zwei')
    await page.getByRole('textbox', { name: 'Fußzeile Spalte 3' }).click()
    await page.keyboard.type('Spalte Drei')
    await expect.poll(() => previewText(page)).toContain('Spalte Drei')
    // Fußzeile jeder Seite hat 3 Spalten
    const firstPage = page.frameLocator(ACTIVE_FRAME).locator('section.page').first()
    await expect(firstPage.locator('.page-footer .footer-col')).toHaveCount(3)
    await waitSaved(page)
    expect((await invoke(page, 'templates.get', festivalId)).config.footer.columns).toHaveLength(3)
  })

  test('Logo setzen und Schrift wechseln', async () => {
    const { page, app } = ctx
    await blockButton(page, /^Allgemein/).click()
    await stubDialogs(app, { open: [SAMPLE_LOGO] })
    await page.getByRole('button', { name: 'Logo hochladen …' }).click()
    await expect(page.getByText('Logo übernommen.')).toBeVisible()
    await expect(page.getByTestId('vorlage-logo-preview').locator('img')).toBeVisible()
    await waitForPreview(page)
    await expect(page.frameLocator(ACTIVE_FRAME).locator('.logo.pos-right img')).toHaveCount(1)
    const withLogo = await invoke(page, 'templates.get', festivalId)
    expect(withLogo.logoFile).toMatch(/^[a-f0-9]{64}\.svg$/)

    // Logo-Position links
    await page.getByRole('radiogroup', { name: 'Logo-Position' }).getByRole('radio', { name: 'Links' }).click()
    await waitForPreview(page)
    await expect(page.frameLocator(ACTIVE_FRAME).locator('.logo.pos-left img')).toHaveCount(1)
    await page.getByRole('radiogroup', { name: 'Logo-Position' }).getByRole('radio', { name: 'Rechts' }).click()

    // Schrift wechseln
    await page.getByRole('combobox', { name: 'Schriftart' }).click()
    await page.getByRole('option', { name: 'Tinos (wie Times New Roman)' }).click()
    await expect
      .poll(async () => {
        await waitForPreview(page)
        return page.frameLocator(ACTIVE_FRAME).locator('body').evaluate((el) => getComputedStyle(el).fontFamily)
      })
      .toContain('FB Tinos')
    await waitSaved(page)
    expect((await invoke(page, 'templates.get', festivalId)).config.fontFamily).toBe('tinos')
    await screenshot(page, 'vorlage-editor-bearbeitet-laptop', { hideToasts: true })
  })

  test('Auf Standard zurücksetzen (mit Bestätigung, Logo bleibt)', async () => {
    const { page } = ctx
    await page.getByRole('button', { name: 'Auf Standard zurücksetzen' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('Vorlage zurücksetzen?')
    await dialog.getByRole('button', { name: 'Zurücksetzen' }).click()
    await expect(page.getByText('Vorlage auf Standard zurückgesetzt.')).toBeVisible()
    const t = await invoke(page, 'templates.get', festivalId)
    expect(t.config.fontFamily).toBe('arimo')
    expect(t.config.footer.columns).toHaveLength(1)
    expect(t.logoFile).toMatch(/\.svg$/)
    await expect.poll(() => previewText(page)).not.toContain('Testtext')
    // gespeicherte Platzhalter-Spans werden beim Laden wieder als Baustein (Chip) erkannt
    await blockButton(page, /^Betreff/).click()
    const chip = page.getByRole('textbox', { name: 'Betreff', exact: true }).locator('.rt-chip[data-placeholder="Rechnungsnummer"]')
    await expect(chip).toHaveText('Rechnungsnummer')
    await expect(chip).toHaveAttribute('contenteditable', 'false')
  })
})

test.describe.serial('Vorlage: responsiv, Dunkelmodus, Seitenumbruch, PDF', () => {
  let ctx: AppContext
  let festivalId: number

  test.beforeAll(async () => {
    ctx = await launchApp({ viewport: 'laptop' })
    festivalId = (await prepareFestival(ctx.page)).id
    await invoke(ctx.page, 'templates.setLogo', festivalId, SAMPLE_LOGO)
    await gotoRoute(ctx.page, '/fest/vorlage', { reload: true })
    await expect(ctx.page.getByTestId('vorlage-page')).toBeVisible()
    await blockButton(ctx.page, /^Hinweise/).click()
  })

  test.afterAll(async () => {
    if (ctx) await closeApp(ctx)
  })

  for (const theme of ['light', 'dark'] as const) {
    test(`alle Fenstergrößen (${theme === 'dark' ? 'dunkel' : 'hell'})`, async () => {
      const { page, app } = ctx
      if (theme === 'dark') await setTheme(page, 'dark')
      const suffix = theme === 'dark' ? '-dark' : ''
      for (const name of Object.keys(VIEWPORTS) as ViewportName[]) {
        const [w, h] = VIEWPORTS[name]
        await setWindowSize(app, w, h, page)
        await expect(page.getByTestId('vorlage-block-editor')).toBeVisible()
        await expectNoHorizontalOverflow(page)
        await screenshot(page, `vorlage-editor-${name}${suffix}`, { hideToasts: true })

        const width = VIEWPORTS[name][0]
        if (width < 1280) {
          // Vorschau als Sheet
          await expect(page.getByTestId('vorlage-preview-pane')).toHaveCount(0)
          await page.getByTestId('vorlage-preview-toggle').click()
          await expect(page.getByTestId('vorlage-preview-sheet')).toBeVisible()
          await waitForPreview(page)
          await expectNoHorizontalOverflow(page)
          await screenshot(page, `vorlage-vorschau-${name}${suffix}`, { hideToasts: true })
          await page.keyboard.press('Escape')
          await expect(page.getByTestId('vorlage-preview-sheet')).toHaveCount(0)
        } else {
          await expect(page.getByTestId('vorlage-preview-pane')).toBeVisible()
        }
        if (width < 1024) {
          await expect(page.getByRole('combobox', { name: 'Block auswählen' })).toBeVisible()
        } else {
          await expect(page.getByTestId('vorlage-block-list')).toBeVisible()
        }
      }
      if (theme === 'dark') await setTheme(page, 'light')
    })
  }

  test('Rechnung mit 40 Positionen: 2 Seiten in Vorschau und PDF', async () => {
    const { page, app } = ctx
    await setWindowSize(app, ...VIEWPORTS.large, page)
    await page.getByRole('button', { name: '40 Positionen' }).click()
    await expect(page.getByTestId('invoice-preview')).toHaveAttribute('data-pages', '2', { timeout: 15_000 })
    await waitForPreview(page)
    const frame = page.frameLocator(ACTIVE_FRAME)
    await expect(frame.locator('section.page')).toHaveCount(2)
    await expect(frame.locator('table.items thead')).toHaveCount(2) // Kopfzeile wiederholt
    await expect(frame.locator('.page-footer')).toHaveCount(2) // Fußzeile auf jeder Seite
    await expect(frame.locator('.page-number').first()).toHaveText('Seite 1 von 2')
    await expect(frame.locator('.page-number').last()).toHaveText('Seite 2 von 2')
    await screenshot(page, 'vorlage-40-positionen-large')
    await page.getByTestId('vorlage-preview-pane').locator('.overflow-y-auto').evaluate((el) => el.scrollTo(0, el.scrollHeight))
    await screenshot(page, 'vorlage-40-positionen-seite2-large')

    mkdirSync(RESULTS_DIR, { recursive: true })
    const pdf = await printHtmlToPdf(app, await activeSrcDoc(page))
    writeFileSync(join(RESULTS_DIR, 'vorlage-40-positionen.pdf'), pdf)
    expect(pdfPageCount(pdf)).toBe(2)

    // Beispielrechnung (8 Positionen, 670,20 €) als PDF für den Abgleich mit der Vorlage
    await page.getByRole('button', { name: '40 Positionen' }).click()
    await expect(page.getByTestId('invoice-preview')).toHaveAttribute('data-pages', '1', { timeout: 15_000 })
    const sample = await printHtmlToPdf(app, await activeSrcDoc(page))
    writeFileSync(join(RESULTS_DIR, 'vorlage-beispiel.pdf'), sample)
    expect(pdfPageCount(sample)).toBe(1)
    await page.getByTestId('vorlage-preview-pane').locator('.overflow-y-auto').evaluate((el) => el.scrollTo(0, 0))
    await screenshot(page, 'vorlage-beispiel-large')
  })
})

test('Vorlage: keine neuen Absturzberichte', async () => {
  await new Promise((r) => setTimeout(r, 3000))
  expect(countCrashReports()).toBe(crashesBefore)
})
