/**
 * E2E: Vereinsstamm (/fest/vereine) – Import mit Vorschau, erneuter Import, manuelle Vereine,
 * Anlegen/Bearbeiten/Löschen, Suche, Anmelde-Vorlage. Alle vier Fenstergrößen, hell und dunkel.
 *
 *   FESTBUERO_OUT_DIR=out/vereine npm run test:e2e -- tests/e2e/vereine.spec.ts
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator } from '@playwright/test'
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
  stubDialogs,
  VIEWPORTS,
  type AppContext,
  type ViewportName
} from './helpers'

const FIXTURES = join(PROJECT_ROOT, 'tests', 'fixtures')
const BEISPIEL = join(FIXTURES, 'vereine-beispiel.xlsx')
const FEHLER = join(FIXTURES, 'vereine-fehler.xlsx')
const OHNE_PFLICHT = join(FIXTURES, 'vereine-ohne-pflichtspalte.xlsx')
const VIEWPORT_NAMES = Object.keys(VIEWPORTS) as ViewportName[]

test.describe.serial('Vereine: Vereinsstamm, Excel-Import, Anmelde-Vorlage', () => {
  let ctx: AppContext | null = null
  let festivalId = 0
  let crashReportsBefore = 0

  const page = () => ctx!.page
  const rows = () => page().getByTestId('club-row')
  const row = (name: string) => rows().filter({ has: page().getByTestId('club-name').getByText(name, { exact: true }) })
  const toast = (text: string | RegExp) => page().locator('[data-sonner-toast]').filter({ hasText: text }).first()

  async function clickMenuItem(id: string) {
    const found = await ctx!.app.evaluate(({ Menu }, itemId) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById(itemId)
      if (!item) return false
      item.click()
      return true
    }, id)
    expect(found, `Menüeintrag ${id}`).toBe(true)
  }

  async function resize(vp: ViewportName) {
    const [w, h] = VIEWPORTS[vp]
    await setWindowSize(ctx!.app, w, h, page())
  }

  /** Alle vier Größen: kein horizontaler Overflow + Screenshot; danach wieder Laptop-Größe. */
  async function checkAllViewports(name: string, visible?: Locator) {
    for (const vp of VIEWPORT_NAMES) {
      await resize(vp)
      if (visible) await expect(visible).toBeVisible()
      await expectNoHorizontalOverflow(page())
      await screenshot(page(), `${name}-${vp}`, { hideToasts: true })
    }
    await resize('laptop')
  }

  async function openImport(file: string | null, via: 'button' | 'menu' = 'menu') {
    await stubDialogs(ctx!.app, { open: file ? [file] : null })
    if (via === 'menu') await clickMenuItem('clubs.import')
    else await page().getByRole('button', { name: 'Aus Excel importieren' }).click()
  }

  const importDialog = () => page().getByRole('dialog', { name: 'Vereine importieren' })

  /**
   * Legt eine abgeschlossene Rechnung für einen Verein direkt in der Datenbank an (Rechnungen erstellt
   * ein anderer Bereich). Läuft im Main-Prozess, damit better-sqlite3 mit Electrons ABI geladen wird.
   */
  async function insertInvoiceForClub(clubId: number, clubName: string, number: string) {
    await ctx!.app.evaluate(
      (_electron, a) => {
        const builtin = (process as unknown as { mainModule: NodeJS.Module }).mainModule.require
        const { createRequire } = builtin('node:module') as typeof import('node:module')
        const Database = createRequire(a.packageJson)('better-sqlite3') as new (path: string) => {
          prepare(sql: string): { run(...params: unknown[]): unknown }
          pragma(sql: string): unknown
          close(): void
        }
        const db = new Database(a.dbPath)
        db.pragma('busy_timeout = 5000')
        db.prepare(
          `INSERT INTO invoice (festival_id, number, seq, type, status, customer_kind, club_id, customer_json, persons,
             payment_kind, payment_label, payment_text, due_days, invoice_date, service_date, due_date,
             total_gross_cents, total_net_cents, total_vat_cents, totals_json, tax_exempt, tax_exempt_text,
             festival_name, template_json, created_at)
           VALUES (?, ?, 1, 'rechnung', 'abgeschlossen', 'verein', ?, ?, 10, 'bar', 'Bar', '', 7, '2025-06-01',
             '2025-06-01', '2025-06-08', 1000, 1000, 0, '{}', 1, '', 'Testfest 2025', '{}', ?)`
        ).run(
          a.festivalId,
          a.number,
          a.clubId,
          JSON.stringify({ kind: 'verein', clubId: a.clubId, clubName: a.clubName }),
          new Date().toISOString()
        )
        db.close()
      },
      {
        dbPath: join(ctx!.userDataDir, 'festbuero.sqlite'),
        packageJson: join(PROJECT_ROOT, 'package.json'),
        festivalId,
        clubId,
        clubName,
        number
      }
    )
  }

  test.beforeAll(async () => {
    crashReportsBefore = countCrashReports()
    ctx = await launchApp({ viewport: 'laptop' })
    const festival = await prepareFestival(ctx.page, { route: '/fest/vereine' })
    festivalId = festival.id
  })

  test.beforeEach(async () => {
    if (ctx) await dismissToasts(ctx.page)
  })

  test.afterAll(async () => {
    if (ctx) await closeApp(ctx)
    ctx = null
  })

  test('Leerzustand mit Erklärung und beiden Buttons', async () => {
    const empty = page().getByTestId('clubs-empty')
    await expect(empty).toBeVisible()
    await expect(empty.getByRole('button', { name: 'Aus Excel importieren' })).toBeVisible()
    await expect(empty.getByRole('button', { name: 'Anmelde-Vorlage exportieren' })).toBeVisible()
    await expect(empty.getByRole('button', { name: /einzeln anlegen/ })).toBeVisible()
    await checkAllViewports('vereine-leer', empty)
  })

  test('Abbrechen im Dateidialog öffnet keine Vorschau', async () => {
    await openImport(null, 'button')
    await page().waitForTimeout(300)
    await expect(importDialog()).toHaveCount(0)
  })

  test('Import mit Vorschau', async () => {
    await openImport(BEISPIEL, 'button')
    const dialog = importDialog()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('club-import-file')).toHaveText('vereine-beispiel.xlsx')
    await expect(dialog.getByTestId('club-import-sheet')).toHaveText('Blatt „Übersicht“ · Kopfzeile in Zeile 1')
    const stats = dialog.getByTestId('club-import-stats')
    await expect(stats).toContainText('Zeilen gesamt16')
    await expect(stats).toContainText('Gültig15')
    await expect(stats).toContainText('Fehlerhaft1')
    const errors = dialog.getByTestId('club-import-errors')
    await expect(errors).toContainText('Zeile 18')
    await expect(errors).toContainText('Vereinsname fehlt.')
    await expect(dialog.getByTestId('club-import-replace')).toContainText('Es werden 15 Vereine aus der Datei importiert.')
    await expect(dialog.getByTestId('club-import-submit')).toHaveText('15 Vereine importieren')

    await checkAllViewports('vereine-import-vorschau', dialog.getByTestId('club-import-submit'))

    // erster Import ersetzt nichts → keine zusätzliche Bestätigung
    await dialog.getByTestId('club-import-submit').click()
    await expect(toast('15 Vereine importiert')).toBeVisible()
    await expect(importDialog()).toHaveCount(0)
    await expect(rows()).toHaveCount(15)
    await expect(page().getByTestId('club-summary')).toHaveText('15 Vereine · 377 angemeldete Personen')
    await expect(row('Schützenverein Testingen e.V.')).toContainText('01234 Testingen')
  })

  test('Liste bei allen Größen, hell und dunkel', async () => {
    // Spalten je nach Breite
    await resize('min')
    await expect(page().getByRole('columnheader', { name: 'Ansprechpartner' })).toBeHidden()
    await expect(page().getByRole('button', { name: 'Aktionen für „FF Musterdorf“' })).toBeVisible()
    await resize('large')
    await expect(page().getByRole('columnheader', { name: 'Ansprechpartner' })).toBeVisible()
    await expect(page().getByRole('columnheader', { name: 'Status' })).toBeVisible()
    await expect(page().getByRole('button', { name: '„FF Musterdorf“ bearbeiten' })).toBeVisible()
    await resize('laptop')

    await checkAllViewports('vereine-liste', page().getByTestId('club-table'))
    await setTheme(page(), 'dark')
    await checkAllViewports('vereine-liste-dunkel', page().getByTestId('club-table'))
    await setTheme(page(), 'light')
  })

  test('Verein anlegen (mit Prüfung der Eingaben)', async () => {
    await page().getByRole('button', { name: 'Verein anlegen' }).click()
    const dialog = page().getByRole('dialog', { name: 'Verein anlegen' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Verein')).toBeFocused()

    // Pflichtfeld und ungültige Personenzahl
    await dialog.getByLabel('Angemeldete Personen').fill('ca. 5')
    await dialog.getByRole('button', { name: 'Verein anlegen' }).click()
    await expect(dialog.getByText('Bitte den Vereinsnamen angeben.')).toBeVisible()
    await expect(dialog.getByLabel('Verein')).toBeFocused()
    await dialog.getByLabel('Verein').fill('SV Handeingabe')
    await dialog.getByRole('button', { name: 'Verein anlegen' }).click()
    await expect(dialog.getByText(/ganze Zahl ab 0/)).toBeVisible()

    await dialog.getByLabel('Ansprechpartner (Name)').fill('Hanna Hand')
    await dialog.getByLabel('Straße').fill('Handweg 3')
    await dialog.getByLabel('PLZ').fill('01099')
    await dialog.getByLabel('Ort').fill('Testingen')
    await dialog.getByLabel('Angemeldete Personen').fill('12')
    await checkAllViewports('vereine-dialog-anlegen', dialog)
    // Enter speichert
    await dialog.getByLabel('Angemeldete Personen').press('Enter')
    await expect(toast('Verein „SV Handeingabe“ angelegt')).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(rows()).toHaveCount(16)
    await expect(row('SV Handeingabe')).toContainText('Manuell')
    await expect(row('SV Handeingabe')).toContainText('01099 Testingen')

    // zweiter manueller Verein mit gleichem Namen wie ein importierter → Hinweis im Dialog
    await page().getByRole('button', { name: 'Verein anlegen' }).click()
    const second = page().getByRole('dialog', { name: 'Verein anlegen' })
    await second.getByLabel('Verein').fill('ff musterdorf')
    await expect(second.getByText(/ist bereits vorhanden/)).toBeVisible()
    await second.getByLabel('Angemeldete Personen').fill('3')
    await second.getByRole('button', { name: 'Verein anlegen' }).click()
    await expect(toast('Verein „ff musterdorf“ angelegt')).toBeVisible()
    await expect(rows()).toHaveCount(17)
  })

  test('Verein bearbeiten', async () => {
    await page().getByRole('button', { name: '„SV Handeingabe“ bearbeiten' }).click()
    const dialog = page().getByRole('dialog', { name: 'Verein bearbeiten' })
    await expect(dialog.getByLabel('Verein')).toHaveValue('SV Handeingabe')
    await expect(dialog.getByLabel('PLZ')).toHaveValue('01099')
    const persons = dialog.getByLabel('Angemeldete Personen')
    await persons.focus()
    await persons.press('ArrowUp')
    await persons.press('ArrowUp')
    await expect(persons).toHaveValue('14')
    await dialog.getByRole('button', { name: 'Speichern' }).click()
    await expect(toast('Änderungen an „SV Handeingabe“ gespeichert')).toBeVisible()
    await expect(row('SV Handeingabe').getByTestId('club-persons')).toHaveText('14')

    // Doppelklick öffnet ebenfalls den Dialog; Escape schließt ohne Änderung
    await row('FF Musterdorf').dblclick()
    const imported = page().getByRole('dialog', { name: 'Verein bearbeiten' })
    await expect(imported.getByText(/stammt aus dem Excel-Import/)).toBeVisible()
    await page().keyboard.press('Escape')
    await expect(imported).toBeHidden()
  })

  test('Erneuter Import ersetzt importierte Vereine, manueller Verein bleibt', async () => {
    await openImport(BEISPIEL, 'menu')
    const dialog = importDialog()
    const replace = dialog.getByTestId('club-import-replace')
    await expect(replace).toContainText('Die 15 bisher importierten Vereine werden durch 15 Vereine aus der Datei ersetzt.')
    await expect(replace).toContainText('ff musterdorf')
    await dialog.getByTestId('club-import-submit').click()

    const confirm = page().getByRole('alertdialog', { name: 'Vereinsstamm ersetzen?' })
    await expect(confirm).toBeVisible()
    await expect(confirm).toContainText('ff musterdorf')
    for (const vp of ['min', 'large'] as const) {
      await resize(vp)
      await expectNoHorizontalOverflow(page())
      await screenshot(page(), `vereine-import-bestaetigen-${vp}`, { hideToasts: true })
    }
    await resize('laptop')
    await confirm.getByRole('button', { name: 'Ersetzen und importieren' }).click()

    await expect(toast('15 Vereine importiert')).toBeVisible()
    await expect(toast('16 bisherige Vereine ersetzt · 1 fehlerhafte Zeile übersprungen')).toBeVisible()
    await expect(rows()).toHaveCount(16)
    await expect(row('SV Handeingabe')).toContainText('Manuell')
    await expect(row('SV Handeingabe').getByTestId('club-persons')).toHaveText('14')
    await expect(row('ff musterdorf')).toHaveCount(0)
    await expect(row('FF Musterdorf')).toContainText('Import')

    const clubs = await invoke(page(), 'clubs.list', festivalId)
    expect(clubs.filter((c) => c.source === 'manual').map((c) => c.clubName)).toEqual(['SV Handeingabe'])
  })

  test('Rechnung vorhanden: Badge und Hinweis beim Löschen', async () => {
    const ff = (await invoke(page(), 'clubs.list', festivalId)).find((c) => c.clubName === 'FF Musterdorf')!
    await insertInvoiceForClub(ff.id, ff.clubName, '2025-001')
    await gotoRoute(page(), '/fest/vereine', { reload: true })
    await expect(row('FF Musterdorf')).toContainText('Rechnung vorhanden')
    await expect(page().getByTestId('club-summary')).toContainText('1 mit Rechnung')
    for (const vp of ['min', 'large'] as const) {
      await resize(vp)
      await row('FF Musterdorf').scrollIntoViewIfNeeded()
      await expect(row('FF Musterdorf').getByText(/Rechnung/).filter({ visible: true })).toHaveCount(1)
      await expectNoHorizontalOverflow(page())
      await screenshot(page(), `vereine-rechnung-${vp}`, { hideToasts: true })
    }
    await resize('laptop')
    await page().getByRole('button', { name: '„FF Musterdorf“ löschen' }).click()
    const confirm = page().getByRole('alertdialog', { name: 'Verein löschen?' })
    await expect(confirm).toContainText('Für diesen Verein gibt es bereits eine Rechnung.')
    await screenshot(page(), 'vereine-loeschen-rechnung-laptop', { hideToasts: true })
    await confirm.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(row('FF Musterdorf')).toHaveCount(1)
  })

  test('Fehlerhafte Datei: Fehlerzeilen und Hinweise in der Vorschau', async () => {
    await openImport(FEHLER, 'menu')
    const dialog = importDialog()
    await expect(dialog.getByTestId('club-import-sheet')).toHaveText('Blatt „Anmeldungen 2025“ · Kopfzeile in Zeile 3')
    await expect(dialog.getByTestId('club-import-stats')).toContainText('Zeilen gesamt9')
    await expect(dialog.getByTestId('club-import-stats')).toContainText('Gültig3')
    await expect(dialog.getByTestId('club-import-stats')).toContainText('Fehlerhaft6')
    const errors = dialog.getByTestId('club-import-errors')
    await expect(errors).toContainText('Zeile 5')
    await expect(errors).toContainText('Vereinsname fehlt.')
    await expect(errors).toContainText('Keine Zahl bei Personen („ca. 20“).')
    await expect(errors).toContainText('Doppelte Zeile: identisch mit Zeile 9.')
    await expect(dialog.getByTestId('club-import-warnings')).toContainText('steht mehrfach in der Datei')
    await expect(dialog.getByTestId('club-import-optional')).toHaveCount(0)
    for (const vp of ['min', 'large'] as const) {
      await resize(vp)
      await expectNoHorizontalOverflow(page())
      await screenshot(page(), `vereine-import-fehler-${vp}`, { hideToasts: true })
    }
    // Theme-Menü liegt hinter dem Dialog-Overlay → Theme direkt über die Einstellungen setzen
    await invoke(page(), 'app.updateSettings', { theme: 'dark' })
    await page().waitForFunction(() => document.documentElement.classList.contains('dark'), undefined, POLL)
    await screenshot(page(), 'vereine-import-fehler-dunkel-large', { hideToasts: true })
    await invoke(page(), 'app.updateSettings', { theme: 'light' })
    await page().waitForFunction(() => !document.documentElement.classList.contains('dark'), undefined, POLL)
    await resize('laptop')
    await dialog.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(dialog).toBeHidden()
    await expect(rows()).toHaveCount(16)
  })

  test('Fehlende Pflichtspalte: Import nicht möglich', async () => {
    await openImport(OHNE_PFLICHT, 'menu')
    const dialog = importDialog()
    await expect(dialog.getByTestId('club-import-missing')).toContainText('Pflichtspalte fehlt: ang. Personen')
    await expect(dialog.getByTestId('club-import-submit')).toBeDisabled()
    await resize('min')
    await expectNoHorizontalOverflow(page())
    await screenshot(page(), 'vereine-import-pflichtspalte-min', { hideToasts: true })
    await resize('laptop')
    await page().keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test('Suche (⌘F über das Menü), Sortierung', async () => {
    await clickMenuItem('search.focus')
    const search = page().getByTestId('club-search')
    await expect(search).toBeFocused()
    await search.pressSequentially('musterdorf')
    await expect(rows()).toHaveCount(1)
    await expect(page().getByTestId('club-summary')).toHaveText('1 von 16 Vereinen')
    await search.press('Escape')
    await expect(search).toHaveValue('')
    await expect(rows()).toHaveCount(16)

    await search.fill('01234')
    await expect(rows()).toHaveCount(1)
    await expect(rows().first()).toContainText('Schützenverein Testingen e.V.')
    await search.fill('xyz unbekannt')
    await expect(page().getByText('Keine Vereine für „xyz unbekannt“ gefunden.')).toBeVisible()
    await page().getByRole('button', { name: 'Suche zurücksetzen' }).click()
    await expect(rows()).toHaveCount(16)

    await page().getByRole('button', { name: 'Personen', exact: true }).click()
    await expect(rows().first().getByTestId('club-persons')).toHaveText('45')
    await page().getByRole('button', { name: 'Personen', exact: true }).click()
    await expect(rows().first().getByTestId('club-persons')).toHaveText('9')
    await page().getByRole('button', { name: 'Verein', exact: true }).click()
    await expect(rows().first().getByTestId('club-name')).toHaveText('Burschenverein Platzhalterau')
  })

  test('Löschen mit Bestätigung (schmales Fenster, „…“-Menü)', async () => {
    await resize('min')
    await row('SV Handeingabe').scrollIntoViewIfNeeded()
    await page().getByRole('button', { name: 'Aktionen für „SV Handeingabe“' }).click()
    await page().getByRole('menuitem', { name: 'Löschen' }).click()
    const confirm = page().getByRole('alertdialog', { name: 'Verein löschen?' })
    await expect(confirm).toContainText('„SV Handeingabe“ wird aus dem Vereinsstamm dieses Fests entfernt.')
    await expectNoHorizontalOverflow(page())
    await screenshot(page(), 'vereine-loeschen-min', { hideToasts: true })
    // Abbrechen lässt den Verein stehen
    await confirm.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(row('SV Handeingabe')).toHaveCount(1)

    await page().getByRole('button', { name: 'Aktionen für „SV Handeingabe“' }).click()
    await page().getByRole('menuitem', { name: 'Löschen' }).click()
    await page().getByRole('alertdialog', { name: 'Verein löschen?' }).getByRole('button', { name: 'Löschen' }).click()
    await expect(toast('Verein „SV Handeingabe“ gelöscht')).toBeVisible()
    await expect(rows()).toHaveCount(15)
    await resize('laptop')
  })

  test('Anmelde-Vorlage exportieren und wieder importieren', async () => {
    const emptyPath = join(ctx!.documentsDir, 'Anmeldung leer.xlsx')
    const filledPath = join(ctx!.documentsDir, 'Anmeldung vorausgefüllt.xlsx')

    // leere Vorlage über das Menü
    await stubDialogs(ctx!.app, { save: emptyPath })
    await clickMenuItem('clubs.exportTemplate')
    const dialog = page().getByRole('dialog', { name: 'Anmelde-Vorlage exportieren' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('switch', { name: 'Mit den aktuellen Vereinen vorausfüllen' })).not.toBeChecked()
    await checkAllViewports('vereine-vorlage-dialog', dialog)
    await dialog.getByRole('button', { name: 'Speichern unter …' }).click()
    await expect(toast('Anmelde-Vorlage gespeichert')).toBeVisible()
    await expect(dialog).toBeHidden()
    expect(existsSync(emptyPath)).toBe(true)
    const emptyPreview = await invoke(page(), 'clubs.previewImport', festivalId, emptyPath)
    expect(emptyPreview).toMatchObject({ sheetName: 'Anmeldungen', totalRows: 0, missingColumns: [], headerRow: 1 })
    expect(emptyPreview.missingOptionalColumns).toEqual([])

    // vorausgefüllte Vorlage über den Button
    await dismissToasts(page())
    await stubDialogs(ctx!.app, { save: filledPath })
    await page().getByRole('button', { name: 'Anmelde-Vorlage exportieren' }).click()
    await dialog.getByRole('switch', { name: 'Mit den aktuellen Vereinen vorausfüllen' }).click()
    await expect(dialog.getByRole('switch', { name: 'Mit den aktuellen Vereinen vorausfüllen' })).toBeChecked()
    await dialog.getByRole('button', { name: 'Speichern unter …' }).click()
    await expect(toast('Anmelde-Vorlage gespeichert')).toBeVisible()
    await expect(dialog).toBeHidden()
    expect(existsSync(filledPath)).toBe(true)

    // Rundreise über die Oberfläche: exportierte Datei importieren
    await openImport(filledPath, 'menu')
    const importer = importDialog()
    await expect(importer.getByTestId('club-import-stats')).toContainText('Gültig15')
    await expect(importer.getByTestId('club-import-stats')).toContainText('Fehlerhaft0')
    await expect(importer.getByTestId('club-import-errors')).toHaveCount(0)
    await importer.getByTestId('club-import-submit').click()
    await page().getByRole('alertdialog', { name: 'Vereinsstamm ersetzen?' }).getByRole('button', { name: 'Ersetzen und importieren' }).click()
    await expect(toast('15 Vereine importiert')).toBeVisible()
    await expect(rows()).toHaveCount(15)
    await expect(row('Schützenverein Testingen e.V.')).toContainText('01234 Testingen')
    // gleichnamiger Verein behält seine ID → „Rechnung vorhanden“ übersteht den erneuten Import
    await expect(row('FF Musterdorf')).toContainText('Rechnung vorhanden')
  })

  test('App sauber beenden, keine Absturzberichte', async () => {
    await closeApp(ctx!)
    ctx = null
    expect(countCrashReports()).toBe(crashReportsBefore)
  })
})
