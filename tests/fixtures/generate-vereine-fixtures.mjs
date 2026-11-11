/**
 * Erzeugt die Excel-Testdateien für den Vereinsimport (nur erfundene Musterdaten).
 *
 *   node tests/fixtures/generate-vereine-fixtures.mjs
 *
 * - vereine-beispiel.xlsx            Aufbau wie eine echte Anmeldeliste: Blatt „Übersicht“ mit
 *                                    Zusatzspalten (Nr, Rnr, Produkte, Betrag), 15 Vereine,
 *                                    PLZ mit führender Null, verschiedene Zelltypen, Summenzeile.
 * - vereine-fehler.xlsx              Kopfzeile erst in Zeile 3 mit abweichender Schreibweise,
 *                                    fehlender Vereinsname, „ca. 20“, leere Zeilen, Dubletten …
 * - vereine-ohne-pflichtspalte.xlsx  Spalte „ang. Personen“ fehlt.
 *
 * Erwartete Ergebnisse stehen in src/main/services/club-import.test.ts.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'

const here = dirname(fileURLToPath(import.meta.url))
const FIXED_DATE = new Date(Date.UTC(2025, 0, 1, 12, 0, 0))

function newWorkbook() {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Festbüro Testdaten'
  wb.created = FIXED_DATE
  wb.modified = FIXED_DATE
  return wb
}

const PRICES = { bier: 3.8, brotzeit: 6.5, festzeichen: 2, festschrift: 5 }

/** Vereine für vereine-beispiel.xlsx (alles erfunden). */
const SAMPLE_CLUBS = [
  { name: 'Anna Beispiel', club: 'FF Musterdorf', street: 'Hauptstraße 1', zip: 12345, city: 'Musterdorf', persons: 45 },
  { name: 'Bernd Platzhalter', club: 'TSV Beispielstadt', street: 'Sportplatzweg 3', zip: 23456, city: 'Beispielstadt', persons: 38 },
  // PLZ als Zahl mit Zahlenformat 00000 → „01234“
  { name: 'Clara Muster', club: 'Schützenverein Testingen e.V.', street: 'Schießstattweg 7', zip: 1234, zipFmt: '00000', city: 'Testingen', persons: 22 },
  // Personen als Zahltext
  { name: 'Dieter Exempel', club: 'Trachtenverein Vorlagenbach', street: 'Dorfplatz 2', zip: 34567, city: 'Vorlagenbach', persons: '25' },
  // Name als Rich-Text
  { name: { richText: [{ font: { bold: true }, text: 'Eva ' }, { text: 'Testmann' }] }, club: 'Musikkapelle Fiktivried', street: 'Am Anger 5', zip: 45678, city: 'Fiktivried', persons: 30 },
  // vierstellige PLZ ohne Format → „09876“
  { name: 'Franz Fiktiv', club: 'Burschenverein Platzhalterau', street: 'Kirchgasse 9', zip: 9876, city: 'Platzhalterau', persons: 18 },
  // Verein als Hyperlink, Personen als Formel
  { name: 'Gabi Probe', club: { text: 'FC Demohofen', hyperlink: 'https://example.org/fc-demohofen' }, street: 'Stadionstraße 11', zip: 56789, city: 'Demohofen', persons: { formula: '10+17', result: 27 } },
  // PLZ als Text
  { name: 'Hans Vorlage', club: 'Gartenbauverein Skizzenberg', street: 'Blumenweg 4', zip: '67890', city: 'Skizzenberg', persons: 12 },
  { name: 'Ida Entwurf', club: 'Krieger- und Soldatenkameradschaft Entwurfsheim-Oberzell', street: 'Lindenallee 21', zip: 78901, city: 'Entwurfsheim', persons: 16 },
  { name: 'Jonas Schablone', club: 'Landjugend Modellsee', street: 'Seestraße 8', zip: 89012, city: 'Modellsee', persons: 40 },
  { name: 'Karin Modell', club: 'Feuerwehr Attrappendorf', street: 'Florianstraße 1', zip: 90123, city: 'Attrappendorf', persons: 33 },
  { name: '  Lukas Attrappe  ', club: ' Sportfreunde Rohlingen ', street: 'Am Sportpark 6', zip: 91234, city: 'Rohlingen', persons: 27 },
  { name: 'Maria Demo', club: 'Theaterverein Schablonenhain', street: 'Bühnenweg 2', zip: 92345, city: 'Schablonenhain', persons: 14 },
  { name: 'Norbert Skizze', club: 'Wasserwacht Exempelstadt', street: 'Uferweg 10', zip: 93456, city: 'Exempelstadt', persons: 9 },
  { name: 'Olga Rohling', club: 'Obst- und Gartenbauverein Musterhausen', street: 'Obstgartenweg 15', zip: 94567, city: 'Musterhausen', persons: 21 }
]

function personsNumber(p) {
  if (typeof p === 'number') return p
  if (typeof p === 'string') return Number(p)
  return p.result
}

