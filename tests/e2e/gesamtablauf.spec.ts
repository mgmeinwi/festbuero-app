/**
 * E2E: Gesamtablauf über alle Bereiche wie im echten Festbetrieb (Integrationstest).
 *
 * Frische App → Einrichtungsassistent (Ordner, E2E-Testdrucker, Fest „2025-“, Start 81, 3 Stellen) →
 * Produkte der Beispielrechnung über die Oberfläche → Vereine per Excel-Import → Maske: Verein,
 * Personen, Mengen 0/0/45/18/0/13/1/34 = 670,20 €, Abschluss per ⌘↩ (Menü) → 2025-081 (PDF + Dry-Run-Druck,
 * 2 Kopien) → Einzelrechnung per Überweisung (2025-082) → Rechnungsliste: Storno 2025-081 (→ 2025-083),
 * „Stornieren und neu erstellen“ an 2025-082 (→ Storno 2025-084, Maske vorbelegt, Korrektur 2025-085) →
 * Auswertung mit Storno-Gegenrechnung + Excel-Export → Datensicherung.
 *
 * Alle Daten sind erfunden (tests/fixtures/vereine-beispiel.xlsx); gedruckt wird nur simuliert.
 *
 *   FESTBUERO_OUT_DIR=out/integration npm run test:e2e -- tests/e2e/gesamtablauf.spec.ts
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  closeApp,
  countCrashReports,
  E2E_TEST_PRINTER,
  gotoRoute,
  invoke,
  launchApp,
  POLL,
  PROJECT_ROOT,
  screenshot,
  stubDialogs,
  type AppContext
} from './helpers'

const FEST = 'Gründungsfest Musterdorf 2025'
const VEREINE_XLSX = join(PROJECT_ROOT, 'tests', 'fixtures', 'vereine-beispiel.xlsx')

/** Produkte, Preise und Mengen der Beispielrechnung (laut CLAUDE.md übernehmbar). */
const PRODUCTS: Array<{ name: string; price: string; vat: 7 | 19; fixed?: number }> = [
  { name: '1 Maß Bier (ohne Bedienung)', price: '9,70', vat: 19 },
  { name: 'Brotzeit', price: '8,00', vat: 7 },
  { name: 'Festzeichen', price: '3,00', vat: 19 },
  { name: 'Festessen', price: '14,50', vat: 7 },
  { name: 'Korsoeinsatz', price: '2,00', vat: 19 },
  { name: 'Käsespätzle', price: '10,00', vat: 7 },
  { name: 'Festschrift', price: '15,00', vat: 7, fixed: 1 },
  { name: 'Alkoholfreies Getränk (0,5l)', price: '3,80', vat: 19 }
]
const EXAMPLE_QUANTITIES = [0, 0, 45, 18, 0, 13, 1, 34]

