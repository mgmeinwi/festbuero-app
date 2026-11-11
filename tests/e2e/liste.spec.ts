/**
 * E2E „Liste & Auswertung“: Rechnungsliste (Suche, Filter, Sortierung, Vorschau, Storno mit Pflichtgrund,
 * „Stornieren und neu erstellen“, Mehrfachauswahl → ZIP/Excel, Bulk-Druck im Dry-Run, Menüaktionen),
 * Auswertung (Kennzahlen mit Storno-Gegenrechnung, Excel-Export), alle vier Fenstergrößen hell/dunkel.
 *
 * Testdaten (erfunden):
 * - 2025-001 Musterverein e.V., 18 P., bar, 01.06.2025: Festessen 18, Getränkemarke 36, Festschrift 1 = 320,00 €
 * - 2025-002 Sportfreunde Beispielstadt, 12 P., Überweisung, 01.06.2025: Festessen 12, Festschrift 1 = 167,00 €
 * - 2025-003 Einzelrechnung, bar, heute: Getränkemarke 4, Zusatz „Kaffee“ 2 × 2,50 € = 13,00 €
 * - 2025-004 Einzelrechnung „Erika Beispiel“, Überweisung, 02.06.2025: Festessen 2 = 27,00 €
 * Im Test: Storno 2025-005 zu 2025-002, Storno 2025-006 zu 2025-003 („Stornieren und neu erstellen“).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import { expect, test, type Locator, type Page } from '@playwright/test'
import type { CustomerSnapshot, InvoiceDraft, InvoiceDraftLine } from '../../src/shared/types'
import {
  closeApp,
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

/** simulierter Drucker der E2E-Umgebung (prepareFestival setzt ihn als Standarddrucker) */
const PRINTER = E2E_TEST_PRINTER

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Betrag mit beliebigem Leerzeichen (formatEuro nutzt ein geschütztes Leerzeichen). */
function euro(text: string): RegExp {
  return new RegExp(`${text.replace(/[.]/g, '\\.')}\\s€`)
}

function toast(page: Page, text: string | RegExp): Locator {
  return page.locator('[data-sonner-toast]').filter({ hasText: text })
}

function row(page: Page, number: string): Locator {
  return page.locator(`[data-testid="invoice-row"][data-number="${number}"]`)
}

async function rowNumbers(page: Page): Promise<string[]> {
  return page.getByTestId('invoice-row').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-number') ?? ''))
}

async function waitForHash(page: Page, hash: string): Promise<void> {
  await page.waitForFunction((h) => window.location.hash === h, hash, POLL)
}

/**
 * Zeichnet alle Hash-Navigationen auf (pushState/replaceState/hashchange). Nötig, weil die Maske
 * `?from=`/`?club=` nach dem Übernehmen sofort aus der URL entfernt.
 */
async function recordNavigation(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __listeNav?: string[] }
    w.__listeNav = []
    if ((history as unknown as { __listePatched?: boolean }).__listePatched) return
    ;(history as unknown as { __listePatched?: boolean }).__listePatched = true
    const record = () => w.__listeNav?.push(window.location.hash)
    for (const method of ['pushState', 'replaceState'] as const) {
      const original = history[method].bind(history)
      history[method] = ((...args: Parameters<History['pushState']>) => {
        original(...args)
        record()
      }) as History['pushState']
    }
    window.addEventListener('hashchange', record)
  })
}

async function waitForNavigatedTo(page: Page, hash: string): Promise<void> {
  await page.waitForFunction(
    (h) => ((window as unknown as { __listeNav?: string[] }).__listeNav ?? []).includes(h),
    hash,
    POLL
  )
}

async function clickMenuItem(ctx: AppContext, id: string): Promise<void> {
  const found = await ctx.app.evaluate(({ Menu }, itemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(itemId)
    if (!item) return false
    item.click()
    return true
  }, id)
  expect(found, `Menüeintrag ${id}`).toBe(true)
}

async function setThemeDirect(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await invoke(page, 'app.updateSettings', { theme })
  await page.waitForFunction((t) => document.documentElement.classList.contains('dark') === (t === 'dark'), theme, POLL)
}

