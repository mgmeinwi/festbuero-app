/**
 * Beispiel-Fest zum Ausprobieren (Ersteinrichtung, App-Einstellungen).
 *
 * Legt ein Fest „Beispiel-Gründungsfest“ an mit
 * - den 8 Produkten der Beispielrechnung (Reihenfolge, Preise, Steuersätze, Modi),
 * - der Standard-Vorlage plus neutralem Muster-Logo und zwei neutralen Hinweistexten,
 * - ca. 12 ERFUNDENEN Vereinen (manuell angelegt, plausible Personenzahlen).
 *
 * Alle Daten sind Musterdaten (öffentliches Repository, siehe CLAUDE.md Regel 3).
 * Produkte, Vereine und Vorlage werden per eigenem SQL geschrieben (Schema: `db/migrations.ts`),
 * damit dieser Dienst nicht von den Diensten anderer Bereiche abhängt. Das Logo wird wie beim
 * Vorlagen-Logo inhaltsadressiert nach `<userData>/logos/<sha256>.<ext>` kopiert.
 */
import { createHash } from 'node:crypto'
import { copyFileSync, constants, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { addDays, todayIso } from '@shared/dates'
import { getDefaultTemplateConfig } from '@shared/invoice-render/default-template'
import type { ClubInput, Festival, ProductInput, RichTextBlock, TemplateConfig } from '@shared/types'
import { getDb, nowIso, type Db } from '../db/connection'
import { createFestival, getFestival } from './festivals'

export const SAMPLE_FESTIVAL_NAME = 'Beispiel-Gründungsfest'
export const SAMPLE_NUMBER_PREFIX = 'BSP-'
export const SAMPLE_LOGO_FILE_NAME = 'beispiel-logo.svg'

/** Die 8 Produkte der Beispielrechnung in dieser Reihenfolge (Prüfsumme 670,20 € mit 0/0/45/18/0/13/1/34). */
export const SAMPLE_PRODUCTS: readonly ProductInput[] = [
  { name: '1 Maß Bier (ohne Bedienung)', priceCents: 970, vatRate: 19, mode: 'feste_anzahl', defaultQuantity: 0 },
  { name: 'Brotzeit', priceCents: 800, vatRate: 7, mode: 'feste_anzahl', defaultQuantity: 0 },
  { name: 'Festzeichen', priceCents: 300, vatRate: 19, mode: 'pro_person', defaultQuantity: 0 },
  { name: 'Festessen', priceCents: 1450, vatRate: 7, mode: 'feste_anzahl', defaultQuantity: 0 },
  { name: 'Korsoeinsatz', priceCents: 200, vatRate: 19, mode: 'feste_anzahl', defaultQuantity: 0 },
  { name: 'Käsespätzle', priceCents: 1000, vatRate: 7, mode: 'feste_anzahl', defaultQuantity: 0 },
  { name: 'Festschrift', priceCents: 1500, vatRate: 7, mode: 'feste_anzahl', defaultQuantity: 1 },
  { name: 'Alkoholfreies Getränk (0,5l)', priceCents: 380, vatRate: 19, mode: 'feste_anzahl', defaultQuantity: 0 }
]

/** Erfundene Vereine (Musterdaten, keine echten Vereine oder Personen). */
export const SAMPLE_CLUBS: readonly ClubInput[] = [
  { clubName: 'Musterverein Beispielhausen e.V.', contactName: 'Max Mustermann', street: 'Musterstraße 1', zip: '12345', city: 'Beispielhausen', registeredPersons: 45 },
  { clubName: 'Trachtenverein Musterdorf', contactName: 'Erika Musterfrau', street: 'Am Dorfplatz 3', zip: '12346', city: 'Musterdorf', registeredPersons: 32 },
  { clubName: 'Schützengesellschaft Beispielstadt', contactName: 'Hans Beispiel', street: 'Schützenweg 7', zip: '12347', city: 'Beispielstadt', registeredPersons: 28 },
  { clubName: 'Freiwillige Feuerwehr Musterhausen', contactName: 'Paula Probe', street: 'Florianstraße 2', zip: '12348', city: 'Musterhausen', registeredPersons: 60 },
  { clubName: 'Burschenverein Exempelfeld', contactName: 'Jonas Exempel', street: 'Lindenallee 12', zip: '12349', city: 'Exempelfeld', registeredPersons: 24 },
  { clubName: 'Musikkapelle Beispieltal', contactName: 'Clara Klang', street: 'Talstraße 5', zip: '12350', city: 'Beispieltal', registeredPersons: 38 },
  { clubName: 'Krieger- und Soldatenverein Musterberg', contactName: 'Otto Muster', street: 'Bergstraße 9', zip: '12351', city: 'Musterberg', registeredPersons: 18 },
  { clubName: 'Sportverein Beispielingen 1920', contactName: 'Lena Lauf', street: 'Sportplatzweg 1', zip: '12352', city: 'Beispielingen', registeredPersons: 52 },
  { clubName: 'Gartenbauverein Musterau', contactName: 'Rosa Blüm', street: 'Gartenweg 4', zip: '12353', city: 'Musterau', registeredPersons: 15 },
  { clubName: 'Landjugend Probedorf', contactName: 'Felix Probe', street: 'Feldweg 8', zip: '12354', city: 'Probedorf', registeredPersons: 40 },
  { clubName: 'Heimat- und Brauchtumsverein Musterwald', contactName: 'Greta Wald', street: 'Waldstraße 21', zip: '12355', city: 'Musterwald', registeredPersons: 22 },
  { clubName: 'Fischereiverein Beispielsee', contactName: 'Karl Angel', street: 'Uferweg 6', zip: '12356', city: 'Beispielsee', registeredPersons: 12 }
]

/** Zwei neutrale Hinweistexte unter der Positionstabelle. */
export const SAMPLE_NOTES: readonly RichTextBlock[] = [
  {
    id: 'note-durchlaufender-posten',
    html: '<p>Beim Verkauf der Essensmarken handelt es sich um einen durchlaufenden Posten für den Musterverein e.V.</p>',
    align: 'left'
  },
  {
    id: 'note-festessen',
    html: '<p>Der Verkauf des Festessens erfolgt im Namen von Partyservice Mustermann.</p>',
    align: 'left'
  }
]

/** Festdatum in naher Zukunft: der erste Samstag mindestens drei Wochen nach heute. */
export function sampleFestivalDate(today: Date = new Date()): string {
  const start = addDays(todayIso(today), 21)
  const [y, m, d] = start.split('-').map(Number) as [number, number, number]
  const weekday = new Date(y, m - 1, d).getDay() // 0 = Sonntag, 6 = Samstag
  return addDays(start, (6 - weekday + 7) % 7)
}

/** Vorlage des Beispiel-Fests: Standard-Vorlage mit Logo und den beiden Hinweistexten. */
export function sampleTemplateConfig(): TemplateConfig {
  const config = getDefaultTemplateConfig()
  return {
    ...config,
    logo: { ...config.logo, enabled: true },
    intro: { ...config.intro, html: '<p>Leistungen im Rahmen des Beispiel-Gründungsfestes.</p>' },
    slots: { ...config.slots, notes: SAMPLE_NOTES.map((note) => ({ ...note })) }
  }
}

/**
 * Kopiert ein Logo inhaltsadressiert nach `logosDir/<sha256>.<ext>` (vorhandene Dateien werden nie
 * überschrieben) und liefert den Dateinamen.
 */
export function storeLogoFile(sourcePath: string, logosDir: string): string {
  const content = readFileSync(sourcePath)
  const hash = createHash('sha256').update(content).digest('hex')
  const ext = extname(sourcePath).toLowerCase() || '.png'
  const fileName = `${hash}${ext}`
  const target = join(logosDir, fileName)
  mkdirSync(logosDir, { recursive: true })
  if (!existsSync(target)) {
    try {
      copyFileSync(sourcePath, target, constants.COPYFILE_EXCL)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
  return fileName
}

/** Freier Name/Präfix: „Beispiel-Gründungsfest“, „Beispiel-Gründungsfest (2)“ … bzw. „BSP-“, „BSP2-“ … */
function uniqueNameAndPrefix(db: Db): { name: string; prefix: string } {
  const rows = db.prepare('SELECT name, number_prefix FROM festival').all() as Array<{ name: string; number_prefix: string }>
  const names = new Set(rows.map((r) => r.name))
  const prefixes = new Set(rows.map((r) => r.number_prefix))
  for (let i = 1; i < 1000; i++) {
    const name = i === 1 ? SAMPLE_FESTIVAL_NAME : `${SAMPLE_FESTIVAL_NAME} (${i})`
    const prefix = i === 1 ? SAMPLE_NUMBER_PREFIX : `BSP${i}-`
    if (!names.has(name) && !prefixes.has(prefix)) return { name, prefix }
  }
  throw new Error('Es gibt bereits zu viele Beispiel-Feste.')
}

export interface CreateSampleFestivalOptions {
  db?: Db
  /** `<userData>/logos` */
  logosDir: string
  /** Pfad zu `resources/sample/beispiel-logo.svg`; null/fehlend → Beispiel-Fest ohne Logo */
  logoSource: string | null
  /** für Tests: „heute“ (Festdatum) */
  today?: Date
}

/** Legt das Beispiel-Fest an (eine Transaktion) und liefert es. Das Fest wird NICHT aktiv gesetzt. */
export function createSampleFestival(opts: CreateSampleFestivalOptions): Festival {
  const db = opts.db ?? getDb()
  let logoFile: string | null = null
  if (opts.logoSource && existsSync(opts.logoSource)) {
    try {
      logoFile = storeLogoFile(opts.logoSource, opts.logosDir)
    } catch (err) {
      console.warn('[sample-data] Muster-Logo konnte nicht kopiert werden:', err)
    }
  }

  const id = db.transaction(() => {
    const { name, prefix } = uniqueNameAndPrefix(db)
    const festival = createFestival(
      {
        name,
        festivalDate: sampleFestivalDate(opts.today),
        numberPrefix: prefix,
        numberStart: 1,
        numberDigits: 3,
        taxExempt: true
      },
      db
    )

    const insertProduct = db.prepare(
      `INSERT INTO product (festival_id, name, price_cents, vat_rate, mode, default_quantity, sort_order, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
    )
    // vorhandene Produkte (falls die Fest-Anlage künftig welche erzeugt) nach hinten sortieren
    const offset = (db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM product WHERE festival_id = ?').get(festival.id) as { n: number }).n
    SAMPLE_PRODUCTS.forEach((p, index) => {
      insertProduct.run(festival.id, p.name, p.priceCents, p.vatRate, p.mode, p.defaultQuantity, offset + index)
    })

    const now = nowIso()
    const insertClub = db.prepare(
      `INSERT INTO club (festival_id, contact_name, club_name, street, zip, city, registered_persons, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)`
    )
    for (const c of SAMPLE_CLUBS) {
      insertClub.run(festival.id, c.contactName, c.clubName, c.street, c.zip, c.city, c.registeredPersons, now, now)
    }

    const config = JSON.stringify(sampleTemplateConfig())
    const updated = db
      .prepare('UPDATE template SET config_json = ?, logo_file = ?, updated_at = ? WHERE festival_id = ?')
      .run(config, logoFile, now, festival.id)
    if (updated.changes === 0) {
      db.prepare('INSERT INTO template (festival_id, config_json, logo_file, updated_at) VALUES (?, ?, ?, ?)').run(
        festival.id,
        config,
        logoFile,
        now
      )
    }
    return festival.id
  })()

  return getFestival(id, db)
}