async function writeBeispiel() {
  const wb = newWorkbook()
  const ws = wb.addWorksheet('Übersicht', { views: [{ state: 'frozen', ySplit: 1 }] })
  const header = ['Nr', 'Rnr', 'Name', 'Verein', 'Straße', 'PLZ', 'Ort', 'ang. Personen', 'Bier', 'Brotzeit', 'Festzeichen', 'Festschrift', 'Betrag']
  ws.addRow(header)
  ws.getRow(1).font = { bold: true }
  ws.columns.forEach((col, i) => {
    col.width = [5, 10, 22, 40, 22, 8, 16, 14, 8, 10, 12, 12, 12][i]
  })

  let totalAmount = 0
  SAMPLE_CLUBS.forEach((c, i) => {
    const r = i + 2
    const persons = personsNumber(c.persons)
    const qty = { bier: persons * 2, brotzeit: persons, festzeichen: persons, festschrift: 1 }
    const amount =
      qty.bier * PRICES.bier + qty.brotzeit * PRICES.brotzeit + qty.festzeichen * PRICES.festzeichen + qty.festschrift * PRICES.festschrift
    totalAmount += Math.round(amount * 100) / 100
    const row = ws.getRow(r)
    row.getCell(1).value = i + 1
    row.getCell(2).value = i < 4 ? `2025-${String(i + 1).padStart(3, '0')}` : null
    row.getCell(3).value = c.name
    row.getCell(4).value = c.club
    row.getCell(5).value = c.street
    row.getCell(6).value = c.zip
    if (c.zipFmt) row.getCell(6).numFmt = c.zipFmt
    row.getCell(7).value = c.city
    row.getCell(8).value = c.persons
    row.getCell(9).value = qty.bier
    row.getCell(10).value = qty.brotzeit
    row.getCell(11).value = qty.festzeichen
    row.getCell(12).value = qty.festschrift
    row.getCell(13).value = {
      formula: `I${r}*${PRICES.bier}+J${r}*${PRICES.brotzeit}+K${r}*${PRICES.festzeichen}+L${r}*${PRICES.festschrift}`,
      result: Math.round(amount * 100) / 100
    }
    row.getCell(13).numFmt = '#,##0.00 "€"'
  })

  // Zeile 17 leer, Zeile 18 Summenzeile ohne Verein (erscheint beim Import als Fehlerzeile)
  const last = SAMPLE_CLUBS.length + 1
  const sumRow = ws.getRow(last + 2)
  const numericPersons = SAMPLE_CLUBS.map((c) => c.persons).filter((p) => typeof p !== 'string')
  sumRow.getCell(3).value = 'Summe'
  sumRow.getCell(8).value = { formula: `SUM(H2:H${last})`, result: numericPersons.reduce((s, p) => s + personsNumber(p), 0) }
  sumRow.getCell(13).value = { formula: `SUM(M2:M${last})`, result: Math.round(totalAmount * 100) / 100 }
  sumRow.font = { bold: true }

  // weiteres Blatt ohne Vereinsdaten (darf den Import nicht stören)
  const prices = wb.addWorksheet('Preise')
  prices.addRow(['Produkt', 'Preis'])
  for (const [k, v] of Object.entries(PRICES)) prices.addRow([k, v])

  await wb.xlsx.writeFile(join(here, 'vereine-beispiel.xlsx'))
}

async function writeFehler() {
  const wb = newWorkbook()
  const ws = wb.addWorksheet('Anmeldungen 2025')
  ws.getCell('A1').value = 'Anmeldeliste Gründungsfest Musterdorf'
  ws.getCell('A1').font = { bold: true, size: 14 }
  ws.mergeCells('A1:F1')
  // Zeile 2 leer; Kopfzeile in Zeile 3 mit abweichender Schreibweise
  ws.getRow(3).values = ['Ansprechpartner', '  VEREIN ', 'Strasse', 'Postleitzahl', 'Ort', 'ang.Personen']
  ws.getRow(3).font = { bold: true }
  const rows = {
    4: ['Paula Prüfung', 'SV Fehlerfrei', 'Teststraße 1', 11111, 'Prüfdorf', 20],
    5: ['Quirin Quelle', null, 'Ohneweg 2', 22222, 'Namenlos', 15],
    6: ['Rita Rechner', 'Kegelclub Ungefähr', 'Schätzweg 3', 33333, 'Circa', 'ca. 20'],
    // 7 und 8 leer
    9: ['Stefan Stimmt', 'Chor Harmonie Testingen', 'Liedweg 4', 4444, 'Testingen', 31],
    10: ['Tina Leer', 'Radfahrverein Leerlauf', 'Speichenweg 5', 55555, 'Leerbach', null],
    11: ['Uwe Ungerade', 'Kartenclub Halbe Sachen', 'Kommaweg 6', 66666, 'Bruchhausen', 12.5],
    12: ['Vera Zweitgruppe', 'sv fehlerfrei', 'Teststraße 1', 11111, 'Prüfdorf', 8],
    13: ['Stefan Stimmt', 'Chor Harmonie Testingen', 'Liedweg 4', 4444, 'Testingen', 31],
    14: ['Walter Weiter', 'Skiclub Negativ', 'Pistenweg 7', 77777, 'Schneedorf', -3]
  }
  for (const [r, values] of Object.entries(rows)) ws.getRow(Number(r)).values = values
  // Zeile 8 nur formatiert, ohne Inhalt
  ws.getRow(8).getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } }
  ws.columns.forEach((col) => {
    col.width = 22
  })
  await wb.xlsx.writeFile(join(here, 'vereine-fehler.xlsx'))
}

async function writeOhnePflichtspalte() {
  const wb = newWorkbook()
  const ws = wb.addWorksheet('Vereine')
  ws.addRow(['Name', 'Verein', 'Straße', 'PLZ', 'Ort'])
  ws.addRow(['Xaver Ohnezahl', 'Kulturverein Spaltenlos', 'Lückenweg 1', 12121, 'Fehlheim'])
  ws.addRow(['Yvonne Vergessen', 'Heimatverein Unvollständig', 'Randweg 2', 13131, 'Fehlheim'])
  ws.addRow(['Zacharias Zuwenig', 'Kegelfreunde Halbleer', 'Eckgasse 3', 14141, 'Fehlheim'])
  await wb.xlsx.writeFile(join(here, 'vereine-ohne-pflichtspalte.xlsx'))
}

await writeBeispiel()
await writeFehler()
await writeOhnePflichtspalte()
console.log('Fixtures geschrieben:', here)
