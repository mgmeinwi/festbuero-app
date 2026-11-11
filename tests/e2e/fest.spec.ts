/**
 * E2E: Fest-Einstellungen (Allgemein, Nummern, Produkte, Zahlarten).
 *   FESTBUERO_OUT_DIR=out/fest npm run test:e2e -- tests/e2e/fest.spec.ts
 * Screenshots: test-results/screenshots/fest-*.png
 */
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import type { Festival, VatRate } from '../../src/shared/types'
import {
  closeApp,
  countCrashReports,
  dismissToasts,
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
  VIEWPORTS,
  type AppContext,
  type ViewportName
} from './helpers'

const PAGES = ['allgemein', 'nummern', 'produkte', 'zahlarten'] as const

/** Produkte und Preise der Beispielrechnung (neutrale Bezeichnungen). */
const SAMPLE_PRODUCTS: ReadonlyArray<{ name: string; priceCents: number; vatRate: VatRate }> = [
  { name: '1 Maß Bier (ohne Bedienung)', priceCents: 970, vatRate: 19 },
  { name: 'Brotzeit', priceCents: 800, vatRate: 7 },
  { name: 'Festzeichen', priceCents: 300, vatRate: 19 },
  { name: 'Festessen', priceCents: 1450, vatRate: 7 },
  { name: 'Korsoeinsatz', priceCents: 200, vatRate: 19 },
  { name: 'Käsespätzle', priceCents: 1000, vatRate: 7 },
  { name: 'Festschrift', priceCents: 1500, vatRate: 7 },
  { name: 'Alkoholfreies Getränk (0,5l)', priceCents: 380, vatRate: 19 }
]

async function clickMenuItem(ctx: AppContext, id: string): Promise<void> {
  const found = await ctx.app.evaluate(({ Menu }, itemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(itemId)
    if (!item) return false
    item.click()
    return true
  }, id)
  expect(found, `Menüeintrag ${id}`).toBe(true)
}

async function menuHasItem(ctx: AppContext, id: string): Promise<boolean> {
  return ctx.app.evaluate(({ Menu }, itemId) => Boolean(Menu.getApplicationMenu()?.getMenuItemById(itemId)), id)
}

async function productNames(page: Page, festivalId: number): Promise<string[]> {
  return (await invoke(page, 'products.list', festivalId)).map((p) => p.name)
}

function row(page: Page, name: string) {
  return page.getByTestId('product-row').filter({ has: page.getByText(name, { exact: true }) })
}

/**
 * Legt einen abgeschlossenen Beleg mit einer Position zum Produkt direkt per SQL an (im Main-Prozess,
 * eigene Verbindung). Nötig, solange „Abschluss & Druck“ noch keine Rechnungen erzeugt.
 */
async function insertInvoiceViaSql(ctx: AppContext, festivalId: number, productId: number): Promise<void> {
  await ctx.app.evaluate(
    (_electron, args) => {
      const req = (process as unknown as { mainModule: { require: (id: string) => unknown } }).mainModule.require
      type Stmt = { run: (...params: unknown[]) => { lastInsertRowid: number | bigint } }
      const Database = req(args.modulePath) as new (path: string) => { prepare: (sql: string) => Stmt; close: () => void }
      const db = new Database(args.dbPath)
      try {
        const now = new Date().toISOString()
        const invoiceId = db
          .prepare(
            `INSERT INTO invoice (festival_id, number, seq, type, status, customer_kind, customer_json, payment_kind,
              payment_label, payment_text, due_days, invoice_date, service_date, due_date, total_gross_cents,
              total_net_cents, total_vat_cents, totals_json, tax_exempt, tax_exempt_text, festival_name, template_json, created_at)
             VALUES (?, '2025-081', 81, 'rechnung', 'abgeschlossen', 'einzel', '{}', 'bar', 'Bar', '', 7,
              '2025-06-01', '2025-06-01', '2025-06-08', 300, 300, 0, '{}', 1, '', 'Testfest 2025', '{}', ?)`
          )
          .run(args.festivalId, now).lastInsertRowid
        db.prepare(
          `INSERT INTO invoice_line (invoice_id, position, product_id, name, price_cents, vat_rate, quantity, line_total_cents)
           VALUES (?, 1, ?, 'Festzeichen', 300, 19, 1, 300)`
        ).run(invoiceId, args.productId)
        db.prepare('UPDATE festival SET number_next = 82 WHERE id = ?').run(args.festivalId)
      } finally {
        db.close()
      }
    },
    {
      dbPath: join(ctx.userDataDir, 'festbuero.sqlite'),
      modulePath: join(PROJECT_ROOT, 'node_modules', 'better-sqlite3'),
      festivalId,
      productId
    }
  )
}