/** Betrag mit beliebigem Leerzeichen (formatEuro nutzt ein geschütztes Leerzeichen). */
function euro(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.]/g, '\\.')}\\s€$`)
}

function toast(page: Page, text: string | RegExp): Locator {
  return page.locator('[data-sonner-toast]').filter({ hasText: text })
}

function quantity(page: Page, productName: string): Locator {
  return page.getByLabel(`Menge ${productName}`, { exact: true })
}

function invoiceRow(page: Page, number: string): Locator {
  return page.locator(`[data-testid="invoice-row"][data-number="${number}"]`)
}

async function hash(page: Page): Promise<string> {
  return page.evaluate(() => window.location.hash)
}

async function menuItemEnabled(ctx: AppContext, id: string): Promise<boolean | null> {
  return ctx.app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu()?.getMenuItemById(itemId)?.enabled ?? null, id)
}

/** Menüeintrag wie in der Menüleiste auslösen (wartet, bis er aktiv ist). */
async function clickMenuItem(ctx: AppContext, id: string): Promise<void> {
  await expect.poll(() => menuItemEnabled(ctx, id), { message: `Menüeintrag ${id} aktiv` }).toBe(true)
  await ctx.app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu()?.getMenuItemById(itemId)?.click(), id)
}

interface DryRunEntry {
  file: string
  printer: string
  copies: number
  ok: boolean
}

function dryRunLog(ctx: AppContext): DryRunEntry[] {
  const path = join(ctx.userDataDir, 'print-dry-run.log')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as DryRunEntry)
}

/** Erfolgsdialog der Maske: Nummer prüfen, „Neue Rechnung“ → zurück ins Suchfeld. */
async function expectFinalized(page: Page, number: string, total: RegExp): Promise<void> {
  const dialog = page.getByTestId('success-dialog')
  await expect(dialog).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('success-number')).toContainText(number)
  await expect(page.getByTestId('success-total')).toHaveText(total)
  await expect(page.getByTestId('print-status')).toContainText('Druck simuliert')
  await page.getByTestId('new-invoice').click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('club-search')).toBeFocused()
}

let crashesBefore = 0
test.beforeAll(() => {
  crashesBefore = countCrashReports()
})
test.afterAll(async () => {
  await new Promise((r) => setTimeout(r, 2000))
  expect(countCrashReports(), 'keine neuen Absturzberichte').toBe(crashesBefore)
})

test('Gesamtablauf: Einrichtung → Produkte → Import → Rechnungen → Storno → Auswertung → Datensicherung', async () => {
  test.setTimeout(240_000)
  const ctx = await launchApp({ viewport: 'laptop' })
  const { app, page } = ctx
  const docs = join(ctx.documentsDir, 'Festbüro')
  try {
    /* ---------- 1. Einrichtungsassistent ---------- */
    await expect.poll(() => hash(page)).toBe('#/setup')
    await expect(page.getByRole('heading', { name: 'Willkommen im Festbüro' })).toBeVisible()
    await page.getByTestId('setup-next').click()

    await expect(page.getByTestId('setup-step-documents')).toBeVisible()
    await stubDialogs(app, { open: [docs] })
    await page.getByRole('button', { name: 'Anderen Ordner wählen …' }).click()
    await expect(page.getByTestId('setup-documents-dir')).toHaveText(docs)
    await page.getByTestId('setup-next').click()

    await expect(page.getByTestId('setup-step-printer')).toBeVisible()
    await page.getByRole('radio', { name: E2E_TEST_PRINTER }).click()
    await page.getByTestId('setup-next').click()

    await expect(page.getByTestId('setup-step-festival')).toBeVisible()
    await page.getByLabel('Name des Fests').fill(FEST)
    await page.getByLabel('Festdatum').fill('2025-06-01')
    await page.getByLabel('Präfix').fill('2025-')
    await page.getByLabel('Startnummer').fill('81')
    await page.getByLabel('Stellenzahl').fill('3')
    await expect(page.getByTestId('setup-step-festival')).toContainText('2025-081')
    await page.getByTestId('setup-next').click()

    await expect(page.getByTestId('setup-step-done')).toBeVisible()
    await expect(page.getByTestId('setup-summary')).toContainText(FEST)
    await page.getByTestId('setup-finish').click()
    await expect.poll(() => hash(page)).toBe('#/festbuero')
    await expect(page.getByTestId('app-header')).toBeVisible()

    const settings = await invoke(page, 'app.getSettings')
    expect(settings).toMatchObject({ documentsDir: docs, defaultPrinter: E2E_TEST_PRINTER, setupCompleted: true })
    const festivals = await invoke(page, 'festivals.list')
    expect(festivals).toHaveLength(1)
    const festival = festivals[0]!
    expect(festival).toMatchObject({ name: FEST, numberPrefix: '2025-', numberStart: 81, numberDigits: 3, copies: 2 })

    /* ---------- 2. Produkte über die Oberfläche ---------- */
    await gotoRoute(page, '/fest/produkte')
    await expect(page.getByTestId('products-empty')).toBeVisible()
    const productDialog = page.getByRole('dialog')
    for (const p of PRODUCTS) {
      await page.getByRole('button', { name: 'Neues Produkt' }).click()
      await expect(productDialog.getByLabel('Bezeichnung', { exact: true })).toBeFocused()
      await productDialog.getByLabel('Bezeichnung', { exact: true }).fill(p.name)
      await productDialog.getByLabel('Bruttopreis', { exact: true }).fill(p.price)
      await productDialog.getByRole('radio', { name: `${p.vat} %` }).click()
      if (p.fixed !== undefined) {
        await productDialog.getByRole('radio', { name: /feste Anzahl/ }).click()
        await productDialog.getByLabel('Standardanzahl', { exact: true }).fill(String(p.fixed))
      }
      await productDialog.getByRole('button', { name: 'Produkt anlegen' }).click()
      await expect(productDialog).toBeHidden()
    }
    const products = await invoke(page, 'products.list', festival.id)
    expect(products.map((p) => [p.name, p.priceCents, p.vatRate, p.mode])).toEqual(
      PRODUCTS.map((p) => [p.name, Math.round(Number(p.price.replace(',', '.')) * 100), p.vat, p.fixed ? 'feste_anzahl' : 'pro_person'])
    )
    await screenshot(page, 'gesamtablauf-produkte-laptop', { hideToasts: true })

    /* ---------- 3. Vereine per Excel-Import ---------- */
    await gotoRoute(page, '/fest/vereine')
    await stubDialogs(app, { open: [VEREINE_XLSX] })
    await clickMenuItem(ctx, 'clubs.import')
    const importDialog = page.getByRole('dialog', { name: 'Vereine importieren' })
    await expect(importDialog).toBeVisible()
    await expect(importDialog.getByTestId('club-import-submit')).toHaveText('15 Vereine importieren')
    await importDialog.getByTestId('club-import-submit').click()
    await expect(toast(page, '15 Vereine importiert')).toBeVisible()
    await expect(importDialog).toHaveCount(0)
    expect(await invoke(page, 'clubs.list', festival.id)).toHaveLength(15)

    /* ---------- 4. Maske: Verein, Personen, Mengen, ⌘↩ ---------- */
    await gotoRoute(page, '/festbuero')
    await expect(page.getByTestId('festbuero-mask')).toBeVisible()
    await expect(page.getByTestId('next-number')).toHaveText('Nr. 2025-081')
    const search = page.getByTestId('club-search')
    await search.click()
    await page.keyboard.type('Musterdorf')
    await expect(page.getByRole('option').first()).toContainText('FF Musterdorf')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('customer-card')).toContainText('FF Musterdorf')
    const persons = page.getByTestId('persons-input')
    await expect(persons).toHaveValue('45')
    await expect(page.getByTestId('persons-registered')).toHaveText('angemeldet: 45')
    await page.keyboard.press('Enter') // Personen übernehmen → Positionen
    for (const [i, q] of EXAMPLE_QUANTITIES.entries()) {
      await quantity(page, PRODUCTS[i]!.name).fill(String(q))
    }
    await expect(page.getByTestId('grand-total')).toHaveText(euro('670,20'))
    await expect(page.getByTestId('preview-column').getByTestId('invoice-preview')).toHaveAttribute('data-pages', '1')
    await screenshot(page, 'gesamtablauf-maske-laptop', { hideToasts: true })

    await clickMenuItem(ctx, 'invoice.finalize') // ⌘↩
    await expectFinalized(page, '2025-081', euro('670,20'))
    const pdf081 = join(docs, FEST, 'Rechnungen', '2025-081.pdf')
    await expect.poll(() => existsSync(pdf081)).toBe(true)
    const print081 = dryRunLog(ctx).filter((e) => e.file === pdf081)
    expect(print081).toHaveLength(1)
    expect(print081[0]).toMatchObject({ printer: E2E_TEST_PRINTER, copies: 2, ok: true })

    /* ---------- 5. Einzelrechnung per Überweisung ---------- */
    await page.getByTestId('einzel-button').click()
    await expect(page.getByTestId('customer-card')).toContainText('Einzelrechnung')
    await expect(page.getByTestId('step-personen')).toHaveCount(0)
    await quantity(page, 'Festessen').fill('2')
    await quantity(page, 'Festschrift').fill('1')
    await page.getByTestId('payment-kind').getByRole('radio', { name: 'Überweisung' }).click()
    await expect(page.getByTestId('payment-kind').getByRole('radio', { name: 'Überweisung' })).toBeChecked()
    await expect(page.getByTestId('grand-total')).toHaveText(euro('44,00'))
    await page.getByTestId('finalize-button').click()
    await expectFinalized(page, '2025-082', euro('44,00'))
    expect(existsSync(join(docs, FEST, 'Rechnungen', '2025-082.pdf'))).toBe(true)

    /* ---------- 6. Rechnungsliste: Storno und „Stornieren und neu erstellen“ ---------- */
    await gotoRoute(page, '/rechnungen')
    await expect(page.getByTestId('invoice-row')).toHaveCount(2)
    await invoiceRow(page, '2025-081').getByRole('button', { name: 'Aktionen für 2025-081' }).click()
    await page.getByRole('menuitem', { name: 'Stornieren …' }).click()
    const stornoDialog = page.getByTestId('storno-dialog')
    await expect(stornoDialog).toContainText('Rechnung 2025-081 stornieren')
    await stornoDialog.getByLabel(/Grund/).fill('Personenzahl falsch erfasst')
    await stornoDialog.getByRole('button', { name: 'Stornieren', exact: true }).click()
    await expect(stornoDialog).toBeHidden()
    await expect(toast(page, 'Storno 2025-083 zu Rechnung 2025-081 erstellt')).toBeVisible()
    await expect(invoiceRow(page, '2025-081')).toContainText('storniert')
    await expect(invoiceRow(page, '2025-083')).toContainText('Storno')
    await expect(invoiceRow(page, '2025-083')).toContainText(/-670,20\s€/)
    const pdf083 = join(docs, FEST, 'Stornos', '2025-083.pdf')
    await expect.poll(() => existsSync(pdf083)).toBe(true)
    expect(dryRunLog(ctx).find((e) => e.file === pdf083)).toMatchObject({ copies: 2, ok: true })

    await invoiceRow(page, '2025-082').getByRole('button', { name: 'Aktionen für 2025-082' }).click()
    await page.getByRole('menuitem', { name: 'Stornieren …' }).click()
    await expect(stornoDialog).toContainText('Rechnung 2025-082 stornieren')
    await stornoDialog.getByLabel(/Grund/).fill('Menge korrigieren')
    await stornoDialog.getByRole('button', { name: 'Stornieren und neu erstellen' }).click()
    await page.waitForFunction(() => window.location.hash === '#/festbuero', undefined, POLL)
    await expect(page.getByTestId('correction-banner')).toContainText('Korrektur von Rechnung Nr. 2025-082')
    await expect(page.getByTestId('customer-card')).toContainText('Einzelrechnung')
    await expect(page.getByTestId('payment-kind').getByRole('radio', { name: 'Überweisung' })).toBeChecked()
    await expect(quantity(page, 'Festessen')).toHaveValue('2')
    await expect(quantity(page, 'Festschrift')).toHaveValue('1')
    await expect(page.getByTestId('grand-total')).toHaveText(euro('44,00'))
    expect(existsSync(join(docs, FEST, 'Stornos', '2025-084.pdf'))).toBe(true)

    // Korrektur abschließen
    await quantity(page, 'Festessen').fill('3')
    await expect(page.getByTestId('grand-total')).toHaveText(euro('58,50'))
    await page.getByTestId('finalize-button').click()
    await expectFinalized(page, '2025-085', euro('58,50'))

    const list = await invoke(page, 'invoices.list', festival.id)
    expect(list.map((i) => [i.number, i.type, i.status, i.totalGrossCents]).sort()).toEqual([
      ['2025-081', 'rechnung', 'storniert', 67020],
      ['2025-082', 'rechnung', 'storniert', 4400],
      ['2025-083', 'storno', 'abgeschlossen', -67020],
      ['2025-084', 'storno', 'abgeschlossen', -4400],
      ['2025-085', 'rechnung', 'abgeschlossen', 5850]
    ])

    /* ---------- 7. Auswertung mit Storno-Gegenrechnung, Excel-Export ---------- */
    await gotoRoute(page, '/auswertung')
    const kpi = (id: string) => page.getByTestId(id).locator('[data-value]')
    await expect(kpi('kpi-invoices')).toHaveText('3')
    await expect(kpi('kpi-stornos')).toHaveText('2')
    await expect(kpi('kpi-total')).toHaveText(euro('58,50'))
    await expect(kpi('kpi-cash')).toHaveText(euro('0,00'))
    await expect(kpi('kpi-transfer')).toHaveText(euro('58,50'))
    await expect(kpi('kpi-persons')).toHaveText('0')
    const festessen = page.getByTestId('product-row').filter({ hasText: 'Festessen' })
    await expect(festessen).toContainText('3')
    await expect(festessen).toContainText(/43,50\s€/)
    await expect(page.getByTestId('product-row').filter({ hasText: 'Festzeichen' })).toContainText(/0,00\s€/)
    // FF Musterdorf hat nur eine stornierte Rechnung → gilt als „ohne Rechnung“
    await expect(page.getByTestId('clubs-without-count')).toHaveText('15')
    await expect(page.getByTestId('club-without-invoice').filter({ hasText: 'FF Musterdorf' })).toHaveCount(1)
    await screenshot(page, 'gesamtablauf-auswertung-laptop', { hideToasts: true })

    const xlsx = join(ctx.userDataDir, 'auswertung-gesamtablauf.xlsx')
    await stubDialogs(app, { save: xlsx })
    await page.getByTestId('evaluation-export').click()
    await expect(toast(page, 'Auswertung gespeichert')).toBeVisible()
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(xlsx)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Übersicht', 'Rechnungen', 'Positionen', 'Produkte', 'Steuer', 'Zahlarten', 'Vereine'])
    const overview = new Map<string, ExcelJS.CellValue>()
    wb.getWorksheet('Übersicht')!.eachRow((r) => overview.set(String(r.getCell(1).value), r.getCell(2).value))
    expect(overview.get('Gründungsfest')).toBe(FEST)
    expect(overview.get('Anzahl Rechnungen (inkl. stornierter)')).toBe(3)
    expect(overview.get('Anzahl Stornos')).toBe(2)
    expect(overview.get('Gesamtumsatz (Stornos gegengerechnet)')).toBe(58.5)
    expect(overview.get('davon bar')).toBe(0)
    expect(overview.get('davon per Überweisung')).toBe(58.5)
    const numbers: string[] = []
    wb.getWorksheet('Rechnungen')!.eachRow((r) => {
      const v = String(r.getCell(1).value ?? '')
      if (/^2025-\d{3}$/.test(v)) numbers.push(v)
    })
    expect(numbers.sort()).toEqual(['2025-081', '2025-082', '2025-083', '2025-084', '2025-085'])
    let vereinRows = 0
    let musterdorfFound = false
    wb.getWorksheet('Vereine')!.eachRow((r, idx) => {
      if (idx === 1) return
      const text = r.values ? JSON.stringify(r.values) : ''
      if (text.includes('FF Musterdorf')) musterdorfFound = true
      if (text.trim() !== '') vereinRows++
    })
    expect(musterdorfFound).toBe(true)
    expect(vereinRows).toBeGreaterThanOrEqual(15)

    /* ---------- 8. Datensicherung ---------- */
    await gotoRoute(page, '/einstellungen')
    await page.getByTestId('settings-backup-create').click()
    await expect(page.getByTestId('settings-backup-result')).toContainText(/Festbuero-Datensicherung-.*\.zip/)
    const backupDir = join(docs, 'Datensicherungen')
    const zips = readdirSync(backupDir).filter((f) => f.endsWith('.zip'))
    expect(zips).toHaveLength(1)
    expect(statSync(join(backupDir, zips[0]!)).size).toBeGreaterThan(1000)
  } finally {
    await closeApp(ctx)
  }
})