async function selectOption(page: Page, trigger: Locator, option: string): Promise<void> {
  await trigger.click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

function countLines(path: string): number {
  if (!existsSync(path)) return 0
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim() !== '').length
}

interface Seed {
  festivalId: number
  ids: { r1: number; r2: number; r3: number; r4: number }
  clubs: { muster: number; sport: number; tracht: number }
}

async function seed(ctx: AppContext, festivalId: number): Promise<Seed> {
  const page = ctx.page
  const essen = await invoke(page, 'products.create', festivalId, {
    name: 'Festessen',
    priceCents: 1350,
    vatRate: 19,
    mode: 'pro_person',
    defaultQuantity: 1,
    active: true
  })
  const marke = await invoke(page, 'products.create', festivalId, {
    name: 'Getränkemarke',
    priceCents: 200,
    vatRate: 19,
    mode: 'pro_person',
    defaultQuantity: 2,
    active: true
  })
  const schrift = await invoke(page, 'products.create', festivalId, {
    name: 'Festschrift',
    priceCents: 500,
    vatRate: 7,
    mode: 'feste_anzahl',
    defaultQuantity: 1,
    active: true
  })
  const club = (clubName: string, registeredPersons: number, city: string) =>
    invoke(page, 'clubs.create', festivalId, {
      contactName: 'Max Muster',
      clubName,
      street: 'Musterstraße 1',
      zip: '01234',
      city,
      registeredPersons
    })
  const muster = await club('Musterverein e.V.', 20, 'Musterstadt')
  const sport = await club('Sportfreunde Beispielstadt', 15, 'Beispielstadt')
  const tracht = await club('Trachtenverein Muster', 10, 'Musterdorf')

  const lines = (q: { essen?: number; marke?: number; schrift?: number }, extra: InvoiceDraftLine[] = []): InvoiceDraftLine[] => [
    { productId: essen.id, name: 'Festessen', priceCents: 1350, vatRate: 19, quantity: q.essen ?? 0 },
    { productId: marke.id, name: 'Getränkemarke', priceCents: 200, vatRate: 19, quantity: q.marke ?? 0 },
    { productId: schrift.id, name: 'Festschrift', priceCents: 500, vatRate: 7, quantity: q.schrift ?? 0 },
    ...extra
  ]
  const vereinCustomer = (c: typeof muster): CustomerSnapshot => ({
    kind: 'verein',
    clubId: c.id,
    contactName: c.contactName,
    clubName: c.clubName,
    street: c.street,
    zip: c.zip,
    city: c.city,
    registeredPersons: c.registeredPersons
  })
  const einzel = (contactName = ''): CustomerSnapshot => ({
    kind: 'einzel',
    clubId: null,
    contactName,
    clubName: '',
    street: '',
    zip: '',
    city: '',
    registeredPersons: null
  })
  const finalize = async (draft: Omit<InvoiceDraft, 'festivalId' | 'serviceDate'>) => {
    const result = await invoke(page, 'invoices.finalize', { ...draft, festivalId, serviceDate: '2025-06-01' })
    return result.invoice.id
  }

  const r1 = await finalize({
    customer: vereinCustomer(muster),
    persons: 18,
    paymentKind: 'bar',
    invoiceDate: '2025-06-01',
    lines: lines({ essen: 18, marke: 36, schrift: 1 })
  })
  const r2 = await finalize({
    customer: vereinCustomer(sport),
    persons: 12,
    paymentKind: 'ueberweisung',
    invoiceDate: '2025-06-01',
    lines: lines({ essen: 12, schrift: 1 })
  })
  const r3 = await finalize({
    customer: einzel(),
    persons: null,
    paymentKind: 'bar',
    invoiceDate: todayIso(),
    lines: lines({ marke: 4 }, [{ productId: null, name: 'Kaffee', priceCents: 250, vatRate: 19, quantity: 2 }])
  })
  const r4 = await finalize({
    customer: einzel('Erika Beispiel'),
    persons: null,
    paymentKind: 'ueberweisung',
    invoiceDate: '2025-06-02',
    lines: lines({ essen: 2 })
  })
  return { festivalId, ids: { r1, r2, r3, r4 }, clubs: { muster: muster.id, sport: sport.id, tracht: tracht.id } }
}