/** Inhaltsbereich nach oben scrollen (Screenshots zeigen den Seitenanfang). */
async function scrollContentTop(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll<HTMLElement>('main, main *').forEach((el) => {
      if (el.scrollTop > 0) el.scrollTop = 0
    })
  })
}

async function uiProductOrder(page: Page): Promise<string[]> {
  return page.getByTestId('product-row').evaluateAll((rows) =>
    rows.map((r) => r.querySelector('span[title]')?.getAttribute('title') ?? '')
  )
}

test.describe.serial('Fest-Einstellungen', () => {
  const crashesBefore = countCrashReports()
  let ctx: AppContext | null = null
  let festival: Festival

  test.beforeAll(async () => {
    ctx = await launchApp({ viewport: 'laptop' })
    festival = await prepareFestival(ctx.page, { route: '/fest/produkte' })
  })

  test.afterAll(async () => {
    if (ctx) await closeApp(ctx)
  })

  test('Produkte: anlegen, bearbeiten, sortieren, deaktivieren, löschen', async () => {
    const { page } = ctx!
    await expect(page.getByTestId('products-empty')).toBeVisible()

    // Anlegen per Tastatur (Enter sendet das Formular ab)
    await page.getByRole('button', { name: 'Neues Produkt' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('Bezeichnung', { exact: true })).toBeFocused()
    await page.keyboard.type('Festzeichen')
    await dialog.getByLabel('Bruttopreis', { exact: true }).fill('3')
    await dialog.getByLabel('Bruttopreis', { exact: true }).press('Enter')
    await expect(dialog).toBeHidden()
    await expect(row(page, 'Festzeichen')).toContainText('3,00 €')

    // feste Anzahl, 7 %
    await page.getByRole('button', { name: 'Neues Produkt' }).click()
    await dialog.getByLabel('Bezeichnung', { exact: true }).fill('Festschrift')
    await dialog.getByLabel('Bruttopreis', { exact: true }).fill('15')
    await dialog.getByRole('radio', { name: '7 %' }).click()
    await expect(dialog.getByLabel('Standardanzahl', { exact: true })).toBeDisabled()
    await dialog.getByRole('radio', { name: /feste Anzahl/ }).click()
    await expect(dialog.getByLabel('Standardanzahl', { exact: true })).toBeEnabled()
    await dialog.getByLabel('Standardanzahl', { exact: true }).fill('1')
    await dialog.getByRole('button', { name: 'Produkt anlegen' }).click()
    await expect(dialog).toBeHidden()

    // Validierung im Dialog, dann „9,7“ → 9,70 €
    await page.getByRole('button', { name: 'Neues Produkt' }).click()
    await dialog.getByRole('button', { name: 'Produkt anlegen' }).click()
    await expect(dialog.getByText('Bitte eine Bezeichnung angeben.')).toBeVisible()
    await dialog.getByLabel('Bezeichnung', { exact: true }).fill('Brotzeit')
    await dialog.getByLabel('Bruttopreis', { exact: true }).fill('abc')
    await dialog.getByRole('button', { name: 'Produkt anlegen' }).click()
    await expect(dialog.getByText(/Ungültiger Betrag/)).toBeVisible()
    await dialog.getByLabel('Bruttopreis', { exact: true }).fill('9,7')
    await dialog.getByLabel('Bruttopreis', { exact: true }).blur()
    await expect(dialog.getByLabel('Bruttopreis', { exact: true })).toHaveValue('9,70')
    await dialog.getByRole('button', { name: 'Produkt anlegen' }).click()
    await expect(dialog).toBeHidden()

    expect(await productNames(page, festival.id)).toEqual(['Festzeichen', 'Festschrift', 'Brotzeit'])
    const list = await invoke(page, 'products.list', festival.id)
    expect(list.map((p) => [p.priceCents, p.vatRate, p.mode, p.defaultQuantity])).toEqual([
      [300, 19, 'pro_person', 1],
      [1500, 7, 'feste_anzahl', 1],
      [970, 19, 'pro_person', 1]
    ])
    await expect(row(page, 'Festschrift')).toContainText('feste Anzahl (1)')

    // Bearbeiten
    await row(page, 'Brotzeit').getByRole('button', { name: '„Brotzeit“ bearbeiten' }).click()
    await expect(dialog.getByRole('heading', { name: 'Produkt bearbeiten' })).toBeVisible()
    await expect(dialog.getByLabel('Bruttopreis', { exact: true })).toHaveValue('9,70')
    await dialog.getByLabel('Bruttopreis', { exact: true }).fill('8,00')
    await dialog.getByRole('radio', { name: '7 %' }).click()
    await dialog.getByRole('button', { name: 'Speichern' }).click()
    await expect(dialog).toBeHidden()
    await expect(row(page, 'Brotzeit')).toContainText('8,00 €')
    await expect.poll(async () => (await invoke(page, 'products.list', festival.id))[2]).toMatchObject({
      name: 'Brotzeit',
      priceCents: 800,
      vatRate: 7
    })

    // Sortieren: Hoch-Button
    await row(page, 'Brotzeit').getByRole('button', { name: '„Brotzeit“ nach oben' }).click()
    await expect.poll(() => productNames(page, festival.id)).toEqual(['Festzeichen', 'Brotzeit', 'Festschrift'])
    await expect.poll(() => uiProductOrder(page)).toEqual(['Festzeichen', 'Brotzeit', 'Festschrift'])
    // Fokus bleibt auf dem Button (mehrfaches Drücken per Tastatur möglich)
    await expect(row(page, 'Brotzeit').getByRole('button', { name: '„Brotzeit“ nach oben' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(() => productNames(page, festival.id)).toEqual(['Brotzeit', 'Festzeichen', 'Festschrift'])

    // Sortieren per Tastatur am Ziehgriff (dnd-kit KeyboardSensor): Leertaste, Pfeil runter, Leertaste
    await expect.poll(() => uiProductOrder(page)).toEqual(['Brotzeit', 'Festzeichen', 'Festschrift'])
    const liveRegion = page.locator('[id^="DndLiveRegion"]')
    const handle = row(page, 'Brotzeit').getByRole('button', { name: /„Brotzeit“ verschieben/ })
    await handle.focus()
    await page.keyboard.press('Space')
    await expect(liveRegion).toContainText('„Brotzeit“ aufgenommen. Position 1 von 3.')
    // dnd-kit hängt den Tastatur-Listener erst nach einem Timeout an → Pfeil nur erneut senden, solange nichts passiert ist
    await expect(async () => {
      if (!(await liveRegion.textContent())?.includes('Position 2 von 3')) await page.keyboard.press('ArrowDown')
      await expect(liveRegion).toContainText('ist jetzt auf Position 2 von 3', { timeout: 700 })
    }).toPass({ timeout: 10_000 })
    await page.keyboard.press('Space')
    await expect(liveRegion).toContainText('auf Position 2 von 3 abgelegt')
    await expect.poll(() => productNames(page, festival.id)).toEqual(['Festzeichen', 'Brotzeit', 'Festschrift'])
    await expect.poll(() => uiProductOrder(page)).toEqual(['Festzeichen', 'Brotzeit', 'Festschrift'])

    // Sortieren per Maus (Drag-and-drop am Griff)
    const from = await row(page, 'Festschrift').getByRole('button', { name: /verschieben/ }).boundingBox()
    const to = await row(page, 'Festzeichen').boundingBox()
    expect(from && to).toBeTruthy()
    await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2)
    await page.mouse.down()
    await page.mouse.move(from!.x + from!.width / 2, from!.y - 10, { steps: 5 })
    await page.mouse.move(from!.x + from!.width / 2, to!.y + 4, { steps: 10 })
    await page.mouse.up()
    await expect.poll(() => productNames(page, festival.id)).toEqual(['Festschrift', 'Festzeichen', 'Brotzeit'])
    await page.mouse.move(1, 1)

    // Deaktivieren (ausgegraut + Badge) und wieder aktivieren
    await row(page, 'Festschrift').getByRole('button', { name: '„Festschrift“ deaktivieren' }).click()
    await expect(row(page, 'Festschrift')).toHaveAttribute('data-active', 'false')
    await expect(row(page, 'Festschrift').getByText('inaktiv')).toBeVisible()
    expect((await invoke(page, 'products.list', festival.id, { activeOnly: true })).map((p) => p.name)).toEqual([
      'Festzeichen',
      'Brotzeit'
    ])

    // Löschen mit Bestätigung
    await row(page, 'Brotzeit').getByRole('button', { name: '„Brotzeit“ löschen' }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toContainText('„Brotzeit“ löschen?')
    await confirm.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(row(page, 'Brotzeit')).toBeVisible()
    await row(page, 'Brotzeit').getByRole('button', { name: '„Brotzeit“ löschen' }).click()
    await confirm.getByRole('button', { name: 'Löschen' }).click()
    await expect(row(page, 'Brotzeit')).toHaveCount(0)
    expect(await productNames(page, festival.id)).toEqual(['Festschrift', 'Festzeichen'])

    // Schmale Breite: Aktionen im „…“-Menü
    await setWindowSize(ctx!.app, ...VIEWPORTS.min, page)
    await row(page, 'Festschrift').getByRole('button', { name: 'Aktionen für „Festschrift“' }).click()
    await expect(page.getByRole('menuitem', { name: 'Aktivieren' })).toBeVisible()
    await screenshot(page, 'fest-produkte-menu-min', { hideToasts: true })
    await page.getByRole('menuitem', { name: 'Nach unten' }).click()
    await expect.poll(() => productNames(page, festival.id)).toEqual(['Festzeichen', 'Festschrift'])
    await row(page, 'Festschrift').getByRole('button', { name: 'Aktionen für „Festschrift“' }).click()
    await page.getByRole('menuitem', { name: 'Aktivieren' }).click()
    await expect(row(page, 'Festschrift')).toHaveAttribute('data-active', 'true')
    await setWindowSize(ctx!.app, ...VIEWPORTS.laptop, page)
  })

  test('Zahlarten: Text, Frist und Standard ändern, Beispielanzeige', async () => {
    const { page } = ctx!
    await gotoRoute(page, '/fest/zahlarten')
    const transfer = page.getByTestId('payment-card-ueberweisung')
    await expect(transfer).toBeVisible()
    await expect(page.getByTestId('payment-example-ueberweisung')).toContainText('670,20 €')
    await expect(page.getByTestId('save-bar')).toHaveAttribute('data-dirty', 'false')

    const editor = page.getByRole('textbox', { name: 'Zahlungstext Überweisung' })
    await editor.click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('Bitte bis zum {Fälligkeitsdatum_DE} auf das Vereinskonto überweisen.')
    await transfer.getByLabel('Zahlungsfrist').fill('14')
    await transfer.getByLabel('Anzeigename').fill('Banküberweisung')
    await page.getByRole('radio', { name: 'Überweisung als Standard vorauswählen' }).click()

    const example = page.getByTestId('payment-example-ueberweisung')
    await expect(example).toContainText('Bitte bis zum')
    await expect(example).toContainText(/\d{2}\.\d{2}\.\d{4}/)
    await expect(example).not.toContainText('{Fälligkeitsdatum_DE}')
    await expect(page.getByTestId('save-bar')).toHaveAttribute('data-dirty', 'true')

    await page.getByRole('button', { name: 'Speichern' }).click()
    await expect(page.getByText('Zahlarten gespeichert.')).toBeVisible()
    await expect(page.getByTestId('save-bar')).toHaveAttribute('data-dirty', 'false')

    const methods = await invoke(page, 'paymentMethods.list', festival.id)
    const bar = methods.find((m) => m.kind === 'bar')!
    const ueb = methods.find((m) => m.kind === 'ueberweisung')!
    expect(ueb).toMatchObject({ label: 'Banküberweisung', dueDays: 14, isDefault: true })
    expect(ueb.text).toContain('Bitte bis zum')
    expect(ueb.text).toContain('Fälligkeitsdatum_DE')
    expect(bar.isDefault).toBe(false)

    // Validierung: leerer Anzeigename
    await page.getByTestId('payment-card-bar').getByLabel('Anzeigename').fill('')
    await expect(page.getByText('Bitte einen Anzeigenamen angeben.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Speichern' })).toBeDisabled()
    await page.getByRole('button', { name: /verwerfen/i }).click()
    await expect(page.getByTestId('payment-card-bar').getByLabel('Anzeigename')).toHaveValue('Bar')
  })

  test('Nummern: Live-Vorschau, Speichern und Präfix-Warnung', async () => {
    const { page } = ctx!
    await invoke(page, 'festivals.create', {
      name: 'Nachbarfest 2026',
      festivalDate: '2026-07-01',
      numberPrefix: '2026-',
      numberStart: 1,
      numberDigits: 3
    })
    await gotoRoute(page, '/fest/nummern', { reload: true })
    const preview = page.getByTestId('number-preview')
    await expect(preview).toContainText('2025-001')

    await page.getByLabel('Startnummer').fill('81')
    await expect(preview).toContainText('2025-081')
    await expect(preview).toContainText('2025-082')
    await page.getByLabel('Stellenzahl').fill('4')
    await expect(preview).toContainText('2025-0081')
    await page.getByLabel('Stellenzahl').fill('11')
    await expect(page.getByText('Die Stellenzahl muss zwischen 1 und 10 liegen.')).toBeVisible()
    await page.getByLabel('Stellenzahl').fill('3')

    await expect(page.getByTestId('prefix-conflict')).toHaveCount(0)
    await page.getByLabel('Präfix').fill('2026-')
    await expect(page.getByTestId('prefix-conflict')).toContainText('„Nachbarfest 2026“')
    await page.getByLabel('Präfix').fill('2025-')
    await expect(page.getByTestId('prefix-conflict')).toHaveCount(0)

    // Speichern per Tastenkürzel
    await page.keyboard.press('ControlOrMeta+S')
    await expect(page.getByText('Nummernkreis gespeichert.')).toBeVisible()
    expect(await invoke(page, 'festivals.get', festival.id)).toMatchObject({
      numberPrefix: '2025-',
      numberStart: 81,
      numberNext: 81,
      numberDigits: 3
    })
    await expect(page.getByLabel('Startnummer')).toBeEnabled()
  })

  test('Allgemein: Einstellungen, Steuerbefreiung und Dateinamensmuster', async () => {
    const { page } = ctx!
    await gotoRoute(page, '/fest/allgemein')
    await expect(page.getByTestId('filename-example')).toContainText('2025-081.pdf')

    await page.getByLabel('Kopien pro Druck').fill('3')
    await page.getByLabel('Steuerbefreiung (Kleinunternehmer)').click()
    await expect(page.getByLabel('Hinweistext auf der Rechnung')).toHaveCount(0)
    await page.getByLabel('Steuerbefreiung (Kleinunternehmer)').click()
    await expect(page.getByLabel('Hinweistext auf der Rechnung')).toHaveValue(/§ 19 UStG/)

    const pattern = page.getByLabel('Dateinamensmuster')
    await pattern.fill('Rechnung')
    await expect(page.getByText(/muss \{Rechnungsnummer\} enthalten/)).toBeVisible()
    await expect(page.getByTestId('filename-example')).toContainText('–')
    await pattern.fill('{Rechnungsnummer} ')
    await pattern.press('End')
    await page.getByRole('button', { name: 'Feld einfügen' }).click()
    await page.getByRole('menuitem', { name: /^Verein/ }).click()
    await expect(pattern).toHaveValue('{Rechnungsnummer} {Verein}')
    await expect(page.getByTestId('filename-example')).toContainText('2025-081 Radsportverein Beispielhausen.pdf')

    await page.getByLabel('Steuerbefreiung (Kleinunternehmer)').click()
    await page.getByRole('button', { name: 'Speichern' }).click()
    await expect(page.getByText('Einstellungen gespeichert.')).toBeVisible()
    expect(await invoke(page, 'festivals.get', festival.id)).toMatchObject({
      copies: 3,
      taxExempt: false,
      filenamePattern: '{Rechnungsnummer} {Verein}'
    })
    await expect(page.getByTestId('save-bar')).toHaveAttribute('data-dirty', 'false')

    // Name leeren → Fehlermeldung, nichts gespeichert
    await page.getByLabel('Name des Fests').fill('')
    await page.getByRole('button', { name: 'Speichern' }).click()
    await expect(page.getByText('Bitte einen Namen für das Fest angeben.')).toBeVisible()
    await page.getByRole('button', { name: /verwerfen/i }).click()
    await expect(page.getByLabel('Name des Fests')).toHaveValue('Testfest 2025')
    expect((await invoke(page, 'festivals.get', festival.id)).name).toBe('Testfest 2025')
  })

  test('Sperren nach dem ersten Beleg: Startnummer und Löschen verwendeter Produkte', async () => {
    const { page } = ctx!
    await gotoRoute(page, '/fest/nummern')
    await screenshot(page, 'fest-nummern-offen-laptop', { hideToasts: true })
    const festzeichen = (await invoke(page, 'products.list', festival.id)).find((p) => p.name === 'Festzeichen')!
    await insertInvoiceViaSql(ctx!, festival.id, festzeichen.id)

    await gotoRoute(page, '/fest/nummern', { reload: true })
    await expect(page.getByLabel(/^Startnummer/)).toBeDisabled()
    await expect(page.getByTestId('number-locked')).toContainText('2025-082')
    await expect(page.getByTestId('number-preview')).toContainText('2025-082')
    await expect(page.getByText('Gesperrt, es gibt bereits Rechnungen.')).toBeVisible()
    await screenshot(page, 'fest-nummern-gesperrt-laptop', { hideToasts: true })
    // Main-Prozess lehnt die Änderung ebenfalls ab
    const startError = await page.evaluate(
      (id) => window.festbuero.invoke('festivals.update', id, { numberStart: 1 }).then(() => null, (e: Error) => e.message),
      festival.id
    )
    expect(startError).toContain('Die Startnummer kann nicht mehr geändert werden')

    await gotoRoute(page, '/fest/produkte')
    const used = row(page, 'Festzeichen')
    await expect(used.getByRole('button', { name: '„Festzeichen“ löschen' })).toHaveCount(0)
    const lockedDelete = used.getByLabel(/„Festzeichen“ löschen nicht möglich/)
    await lockedDelete.hover()
    await expect(page.getByRole('tooltip')).toContainText('kann nur deaktiviert werden')
    await screenshot(page, 'fest-produkte-verwendet-laptop', { hideToasts: true })
    await page.mouse.move(1, 1)
    const deleteError = await page.evaluate(
      (id) => window.festbuero.invoke('products.delete', id).then(() => null, (e: Error) => e.message),
      festzeichen.id
    )
    expect(deleteError).toContain('„Festzeichen“ wurde bereits in Rechnungen verwendet und kann nur deaktiviert werden.')

    // schmal: Löschen im „…“-Menü deaktiviert, Deaktivieren angeboten
    await setWindowSize(ctx!.app, ...VIEWPORTS.min, page)
    await used.getByRole('button', { name: 'Aktionen für „Festzeichen“' }).click()
    await expect(page.getByRole('menuitem', { name: /Löschen/ })).toBeDisabled()
    await expect(page.getByRole('menuitem', { name: /Löschen/ })).toContainText('nur deaktivierbar')
    await expect(page.getByRole('menuitem', { name: 'Deaktivieren' })).toBeEnabled()
    await screenshot(page, 'fest-produkte-verwendet-menu-min', { hideToasts: true })
    await page.keyboard.press('Escape')
    await setWindowSize(ctx!.app, ...VIEWPORTS.laptop, page)
  })

  test('Fest kopieren über das Menü und zum neuen Fest wechseln', async () => {
    const { page } = ctx!
    await gotoRoute(page, '/festbuero')
    await clickMenuItem(ctx!, 'festival.copy')
    const dialog = page.getByTestId('copy-festival-dialog')
    await expect(dialog).toBeVisible()
    await expect(page).toHaveURL(/#\/fest\/allgemein/)
    await expect(dialog.getByLabel('Name des neuen Fests')).toHaveValue('Testfest 2026')
    await expect(dialog.getByLabel('Festdatum')).toHaveValue('2026-06-01')
    await expect(dialog.getByLabel('Präfix')).toHaveValue('2026-')
    await expect(dialog.getByText(/nutzt auch „Nachbarfest 2026“/)).toBeVisible()
    await screenshot(page, 'fest-kopieren-dialog-laptop', { hideToasts: true })

    await dialog.getByLabel('Präfix').fill('2026-T-')
    await expect(dialog.getByText(/nutzt auch/)).toHaveCount(0)
    await expect(dialog).toContainText('2026-T-001')
    await dialog.getByRole('button', { name: 'Fest kopieren' }).click()
    await expect(dialog.getByRole('heading', { name: 'Fest kopiert' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Zum neuen Fest wechseln' })).toBeFocused()
    await screenshot(page, 'fest-kopieren-erfolg-laptop', { hideToasts: true })

    const all = await invoke(page, 'festivals.list', { includeArchived: true })
    const copy = all.find((f) => f.name === 'Testfest 2026')!
    expect(copy).toMatchObject({
      numberPrefix: '2026-T-',
      numberStart: 1,
      numberNext: 1,
      copies: 3,
      taxExempt: false,
      hasInvoices: false
    })
    expect(await invoke(page, 'invoices.list', copy.id).catch(() => [])).toHaveLength(0)
    expect(await productNames(page, copy.id)).toEqual(['Festzeichen', 'Festschrift'])
    const methods = await invoke(page, 'paymentMethods.list', copy.id)
    expect(methods.find((m) => m.isDefault)?.label).toBe('Banküberweisung')
    // Menü „Fest“ kennt das neue Fest
    await expect.poll(() => menuHasItem(ctx!, `festival:${copy.id}`)).toBe(true)

    await page.keyboard.press('Enter')
    await expect(dialog).toBeHidden()
    await expect(page.getByTestId('festival-switcher')).toContainText('Testfest 2026')
    await expect(page.getByLabel('Name des Fests')).toHaveValue('Testfest 2026')
  })

  test('Archivieren und wiederherstellen', async () => {
    const { page } = ctx!
    const all = await invoke(page, 'festivals.list', { includeArchived: true })
    const copy = all.find((f) => f.name === 'Testfest 2026')!

    await page.getByRole('button', { name: 'Archivieren …' }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toContainText('„Testfest 2026“ archivieren?')
    await expect(confirm).toContainText('Danach ist „Nachbarfest 2026“ das aktive Fest.')
    await screenshot(page, 'fest-archivieren-dialog-laptop', { hideToasts: true })
    await confirm.getByRole('button', { name: 'Archivieren' }).click()
    await expect(confirm).toBeHidden()

    await expect(page.getByTestId('festival-switcher')).toContainText('Nachbarfest 2026')
    expect((await invoke(page, 'festivals.get', copy.id)).archived).toBe(true)
    expect((await invoke(page, 'festivals.list')).map((f) => f.name)).not.toContain('Testfest 2026')
    await expect.poll(() => menuHasItem(ctx!, `festival:${copy.id}`)).toBe(false)

    const archivedList = page.getByRole('list', { name: 'Archivierte Feste' })
    await expect(archivedList).toContainText('Testfest 2026')
    await archivedList.getByRole('button', { name: '„Testfest 2026“ wiederherstellen' }).click()
    await expect(page.getByText('Keine archivierten Feste.')).toBeVisible()
    expect((await invoke(page, 'festivals.get', copy.id)).archived).toBe(false)
    await expect.poll(() => menuHasItem(ctx!, `festival:${copy.id}`)).toBe(true)
    // aktives Fest bleibt, Wechsel wird nur angeboten
    await expect(page.getByTestId('festival-switcher')).toContainText('Nachbarfest 2026')
    expect(await invoke(page, 'festivals.list')).toHaveLength(3)
  })

  test('alle Seiten bei allen Größen, hell und dunkel', async () => {
    const { page, app } = ctx!
    // Ausgangsfest mit allen Musterprodukten (eins inaktiv, ein sehr langer Name)
    const existing = await productNames(page, festival.id)
    for (const line of SAMPLE_PRODUCTS) {
      if (existing.includes(line.name)) continue
      await invoke(page, 'products.create', festival.id, {
        name: line.name,
        priceCents: line.priceCents,
        vatRate: line.vatRate,
        mode: line.name === 'Festschrift' ? 'feste_anzahl' : 'pro_person',
        defaultQuantity: 1,
        active: line.name !== 'Korsoeinsatz'
      })
    }
    await invoke(page, 'products.create', festival.id, {
      name: 'Alkoholfreies Getränk nach Wahl – Spezi, Apfelschorle, Wasser oder Limonade (0,5 l Flasche)',
      priceCents: 380,
      vatRate: 19,
      mode: 'feste_anzahl',
      defaultQuantity: 0
    })
    await clickMenuItem(ctx!, `festival:${festival.id}`)
    await expect(page.getByTestId('festival-switcher')).toContainText('Testfest 2025')
    // frischer Query-Cache (Produkte wurden direkt über IPC angelegt)
    await gotoRoute(page, '/fest/allgemein', { reload: true })

    for (const name of PAGES) {
      await gotoRoute(page, `/fest/${name}`)
      await page.waitForFunction(
        () => !document.querySelector('[data-slot="skeleton"]') && document.querySelector('main h1') !== null,
        undefined,
        POLL
      )
      for (const vp of Object.keys(VIEWPORTS) as ViewportName[]) {
        const [w, h] = VIEWPORTS[vp]
        await setWindowSize(app, w, h, page)
        await page.mouse.move(1, 1)
        await scrollContentTop(page)
        await expectNoHorizontalOverflow(page)
        await screenshot(page, `fest-${name}-${vp}`, { hideToasts: true })
      }
    }

    // Allgemein bei kleinster Größe: ungespeicherte Änderung → Speichern-Leiste klebt unten; Seitenende
    await setWindowSize(app, ...VIEWPORTS.min, page)
    await gotoRoute(page, '/fest/allgemein')
    await page.getByLabel('Kopien pro Druck').fill('4')
    await expect(page.getByTestId('save-bar')).toHaveAttribute('data-dirty', 'true')
    await expect(page.getByTestId('save-bar')).toBeInViewport()
    await screenshot(page, 'fest-allgemein-dirty-min', { hideToasts: true })
    await page.getByRole('button', { name: /verwerfen/i }).click()
    await page.getByRole('heading', { name: 'Archivierte Feste' }).scrollIntoViewIfNeeded()
    await screenshot(page, 'fest-allgemein-unten-min', { hideToasts: true })
    await gotoRoute(page, '/fest/zahlarten')
    await page.getByTestId('payment-card-bar').getByLabel('Zahlungsfrist').fill('10')
    await expect(page.getByTestId('save-bar')).toBeInViewport()
    await screenshot(page, 'fest-zahlarten-dirty-min', { hideToasts: true })
    await page.getByRole('button', { name: /verwerfen/i }).click()

    // Dialoge bei kleinster Größe
    await gotoRoute(page, '/fest/produkte')
    await page.getByRole('button', { name: 'Neues Produkt' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await screenshot(page, 'fest-produkt-dialog-min', { hideToasts: true })
    await page.keyboard.press('Escape')
    await gotoRoute(page, '/fest/allgemein')
    await page.getByRole('button', { name: 'Fest kopieren …' }).click()
    await expect(page.getByTestId('copy-festival-dialog')).toBeVisible()
    await screenshot(page, 'fest-kopieren-dialog-min', { hideToasts: true })
    await page.keyboard.press('Escape')

    // Dunkelmodus: jede Seite (laptop + min)
    await setTheme(page, 'dark')
    for (const name of PAGES) {
      await gotoRoute(page, `/fest/${name}`)
      for (const vp of ['laptop', 'min'] as const) {
        const [w, h] = VIEWPORTS[vp]
        await setWindowSize(app, w, h, page)
        await page.mouse.move(1, 1)
        await scrollContentTop(page)
        await expectNoHorizontalOverflow(page)
        await screenshot(page, `fest-${name}-dark-${vp}`, { hideToasts: true })
      }
    }
    await gotoRoute(page, '/fest/produkte')
    await page.getByRole('button', { name: 'Neues Produkt' }).click()
    await screenshot(page, 'fest-produkt-dialog-dark-min', { hideToasts: true })
    await page.keyboard.press('Escape')
    await setTheme(page, 'light')
    await dismissToasts(page)
  })

  test('App sauber beenden, keine Absturzberichte', async () => {
    const current = ctx!
    ctx = null
    await closeApp(current)
    await new Promise((r) => setTimeout(r, 3000))
    expect(countCrashReports()).toBe(crashesBefore)
  })
})