test.describe.serial('Liste & Auswertung', () => {
  let ctx: AppContext
  let data: Seed

  test.beforeAll(async () => {
    ctx = await launchApp({ viewport: 'laptop' })
    const festival = await prepareFestival(ctx.page, { festival: { taxExempt: false } })
    data = { festivalId: festival.id } as Seed
  })

  test.afterAll(async () => {
    if (ctx) await closeApp(ctx)
  })

  test('Leerzustand verweist auf die Festbüro-Maske', async () => {
    const page = ctx.page
    await gotoRoute(page, '/auswertung')
    await expect(page.getByTestId('kpi-total')).toContainText(euro('0,00'))
    await screenshot(page, 'liste-auswertung-leer-laptop')

    await gotoRoute(page, '/rechnungen')
    await expect(page.getByTestId('invoices-empty')).toBeVisible()
    await expect(page.getByText('Noch keine Rechnungen')).toBeVisible()
    await screenshot(page, 'liste-leer-laptop')
    await page.getByRole('button', { name: 'Zur Festbüro-Maske' }).click()
    await waitForHash(page, '#/festbuero')
  })

  test('Rechnungen anlegen (invoices.finalize)', async () => {
    data = await seed(ctx, data.festivalId)
    const list = await invoke(ctx.page, 'invoices.list', data.festivalId)
    expect(list.map((i) => i.number).sort()).toEqual(['2025-001', '2025-002', '2025-003', '2025-004'])
  })

  test('Liste: Spalten, Summe, Suche, Filter und Sortierung', async () => {
    const page = ctx.page
    await gotoRoute(page, '/rechnungen', { reload: true })
    await expect(page.getByTestId('invoice-row')).toHaveCount(4)
    expect(await rowNumbers(page)).toEqual(['2025-004', '2025-003', '2025-002', '2025-001'])
    await expect(page.getByTestId('invoice-sum')).toHaveText(euro('527,00'))
    await expect(page.getByTestId('invoice-footer')).toContainText('4 Belege')

    const r1 = row(page, '2025-001')
    await expect(r1).toContainText('Musterverein e.V.')
    await expect(r1).toContainText('01.06.2025')
    await expect(r1).toContainText(euro('320,00'))
    await expect(r1).toContainText('abgeschlossen')
    await expect(r1).toContainText('Bar')
    await expect(r1).toContainText('18')
    await expect(r1).toContainText('ja') // gedruckt (Dry-Run)
    await expect(row(page, '2025-003')).toContainText('Einzelrechnung')

    // Suche über Kunde und Nummer
    const search = page.getByTestId('invoice-search')
    await search.fill('sport')
    expect(await rowNumbers(page)).toEqual(['2025-002'])
    await search.fill('003')
    expect(await rowNumbers(page)).toEqual(['2025-003'])
    await search.fill('gibt es nicht')
    await expect(page.getByTestId('invoices-filter-empty')).toBeVisible()
    await search.press('Escape')
    await expect(page.getByTestId('invoice-row')).toHaveCount(4)

    // Zahlart
    await selectOption(page, page.getByTestId('filter-payment'), 'Überweisung')
    expect(await rowNumbers(page)).toEqual(['2025-004', '2025-002'])
    await expect(page.getByTestId('invoice-sum')).toHaveText(euro('194,00'))
    await expect(page.getByTestId('invoice-footer')).toContainText('2 Belege von 4')
    await selectOption(page, page.getByTestId('filter-payment'), 'Alle Zahlarten')

    // Zeitraum: Heute / Alle / von–bis
    await page.getByTestId('filter-range').click()
    await page.getByRole('button', { name: 'Heute', exact: true }).click()
    expect(await rowNumbers(page)).toEqual(['2025-003'])
    await expect(page.getByTestId('filter-range')).toContainText('Heute')
    await page.getByTestId('filter-range').click()
    await page.getByRole('button', { name: 'Alle', exact: true }).click()
    await expect(page.getByTestId('invoice-row')).toHaveCount(4)
    await page.getByTestId('filter-range').click()
    await page.getByLabel('Von', { exact: true }).fill('2025-06-02')
    await page.getByLabel('Bis', { exact: true }).fill('2025-06-02')
    await page.keyboard.press('Escape')
    expect(await rowNumbers(page)).toEqual(['2025-004'])
    await page.getByRole('button', { name: 'Filter zurücksetzen' }).click()
    await expect(page.getByTestId('invoice-row')).toHaveCount(4)

    // Sortierung per Spaltenkopf
    await page.getByRole('button', { name: /^Betrag/ }).click()
    expect(await rowNumbers(page)).toEqual(['2025-001', '2025-002', '2025-004', '2025-003'])
    await page.getByRole('button', { name: /^Betrag/ }).click()
    expect(await rowNumbers(page)).toEqual(['2025-003', '2025-004', '2025-002', '2025-001'])
    await page.getByRole('button', { name: /^Kunde/ }).click()
    expect((await rowNumbers(page))[0]).toBe('2025-003') // „Einzelrechnung“ vor „Erika …“
    await page.getByRole('button', { name: /^Nummer/ }).click()
    expect(await rowNumbers(page)).toEqual(['2025-004', '2025-003', '2025-002', '2025-001'])
  })

  test('Vorschau aus dem Snapshot', async () => {
    const page = ctx.page
    await row(page, '2025-001').getByRole('button', { name: '2025-001', exact: true }).click()
    const dialog = page.getByTestId('preview-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Rechnung 2025-001')
    await expect(dialog.getByTestId('invoice-preview')).toHaveAttribute('data-rendered', 'true')
    await screenshot(page, 'liste-vorschau-laptop')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test('Storno mit Pflichtgrund', async () => {
    const page = ctx.page
    await row(page, '2025-002').getByRole('button', { name: 'Aktionen für 2025-002' }).click()
    await page.getByRole('menuitem', { name: 'Stornieren …' }).click()
    const dialog = page.getByTestId('storno-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Rechnung 2025-002 stornieren')
    await expect(dialog).toContainText('nicht rückgängig')
    await expect(dialog.getByLabel(/Grund/)).toBeFocused()

    // ohne Grund: Hinweis, Dialog bleibt offen, nichts storniert
    await dialog.getByRole('button', { name: 'Stornieren', exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Bitte einen Grund für den Storno angeben.')
    await expect(dialog).toBeVisible()
    await screenshot(page, 'liste-storno-laptop')
    expect((await invoke(page, 'invoices.list', data.festivalId)).length).toBe(4)

    await dialog.getByLabel(/Grund/).fill('Falsche Personenzahl')
    await dialog.getByRole('button', { name: 'Stornieren', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(toast(page, 'Storno 2025-005 zu Rechnung 2025-002 erstellt')).toBeVisible()
    await expect(toast(page, 'Storno 2025-005 gedruckt')).toBeVisible()

    await expect(page.getByTestId('invoice-row')).toHaveCount(5)
    await expect(row(page, '2025-002')).toContainText('storniert')
    await expect(row(page, '2025-002')).toContainText('durch Nr. 2025-005')
    await expect(row(page, '2025-005')).toContainText('Storno')
    await expect(row(page, '2025-005')).toContainText('zu Nr. 2025-002')
    await expect(row(page, '2025-005')).toContainText(euro('-167,00'))
    await expect(page.getByTestId('invoice-sum')).toHaveText(euro('360,00'))

    // stornierte Rechnung und Stornobeleg bieten kein „Stornieren“ mehr
    await row(page, '2025-002').getByRole('button', { name: 'Aktionen für 2025-002' }).click()
    await expect(page.getByRole('menuitem', { name: 'Vorschau' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Stornieren …' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    // Status-Filter
    await selectOption(page, page.getByTestId('filter-status'), 'Storno')
    expect(await rowNumbers(page)).toEqual(['2025-005'])
    await selectOption(page, page.getByTestId('filter-status'), 'storniert')
    expect(await rowNumbers(page)).toEqual(['2025-002'])
    await selectOption(page, page.getByTestId('filter-status'), 'Alle Status')
    await expect(page.getByTestId('invoice-row')).toHaveCount(5)
  })

  test('„Stornieren und neu erstellen“ öffnet die Maske mit der alten Rechnung', async () => {
    const page = ctx.page
    await row(page, '2025-003').getByRole('button', { name: 'Aktionen für 2025-003' }).click()
    await page.getByRole('menuitem', { name: 'Stornieren …' }).click()
    const dialog = page.getByTestId('storno-dialog')
    await dialog.getByLabel(/Grund/).fill('Neu erfassen')
    await recordNavigation(page)
    await dialog.getByRole('button', { name: 'Stornieren und neu erstellen' }).click()
    await waitForNavigatedTo(page, `#/festbuero?from=${data.ids.r3}`)
    await waitForHash(page, '#/festbuero') // Maske übernimmt die Daten und räumt die URL auf
    const list = await invoke(page, 'invoices.list', data.festivalId)
    const storno = list.find((i) => i.number === '2025-006')
    expect(storno).toMatchObject({ type: 'storno', originalNumber: '2025-003', totalGrossCents: -1300 })
  })

  test('Mehrfachauswahl: ZIP- und Excel-Export der Auswahl', async () => {
    const page = ctx.page
    await gotoRoute(page, '/rechnungen', { reload: true })
    await expect(page.getByTestId('invoice-row')).toHaveCount(6)
    await page.getByRole('checkbox', { name: '2025-001 auswählen' }).check()
    await page.getByRole('checkbox', { name: '2025-004 auswählen' }).check()
    const bar = page.getByTestId('bulk-bar')
    await expect(bar).toContainText('2 ausgewählt')

    const zipPath = join(ctx.userDataDir, 'auswahl.zip')
    await stubDialogs(ctx.app, { save: zipPath })
    await bar.getByRole('button', { name: 'ZIP' }).click()
    await expect(toast(page, 'ZIP mit 2 Belegen gespeichert')).toBeVisible()
    expect(existsSync(zipPath)).toBe(true)

    const xlsxPath = join(ctx.userDataDir, 'auswahl.xlsx')
    await stubDialogs(ctx.app, { save: xlsxPath })
    await bar.getByRole('button', { name: 'Excel' }).click()
    await expect(toast(page, 'Excel-Liste mit 2 Belegen gespeichert')).toBeVisible()
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(xlsxPath)
    const ws = wb.getWorksheet('Rechnungen')!
    expect(ws.getRow(2).getCell(1).value).toBe('2025-004')
    expect(ws.getRow(3).getCell(1).value).toBe('2025-001')
    expect(ws.getRow(3).getCell(6).value).toBe(320)
    expect(ws.getRow(3).getCell(6).numFmt).toBe('#,##0.00 "€"')

    // Abbrechen im Dialog: keine Meldung, keine Datei
    await stubDialogs(ctx.app, { save: null })
    await bar.getByRole('button', { name: 'ZIP' }).click()
    await bar.getByRole('button', { name: 'Auswahl aufheben' }).click()
    await expect(bar).toBeHidden()
  })

  test('Bulk-Druck mit Bestätigung (Dry-Run)', async () => {
    const page = ctx.page
    const log = join(ctx.userDataDir, 'print-dry-run.log')
    const before = countLines(log)
    await page.getByTestId('select-all').click()
    const bar = page.getByTestId('bulk-bar')
    await expect(bar).toContainText('6 ausgewählt')
    await bar.getByRole('button', { name: 'Drucken …' }).click()
    const dialog = page.getByTestId('print-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('print-confirm-text')).toHaveText(`6 Belege auf „${PRINTER}“ drucken, je 2 Kopien?`)
    await screenshot(page, 'liste-bulkdruck-laptop')
    await dialog.getByRole('button', { name: 'Drucken', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(toast(page, '6 Belege gedruckt')).toBeVisible()
    expect(countLines(log)).toBe(before + 6)
    await bar.getByRole('button', { name: 'Auswahl aufheben' }).click()

    // einzeln erneut drucken mit Druckerwahl
    await row(page, '2025-001').getByRole('button', { name: 'Aktionen für 2025-001' }).click()
    await page.getByRole('menuitem', { name: 'Erneut drucken …' }).click()
    await expect(dialog).toContainText('Rechnung 2025-001 erneut drucken')
    await expect(dialog.getByTestId('print-confirm-text')).toContainText('2 Kopien')
    await dialog.getByRole('button', { name: 'Drucken', exact: true }).click()
    await expect(toast(page, '2025-001 gedruckt')).toBeVisible()
    expect(countLines(log)).toBe(before + 7)
  })

  test('Menüaktionen der Liste: Suchen, Excel-Export, ZIP', async () => {
    const page = ctx.page
    await clickMenuItem(ctx, 'search.focus')
    await expect(page.getByTestId('invoice-search')).toBeFocused()

    const xlsxPath = join(ctx.userDataDir, 'liste-menue.xlsx')
    await stubDialogs(ctx.app, { save: xlsxPath })
    await clickMenuItem(ctx, 'invoices.exportListExcel')
    await expect(toast(page, 'Excel-Liste mit 6 Belegen gespeichert')).toBeVisible()
    expect(existsSync(xlsxPath)).toBe(true)

    const zipPath = join(ctx.userDataDir, 'alle.zip')
    await stubDialogs(ctx.app, { save: zipPath })
    await clickMenuItem(ctx, 'invoices.exportZip')
    await expect(toast(page, 'ZIP mit 6 Belegen gespeichert')).toBeVisible()
    expect(existsSync(zipPath)).toBe(true)
  })

  test('Auswertung: Kennzahlen mit Storno-Gegenrechnung, Tabellen, Vereine ohne Rechnung', async () => {
    const page = ctx.page
    await gotoRoute(page, '/auswertung', { reload: true })
    const kpi = (id: string) => page.getByTestId(id).locator('[data-value]')
    await expect(kpi('kpi-invoices')).toHaveText('4')
    await expect(kpi('kpi-stornos')).toHaveText('2')
    await expect(kpi('kpi-total')).toHaveText(euro('347,00'))
    await expect(kpi('kpi-cash')).toHaveText(euro('320,00'))
    await expect(kpi('kpi-transfer')).toHaveText(euro('27,00'))
    await expect(kpi('kpi-persons')).toHaveText('18')

    const products = page.getByTestId('product-row')
    await expect(products).toHaveCount(4)
    await expect(products.nth(0)).toContainText('Festessen')
    await expect(products.nth(0)).toContainText('20')
    await expect(products.nth(0)).toContainText(euro('270,00'))
    await expect(products.nth(1)).toContainText('Getränkemarke')
    await expect(products.nth(1)).toContainText(euro('72,00'))
    await expect(products.nth(2)).toContainText('Festschrift')
    await expect(products.nth(3)).toContainText('Kaffee')
    await expect(products.nth(3)).toContainText('Zusatz')
    await expect(products.nth(3)).toContainText(euro('0,00'))

    const tax = page.getByTestId('tax-row')
    await expect(tax).toHaveCount(2)
    await expect(tax.nth(0)).toContainText('7 %')
    await expect(tax.nth(0)).toContainText(euro('5,00'))
    await expect(tax.nth(1)).toContainText('19 %')
    await expect(tax.nth(1)).toContainText(euro('342,00'))

    const days = page.getByTestId('day-row')
    await expect(days).toHaveCount(3)
    await expect(days.nth(0)).toContainText('01.06.2025')
    await expect(days.nth(0)).toContainText(euro('487,00'))
    await expect(days.nth(2)).toContainText(euro('-167,00'))

    await expect(page.getByTestId('clubs-without-count')).toHaveText('2')
    const clubs = page.getByTestId('club-without-invoice')
    await expect(clubs).toHaveCount(2)
    await expect(clubs.nth(0)).toContainText('Sportfreunde Beispielstadt') // nur stornierte Rechnung
    await expect(clubs.nth(1)).toContainText('Trachtenverein Muster')
    await recordNavigation(page)
    await clubs.nth(1).click()
    await waitForNavigatedTo(page, `#/festbuero?club=${data.clubs.tracht}`)
  })

  test('Auswertung: Excel-Export per Button und Menü', async () => {
    const page = ctx.page
    await gotoRoute(page, '/auswertung')
    const path = join(ctx.userDataDir, 'auswertung.xlsx')
    await stubDialogs(ctx.app, { save: path })
    await page.getByTestId('evaluation-export').click()
    await expect(toast(page, 'Auswertung gespeichert')).toBeVisible()
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(path)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Übersicht', 'Rechnungen', 'Positionen', 'Produkte', 'Steuer', 'Zahlarten', 'Vereine'])
    const overview = wb.getWorksheet('Übersicht')!
    let total: ExcelJS.CellValue = null
    overview.eachRow((r) => {
      if (r.getCell(1).value === 'Gesamtumsatz (Stornos gegengerechnet)') total = r.getCell(2).value
    })
    expect(total).toBe(347)
    expect(wb.getWorksheet('Rechnungen')!.getRow(7).getCell(1).value).toBe('2025-006')

    // Menüaktion von einer anderen Seite aus: Shell navigiert zur Auswertung und stellt zu
    await gotoRoute(page, '/rechnungen')
    const menuPath = join(ctx.userDataDir, 'auswertung-menue.xlsx')
    await stubDialogs(ctx.app, { save: menuPath })
    await clickMenuItem(ctx, 'evaluation.exportExcel')
    await waitForHash(page, '#/auswertung')
    await expect(toast(page, 'Auswertung gespeichert').last()).toBeVisible()
    await expect.poll(() => existsSync(menuPath)).toBe(true)
  })

  test('Responsive: Liste und Auswertung in allen Größen, hell und dunkel', async () => {
    const page = ctx.page
    for (const theme of ['light', 'dark'] as const) {
      await setThemeDirect(page, theme)
      for (const route of ['/rechnungen', '/auswertung'] as const) {
        await gotoRoute(page, route)
        await expect(page.getByTestId(route === '/rechnungen' ? 'invoice-table' : 'evaluation-kpis')).toBeVisible()
        for (const name of Object.keys(VIEWPORTS) as ViewportName[]) {
          const [w, h] = VIEWPORTS[name]
          await setWindowSize(ctx.app, w, h, page)
          await expectNoHorizontalOverflow(page)
          if (route === '/rechnungen') {
            // Tabelle passt ohne internen Querscroll, Aktionen bleiben erreichbar
            const scroll = await page
              .getByTestId('invoice-scroll')
              .evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
            expect(scroll.sw, `Tabelle scrollt quer bei ${name}`).toBeLessThanOrEqual(scroll.cw)
            await expect(page.getByTestId('invoice-row').first().getByTestId('row-actions')).toBeInViewport()
          }
          const label = route === '/rechnungen' ? 'rechnungen' : 'auswertung'
          await screenshot(page, `liste-${label}-${theme}-${name}`, { hideToasts: true })
          if (route === '/auswertung' && (name === 'min' || name === 'laptop')) {
            await page.getByTestId('evaluation-clubs').scrollIntoViewIfNeeded()
            await screenshot(page, `liste-auswertung-vereine-${theme}-${name}`, { hideToasts: true })
            await page.getByTestId('main-content').evaluate((el) => el.scrollTo({ top: 0 }))
          }
        }
      }
    }

    // Dialoge bei kleinster Fenstergröße
    await setWindowSize(ctx.app, ...VIEWPORTS.min, page)
    await gotoRoute(page, '/rechnungen')
    await row(page, '2025-001').getByRole('button', { name: 'Aktionen für 2025-001' }).click()
    await screenshot(page, 'liste-aktionen-dark-min', { hideToasts: true })
    await page.getByRole('menuitem', { name: 'Stornieren …' }).click()
    await expect(page.getByTestId('storno-dialog')).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await screenshot(page, 'liste-storno-dark-min')
    await page.keyboard.press('Escape')
    await setThemeDirect(page, 'light')
    await row(page, '2025-001').getByRole('button', { name: 'Aktionen für 2025-001' }).click()
    await page.getByRole('menuitem', { name: 'Stornieren …' }).click()
    await screenshot(page, 'liste-storno-light-min')
    await page.keyboard.press('Escape')
    await row(page, '2025-004').getByRole('button', { name: '2025-004', exact: true }).click()
    await expect(page.getByTestId('preview-dialog').getByTestId('invoice-preview')).toHaveAttribute('data-rendered', 'true')
    await screenshot(page, 'liste-vorschau-light-min')
    await page.keyboard.press('Escape')
    await page.getByTestId('select-all').click()
    await page.getByTestId('bulk-bar').getByRole('button', { name: 'Drucken …' }).click()
    await expect(page.getByTestId('print-dialog')).toBeVisible()
    await screenshot(page, 'liste-bulkdruck-light-min')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('print-dialog')).toBeHidden()
    await setWindowSize(ctx.app, ...VIEWPORTS.laptop, page)
  })
})

test('Bulk-Druck mit Fehlern zeigt die Ergebnisliste', async () => {
  const ctx = await launchApp({ viewport: 'laptop', env: { FESTBUERO_FAKE_PRINT_FAIL: '1' } })
  try {
    const page = ctx.page
    const festival = await prepareFestival(page)
    for (const [i, name] of ['Musterverein e.V.', 'Sportfreunde Beispielstadt'].entries()) {
      await invoke(page, 'invoices.finalize', {
        festivalId: festival.id,
        customer: {
          kind: 'verein',
          clubId: null,
          contactName: 'Max Muster',
          clubName: name,
          street: 'Musterstraße 1',
          zip: '01234',
          city: 'Musterstadt',
          registeredPersons: 10
        },
        persons: 10 + i,
        paymentKind: 'bar',
        invoiceDate: '2025-06-01',
        serviceDate: '2025-06-01',
        lines: [{ productId: null, name: 'Festessen', priceCents: 1350, vatRate: 19, quantity: 10 + i }]
      })
    }
    await gotoRoute(page, '/rechnungen', { reload: true })
    await expect(page.getByTestId('invoice-row')).toHaveCount(2)
    await expect(row(page, '2025-001')).toContainText('nein') // Druck beim Abschluss fehlgeschlagen
    await page.getByTestId('select-all').click()
    await page.getByTestId('bulk-bar').getByRole('button', { name: 'Drucken …' }).click()
    await page.getByTestId('print-dialog').getByRole('button', { name: 'Drucken', exact: true }).click()
    const results = page.getByTestId('print-results-dialog')
    await expect(results).toBeVisible()
    await expect(results).toContainText('2 Belege mit Fehler')
    await expect(results).toContainText('2025-001')
    await expect(results).toContainText('simulierter Druckfehler')
    await screenshot(page, 'liste-druckfehler-laptop', { hideToasts: true })
    await results.getByRole('button', { name: 'Fehlgeschlagene erneut drucken' }).click()
    await expect(page.getByTestId('print-dialog')).toContainText('2 Belege drucken')
    await page.getByTestId('print-dialog').getByRole('button', { name: 'Abbrechen' }).click()

    // einzelner Druckfehler: deutliche Warnung mit „Erneut drucken“
    await page.getByTestId('bulk-bar').getByRole('button', { name: 'Auswahl aufheben' }).click()
    await row(page, '2025-002').getByRole('button', { name: 'Aktionen für 2025-002' }).click()
    await page.getByRole('menuitem', { name: 'Erneut drucken …' }).click()
    await page.getByTestId('print-dialog').getByRole('button', { name: 'Drucken', exact: true }).click()
    const warning = toast(page, '2025-002 wurde nicht gedruckt')
    await expect(warning).toBeVisible()
    await expect(warning.getByRole('button', { name: 'Erneut drucken' })).toBeVisible()
  } finally {
    await closeApp(ctx)
  }
})
