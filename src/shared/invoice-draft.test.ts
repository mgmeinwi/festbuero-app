import { describe, expect, it } from 'vitest'
import { formatEuro, NBSP } from './money'
import {
  activeQuickPick,
  addExtraLine,
  applyQuickPick,
  buildDraftRenderData,
  buildInvoiceDraft,
  calculateDraftTotals,
  canFinalize,
  computeDueDate,
  createDraftLines,
  createProductLine,
  customerEinzel,
  customerFromClub,
  customerLabel,
  defaultPaymentKind,
  draftFromInvoice,
  draftLinesToInvoiceLines,
  getFinalizeBlocker,
  MAX_QUANTITY,
  nextExtraKey,
  normalizeQuantity,
  prefillQuantity,
  quickPickQuantity,
  removeLine,
  reprefillLines,
  resetLine,
  sanitizeQuantityInput,
  setLineQuantity,
  stepQuantity,
  syncDraftLines,
  updateExtraLine,
  type DraftLine,
  type PrefillContext
} from './invoice-draft'
import type { Club, Invoice, InvoiceLine, PaymentMethod, Product, ProductMode, VatRate } from './types'

let nextId = 1
function product(
  name: string,
  priceCents: number,
  vatRate: VatRate,
  mode: ProductMode,
  defaultQuantity = 0,
  extra: Partial<Product> = {}
): Product {
  const id = nextId++
  return {
    id,
    festivalId: 1,
    name,
    priceCents,
    vatRate,
    mode,
    defaultQuantity,
    sortOrder: id,
    active: true,
    usedInInvoices: false,
    ...extra
  }
}

/** Die 8 Produkte der Beispielrechnung (Prüfsumme 670,20 €). */
function exampleProducts(): Product[] {
  return [
    product('1 Maß Bier (ohne Bedienung)', 970, 19, 'pro_person'),
    product('Brotzeit', 800, 7, 'pro_person'),
    product('Festzeichen', 300, 19, 'pro_person'),
    product('Festessen', 1450, 7, 'pro_person'),
    product('Korsoeinsatz', 200, 19, 'pro_person'),
    product('Käsespätzle', 1000, 7, 'pro_person'),
    product('Festschrift', 1500, 7, 'feste_anzahl', 1),
    product('Alkoholfreies Getränk (0,5l)', 380, 19, 'pro_person')
  ]
}

const EXAMPLE_QUANTITIES = [0, 0, 45, 18, 0, 13, 1, 34]

const club: Club = {
  id: 7,
  festivalId: 1,
  contactName: 'Erika Beispiel',
  clubName: 'Musterverein e.V.',
  street: 'Musterweg 3',
  zip: '01234',
  city: 'Musterstadt',
  registeredPersons: 45,
  source: 'manual',
  hasInvoice: false
}

const verein = (persons: number): PrefillContext => ({ customerKind: 'verein', persons })
const einzel: PrefillContext = { customerKind: 'einzel', persons: null }

const paymentMethods: PaymentMethod[] = [
  {
    id: 1,
    festivalId: 1,
    kind: 'bar',
    label: 'Bar',
    text: '<p>Betrag bar erhalten ____</p>',
    dueDays: 7,
    isDefault: true
  },
  {
    id: 2,
    festivalId: 1,
    kind: 'ueberweisung',
    label: 'Überweisung',
    text: '<p>Bitte bis {Fälligkeitsdatum} überweisen.</p>',
    dueDays: 14,
    isDefault: false
  }
]

function quantities(lines: DraftLine[]): number[] {
  return lines.map((l) => l.quantity)
}

/** Mengen wie in der Beispielrechnung eingeben. */
function enterExampleQuantities(lines: DraftLine[], ctx: PrefillContext): DraftLine[] {
  let result = lines
  lines.forEach((line, i) => {
    result = setLineQuantity(result, line.key, EXAMPLE_QUANTITIES[i]!, ctx)
  })
  return result
}

describe('Eingaben normalisieren', () => {
  it('normalizeQuantity: ganze Zahlen 0…MAX, Unsinn → 0', () => {
    expect(normalizeQuantity('45')).toBe(45)
    expect(normalizeQuantity(' 7 ')).toBe(7)
    expect(normalizeQuantity('')).toBe(0)
    expect(normalizeQuantity('abc')).toBe(0)
    expect(normalizeQuantity('-3')).toBe(0)
    expect(normalizeQuantity(-3)).toBe(0)
    expect(normalizeQuantity(2.9)).toBe(2)
    expect(normalizeQuantity('1.000')).toBe(1000)
    expect(normalizeQuantity(Number.NaN)).toBe(0)
    expect(normalizeQuantity(null)).toBe(0)
    expect(normalizeQuantity(10 ** 9)).toBe(MAX_QUANTITY)
  })

  it('sanitizeQuantityInput: nur Ziffern, ohne führende Nullen, begrenzte Länge', () => {
    expect(sanitizeQuantityInput('4a5')).toBe('45')
    expect(sanitizeQuantityInput('007')).toBe('7')
    expect(sanitizeQuantityInput('0')).toBe('0')
    expect(sanitizeQuantityInput('')).toBe('')
    expect(sanitizeQuantityInput('1234567')).toBe('12345')
  })

  it('stepQuantity: nie unter 0', () => {
    expect(stepQuantity(0, -1)).toBe(0)
    expect(stepQuantity(4, 1)).toBe(5)
    expect(stepQuantity(4, -10)).toBe(0)
  })
})

describe('Vorbelegung', () => {
  it('Verein: pro Person = kommende Personen, feste Anzahl = Standardanzahl', () => {
    const lines = createDraftLines(exampleProducts(), verein(45))
    expect(quantities(lines)).toEqual([45, 45, 45, 45, 45, 45, 1, 45])
    expect(lines.every((l) => !l.manual)).toBe(true)
  })

  it('Einzelrechnung und „noch kein Kunde“: alle Mengen 0', () => {
    expect(quantities(createDraftLines(exampleProducts(), einzel))).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    expect(quantities(createDraftLines(exampleProducts(), { customerKind: null, persons: null }))).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0
    ])
  })

  it('nur aktive Produkte, in der festgelegten Reihenfolge', () => {
    const a = product('A', 100, 19, 'pro_person', 0, { sortOrder: 3 })
    const b = product('B', 100, 19, 'pro_person', 0, { sortOrder: 1 })
    const c = product('C', 100, 19, 'pro_person', 0, { sortOrder: 2, active: false })
    const lines = createDraftLines([a, b, c], verein(2))
    expect(lines.map((l) => l.name)).toEqual(['B', 'A'])
  })

  it('prefillQuantity: Zusatzposition hat keine Vorbelegung', () => {
    expect(prefillQuantity({ mode: null, defaultQuantity: 5 }, verein(10))).toBe(0)
    expect(prefillQuantity({ mode: 'feste_anzahl', defaultQuantity: 3 }, verein(10))).toBe(3)
    expect(prefillQuantity({ mode: 'pro_person', defaultQuantity: 3 }, { customerKind: 'verein', persons: null })).toBe(
      0
    )
  })
})

describe('Personenänderung', () => {
  it('ohne Handänderung: alle Zeilen folgen der Personenzahl', () => {
    const lines = createDraftLines(exampleProducts(), verein(45))
    const next = reprefillLines(lines, verein(50))
    expect(quantities(next)).toEqual([50, 50, 50, 50, 50, 50, 1, 50])
  })

  it('von Hand geänderte Zeilen bleiben stehen und sind markiert', () => {
    let lines = createDraftLines(exampleProducts(), verein(45))
    const festessen = lines[3]!.key
    lines = setLineQuantity(lines, festessen, 18, verein(45))
    expect(lines[3]).toMatchObject({ quantity: 18, manual: true })

    const next = reprefillLines(lines, verein(50))
    expect(next[3]).toMatchObject({ quantity: 18, manual: true })
    expect(next[0]).toMatchObject({ quantity: 50, manual: false })
    // auch wenn die neue Personenzahl zufällig der Handeingabe entspricht, bleibt die Markierung
    expect(reprefillLines(lines, verein(18))[3]).toMatchObject({ quantity: 18, manual: true })
  })

  it('Eingabe gleich der Vorbelegung → Zeile bleibt automatisch', () => {
    let lines = createDraftLines(exampleProducts(), verein(45))
    lines = setLineQuantity(lines, lines[2]!.key, 4, verein(45))
    expect(lines[2]!.manual).toBe(true)
    lines = setLineQuantity(lines, lines[2]!.key, 45, verein(45))
    expect(lines[2]).toMatchObject({ quantity: 45, manual: false })
    expect(reprefillLines(lines, verein(30))[2]!.quantity).toBe(30)
  })

  it('Zurücksetzen: Zeile folgt wieder der Vorbelegung', () => {
    let lines = createDraftLines(exampleProducts(), verein(45))
    lines = setLineQuantity(lines, lines[6]!.key, 3, verein(45))
    expect(lines[6]).toMatchObject({ quantity: 3, manual: true })
    lines = resetLine(lines, lines[6]!.key, verein(45))
    expect(lines[6]).toMatchObject({ quantity: 1, manual: false })
  })

  it('Kundenwechsel Verein → Einzelrechnung: automatische Zeilen auf 0, Handänderungen bleiben', () => {
    let lines = createDraftLines(exampleProducts(), verein(45))
    lines = setLineQuantity(lines, lines[3]!.key, 18, verein(45))
    const next = reprefillLines(lines, einzel)
    expect(quantities(next)).toEqual([0, 0, 0, 18, 0, 0, 0, 0])
  })

  it('unveränderte Zeilen behalten ihre Identität (keine unnötigen Re-Renders)', () => {
    const lines = createDraftLines(exampleProducts(), verein(45))
    const next = reprefillLines(lines, verein(45))
    next.forEach((l, i) => expect(l).toBe(lines[i]))
  })
})

describe('Schnellwahl', () => {
  it('0 / 1× / 2× ergibt 0, Personen, 2 × Personen', () => {
    expect(quickPickQuantity(0, 45)).toBe(0)
    expect(quickPickQuantity(1, 45)).toBe(45)
    expect(quickPickQuantity(2, 45)).toBe(90)
    expect(quickPickQuantity(2, null)).toBe(0)
  })

  it('setzt die Markierung, wenn die Menge von der Vorbelegung abweicht', () => {
    let lines = createDraftLines(exampleProducts(), verein(45))
    lines = applyQuickPick(lines, lines[0]!.key, 0, verein(45))
    expect(lines[0]).toMatchObject({ quantity: 0, manual: true })
    lines = applyQuickPick(lines, lines[1]!.key, 2, verein(45))
    expect(lines[1]).toMatchObject({ quantity: 90, manual: true })
    // Festschrift (feste Anzahl 1): 1× = 45 weicht ab → markiert
    lines = applyQuickPick(lines, lines[6]!.key, 1, verein(45))
    expect(lines[6]).toMatchObject({ quantity: 45, manual: true })
    // Pro-Person-Produkt: 1× entspricht der Vorbelegung → bleibt automatisch
    lines = applyQuickPick(lines, lines[2]!.key, 1, verein(45))
    expect(lines[2]).toMatchObject({ quantity: 45, manual: false })

    // Personenänderung: Schnellwahl-Zeilen bleiben stehen
    const next = reprefillLines(lines, verein(50))
    expect(quantities(next)).toEqual([0, 90, 50, 50, 50, 50, 45, 50])
  })

  it('activeQuickPick erkennt die passende Schnellwahl', () => {
    expect(activeQuickPick(0, 45)).toBe(0)
    expect(activeQuickPick(45, 45)).toBe(1)
    expect(activeQuickPick(90, 45)).toBe(2)
    expect(activeQuickPick(18, 45)).toBeNull()
    expect(activeQuickPick(0, 0)).toBe(0)
  })
})

describe('Einzelrechnung', () => {
  it('Kunde ohne Angaben → nur „Einzelrechnung“, Personen null', () => {
    const customer = customerEinzel()
    expect(customer).toMatchObject({
      kind: 'einzel',
      clubId: null,
      contactName: '',
      clubName: '',
      registeredPersons: null
    })
    expect(customerLabel(customer)).toBe('Einzelrechnung')
    const lines = createDraftLines(exampleProducts(), einzel)
    const draft = buildInvoiceDraft({
      festivalId: 1,
      customer,
      persons: 12,
      paymentKind: 'bar',
      invoiceDate: '2025-06-01',
      serviceDate: '2025-06-01',
      lines
    })
    expect(draft.persons).toBeNull()
  })

  it('optionale Anschrift wird getrimmt übernommen', () => {
    const customer = customerEinzel({ contactName: ' Max Muster ', street: 'Weg 1', zip: '01234', city: 'Ort ' })
    expect(customer).toMatchObject({ contactName: 'Max Muster', street: 'Weg 1', zip: '01234', city: 'Ort' })
    expect(customerLabel(customer)).toBe('Max Muster')
  })

  it('Eingaben gelten als Handänderung (keine Vorbelegung)', () => {
    let lines = createDraftLines(exampleProducts(), einzel)
    lines = setLineQuantity(lines, lines[0]!.key, 2, einzel)
    expect(lines[0]).toMatchObject({ quantity: 2, manual: true })
    lines = setLineQuantity(lines, lines[0]!.key, 0, einzel)
    expect(lines[0]).toMatchObject({ quantity: 0, manual: false })
  })
})

describe('Zusatzposition', () => {
  it('anlegen, ändern, entfernen', () => {
    let lines = createDraftLines(exampleProducts(), verein(45))
    expect(nextExtraKey(lines)).toBe('x1')
    lines = addExtraLine(lines)
    const extra = lines[lines.length - 1]!
    expect(extra).toMatchObject({
      key: 'x1',
      productId: null,
      name: '',
      priceCents: 0,
      vatRate: 19,
      quantity: 1,
      manual: true
    })
    expect(nextExtraKey(lines)).toBe('x2')

    lines = updateExtraLine(lines, 'x1', { name: 'Tischdeko', priceCents: 1250, vatRate: 7, quantity: 2 })
    expect(lines[lines.length - 1]).toMatchObject({ name: 'Tischdeko', priceCents: 1250, vatRate: 7, quantity: 2 })

    // ungültiger Preis wird ignoriert
    lines = updateExtraLine(lines, 'x1', { priceCents: -5 })
    expect(lines[lines.length - 1]!.priceCents).toBe(1250)

    // Produktzeilen lassen sich nicht über updateExtraLine/removeLine ändern
    const before = lines[0]
    expect(updateExtraLine(lines, lines[0]!.key, { name: 'X' })[0]).toBe(before)
    expect(removeLine(lines, lines[0]!.key)).toHaveLength(lines.length)

    lines = removeLine(lines, 'x1')
    expect(lines.some((l) => l.productId === null)).toBe(false)
  })

  it('bleibt bei Personenänderung unverändert und geht in den Entwurf ein', () => {
    let lines = addExtraLine(createDraftLines(exampleProducts(), verein(45)), {
      name: 'Sonderposten',
      priceCents: 500,
      vatRate: 19,
      quantity: 3
    })
    lines = reprefillLines(lines, verein(10))
    expect(lines[lines.length - 1]!.quantity).toBe(3)
    const draftLines = draftLinesToInvoiceLines(lines)
    expect(draftLines[draftLines.length - 1]).toEqual({
      productId: null,
      name: 'Sonderposten',
      priceCents: 500,
      vatRate: 19,
      quantity: 3
    })
  })

  it('leere Zusatzposition wird ignoriert, unbenannte mit Menge sperrt den Abschluss', () => {
    let lines = createDraftLines(exampleProducts(), verein(45))
    lines = addExtraLine(lines, { quantity: 0 })
    expect(draftLinesToInvoiceLines(lines)).toHaveLength(8)
    expect(canFinalize({ customer: customerFromClub(club), lines })).toBe(true)

    lines = updateExtraLine(lines, 'x1', { priceCents: 300, quantity: 1 })
    expect(getFinalizeBlocker({ customer: customerFromClub(club), lines })).toMatch(/Bezeichnung/)
    lines = updateExtraLine(lines, 'x1', { name: '  Pfand ' })
    expect(canFinalize({ customer: customerFromClub(club), lines })).toBe(true)
    expect(draftLinesToInvoiceLines(lines)[8]!.name).toBe('Pfand')
  })
})

describe('Abschlussdaten', () => {
  it('Beispielrechnung: Endbetrag 670,20 €', () => {
    let lines = createDraftLines(exampleProducts(), verein(45))
    lines = enterExampleQuantities(lines, verein(45))
    const totals = calculateDraftTotals(lines)
    expect(totals.grossCents).toBe(67020)
    expect(formatEuro(totals.grossCents)).toBe(`670,20${NBSP}€`)
    // Mengen, die von der Vorbelegung abweichen, sind markiert
    expect(lines.map((l) => l.manual)).toEqual([true, true, false, true, true, true, false, true])
  })

  it('buildInvoiceDraft übernimmt Kunde, Personen, Zahlart, Daten und alle Positionen (inkl. Menge 0)', () => {
    const products = exampleProducts()
    const lines = enterExampleQuantities(createDraftLines(products, verein(45)), verein(45))
    const draft = buildInvoiceDraft({
      festivalId: 3,
      customer: customerFromClub(club),
      persons: 45,
      paymentKind: 'ueberweisung',
      invoiceDate: '2025-06-02',
      serviceDate: '2025-06-01',
      lines
    })
    expect(draft).toMatchObject({
      festivalId: 3,
      persons: 45,
      paymentKind: 'ueberweisung',
      invoiceDate: '2025-06-02',
      serviceDate: '2025-06-01',
      customer: {
        kind: 'verein',
        clubId: 7,
        contactName: 'Erika Beispiel',
        clubName: 'Musterverein e.V.',
        street: 'Musterweg 3',
        zip: '01234',
        city: 'Musterstadt',
        registeredPersons: 45
      }
    })
    expect(draft.lines).toHaveLength(8)
    expect(draft.lines[0]).toEqual({
      productId: products[0]!.id,
      name: '1 Maß Bier (ohne Bedienung)',
      priceCents: 970,
      vatRate: 19,
      quantity: 0
    })
    expect(draft.lines.map((l) => l.quantity)).toEqual(EXAMPLE_QUANTITIES)
  })

  it('Fälligkeit = Rechnungsdatum + Frist der Zahlungsart', () => {
    expect(computeDueDate('2025-06-01', paymentMethods[0])).toBe('2025-06-08')
    expect(computeDueDate('2025-06-25', paymentMethods[1])).toBe('2025-07-09')
    expect(computeDueDate('2025-06-01', null)).toBe('2025-06-08')
    expect(computeDueDate('kaputt', paymentMethods[0])).toBe('kaputt')
  })

  it('defaultPaymentKind: Standard-Zahlart, sonst Bar', () => {
    expect(defaultPaymentKind(paymentMethods)).toBe('bar')
    expect(defaultPaymentKind(paymentMethods.map((m) => ({ ...m, isDefault: m.kind === 'ueberweisung' })))).toBe(
      'ueberweisung'
    )
    expect(defaultPaymentKind([])).toBe('bar')
  })

  it('buildDraftRenderData: Summen, Fälligkeit, Zahlungstext, Steuerangaben', () => {
    const lines = enterExampleQuantities(createDraftLines(exampleProducts(), verein(45)), verein(45))
    const draft = buildInvoiceDraft({
      festivalId: 1,
      customer: customerFromClub(club),
      persons: 45,
      paymentKind: 'ueberweisung',
      invoiceDate: '2025-06-01',
      serviceDate: '2025-05-31',
      lines
    })
    const data = buildDraftRenderData({
      draft,
      festival: { name: 'Testfest', taxExempt: false, taxExemptText: '§ 19' },
      paymentMethods,
      number: '2025-081',
      today: '2025-06-03'
    })
    expect(data).toMatchObject({
      type: 'rechnung',
      number: '2025-081',
      originalNumber: null,
      festivalName: 'Testfest',
      invoiceDate: '2025-06-01',
      serviceDate: '2025-05-31',
      dueDate: '2025-06-15',
      today: '2025-06-03',
      persons: 45,
      paymentKind: 'ueberweisung',
      paymentLabel: 'Überweisung',
      paymentText: '<p>Bitte bis {Fälligkeitsdatum} überweisen.</p>',
      taxExempt: false,
      taxExemptText: '§ 19'
    })
    expect(data.totals.grossCents).toBe(67020)
    expect(data.totals.byRate.map((r) => r.rate)).toEqual([7, 19])
    expect(data.lines[3]).toEqual({
      name: 'Festessen',
      priceCents: 1450,
      vatRate: 7,
      quantity: 18,
      lineTotalCents: 26100
    })
    expect(data.lines[0]!.lineTotalCents).toBe(0)
  })

  it('buildDraftRenderData ohne Nummer und ohne bekannte Zahlungsarten', () => {
    const draft = buildInvoiceDraft({
      festivalId: 1,
      customer: customerEinzel(),
      persons: null,
      paymentKind: 'bar',
      invoiceDate: '2025-06-01',
      serviceDate: '2025-06-01',
      lines: []
    })
    const data = buildDraftRenderData({
      draft,
      festival: { name: 'Fest', taxExempt: true, taxExemptText: 'befreit' },
      paymentMethods: [],
      number: null,
      today: '2025-06-01'
    })
    expect(data.number).toBeNull()
    expect(data.paymentLabel).toBe('Bar')
    expect(data.paymentText).toBe('')
    expect(data.dueDate).toBe('2025-06-08')
    expect(data.totals.grossCents).toBe(0)
  })
})

describe('canFinalize', () => {
  const lines45 = () => createDraftLines(exampleProducts(), verein(45))

  it('ohne Kunde nicht möglich', () => {
    expect(canFinalize({ customer: null, lines: lines45() })).toBe(false)
    expect(getFinalizeBlocker({ customer: null, lines: lines45() })).toMatch(/Verein wählen/)
  })

  it('Endbetrag 0 € sperrt den Abschluss', () => {
    const zero = createDraftLines(exampleProducts(), einzel)
    expect(canFinalize({ customer: customerEinzel(), lines: zero })).toBe(false)
    expect(getFinalizeBlocker({ customer: customerEinzel(), lines: zero })).toMatch(/0 €/)
    const one = setLineQuantity(zero, zero[1]!.key, 1, einzel)
    expect(canFinalize({ customer: customerEinzel(), lines: one })).toBe(true)
  })

  it('Verein mit Vorbelegung ist abschließbar', () => {
    expect(canFinalize({ customer: customerFromClub(club), lines: lines45() })).toBe(true)
  })

  it('ungültiges Datum sperrt den Abschluss', () => {
    const lines = lines45()
    expect(getFinalizeBlocker({ customer: customerFromClub(club), lines, invoiceDate: '' })).toMatch(/Rechnungsdatum/)
    expect(getFinalizeBlocker({ customer: customerFromClub(club), lines, serviceDate: '2025-02-30' })).toMatch(
      /Leistungsdatum/
    )
    expect(
      canFinalize({ customer: customerFromClub(club), lines, invoiceDate: '2025-06-01', serviceDate: '2025-06-01' })
    ).toBe(true)
  })
})

describe('syncDraftLines', () => {
  it('übernimmt neue Stammdaten, behält Handänderungen, ergänzt neue Produkte, entfernt inaktive', () => {
    const products = exampleProducts()
    let lines = createDraftLines(products, verein(45))
    lines = setLineQuantity(lines, lines[3]!.key, 18, verein(45))
    lines = addExtraLine(lines, { name: 'Extra', priceCents: 100, quantity: 2 })

    const changed = products.map((p, i) =>
      i === 3 ? { ...p, priceCents: 1500 } : i === 0 ? { ...p, active: false } : p
    )
    const added = product('Neues Produkt', 250, 19, 'feste_anzahl', 2, { sortOrder: 0 })
    const next = syncDraftLines(lines, [...changed, added], verein(45))

    expect(next[0]).toMatchObject({ name: 'Neues Produkt', quantity: 2, manual: false })
    expect(next.some((l) => l.name.startsWith('1 Maß Bier'))).toBe(false)
    const festessen = next.find((l) => l.name === 'Festessen')!
    expect(festessen).toMatchObject({ priceCents: 1500, quantity: 18, manual: true })
    expect(next[next.length - 1]).toMatchObject({ name: 'Extra', productId: null, quantity: 2 })
  })
})

describe('draftFromInvoice (?from=)', () => {
  function invoiceLine(
    position: number,
    productId: number | null,
    name: string,
    priceCents: number,
    vatRate: VatRate,
    quantity: number
  ): InvoiceLine {
    return {
      id: position,
      invoiceId: 1,
      position,
      productId,
      name,
      priceCents,
      vatRate,
      quantity,
      lineTotalCents: priceCents * quantity
    }
  }

  function invoice(lines: InvoiceLine[], extra: Partial<Invoice> = {}): Invoice {
    return {
      id: 1,
      festivalId: 1,
      number: '2025-003',
      seq: 3,
      type: 'rechnung',
      status: 'abgeschlossen',
      originalInvoiceId: null,
      originalNumber: null,
      stornoReason: null,
      stornoInvoiceId: null,
      stornoNumber: null,
      customer: customerFromClub(club),
      persons: 40,
      paymentKind: 'ueberweisung',
      paymentLabel: 'Überweisung',
      paymentText: '',
      dueDays: 7,
      invoiceDate: '2025-06-01',
      serviceDate: '2025-05-31',
      dueDate: '2025-06-08',
      totals: { grossCents: 0, netCents: 0, vatCents: 0, byRate: [] },
      taxExempt: true,
      taxExemptText: '',
      festivalName: 'Testfest',
      template: {} as Invoice['template'],
      logoFile: null,
      pdfPath: null,
      pdfCreatedAt: null,
      printed: true,
      printedAt: null,
      printError: null,
      createdAt: '2025-06-01T10:00:00.000Z',
      lines,
      ...extra
    }
  }

  it('übernimmt Kunde, Personen, Zahlart, Mengen; unbekannte Produkte werden Zusatzpositionen', () => {
    const products = exampleProducts()
    const [bier, , festzeichen, festessen] = products
    const deactivated = product('Altes Produkt', 450, 19, 'pro_person', 0, { active: false })
    const inv = invoice([
      invoiceLine(1, bier!.id, '1 Maß Bier (alt)', 900, 19, 0),
      invoiceLine(2, festzeichen!.id, 'Festzeichen', 300, 19, 40),
      invoiceLine(3, festessen!.id, 'Festessen', 1450, 7, 12),
      invoiceLine(4, deactivated.id, 'Altes Produkt', 450, 19, 3),
      invoiceLine(5, null, 'Sonderposten', 1000, 7, 1)
    ])
    const result = draftFromInvoice(inv, [...products, deactivated])
    expect(result.customer).toMatchObject({ kind: 'verein', clubId: 7, clubName: 'Musterverein e.V.' })
    expect(result.persons).toBe(40)
    expect(result.paymentKind).toBe('ueberweisung')
    expect(result.serviceDate).toBe('2025-05-31')

    const byName = new Map(result.lines.map((l) => [l.name, l]))
    // aktuelle Bezeichnung und aktueller Preis des Produkts
    expect(byName.get('1 Maß Bier (ohne Bedienung)')).toMatchObject({ quantity: 0, manual: true, priceCents: 970 })
    expect(byName.get('Festzeichen')).toMatchObject({ quantity: 40, manual: true })
    expect(byName.get('Festessen')).toMatchObject({ quantity: 12, manual: true })
    // nicht in der alten Rechnung → normal vorbelegt
    expect(byName.get('Brotzeit')).toMatchObject({ quantity: 40, manual: false })
    expect(byName.get('Festschrift')).toMatchObject({ quantity: 1, manual: false })
    // Zusatzpositionen
    const extras = result.lines.filter((l) => l.productId === null)
    expect(extras.map((l) => [l.name, l.priceCents, l.vatRate, l.quantity, l.manual])).toEqual([
      ['Altes Produkt', 450, 19, 3, true],
      ['Sonderposten', 1000, 7, 1, true]
    ])
  })

  it('Einzelrechnung und Storno (negative Mengen) werden sinnvoll übernommen', () => {
    const products = exampleProducts()
    const inv = invoice([invoiceLine(1, products[1]!.id, 'Brotzeit', 800, 7, -2)], {
      type: 'storno',
      customer: customerEinzel({ contactName: 'Max Muster' }),
      persons: null
    })
    const result = draftFromInvoice(inv, products)
    expect(result.persons).toBeNull()
    expect(result.customer).toMatchObject({ kind: 'einzel', contactName: 'Max Muster' })
    expect(result.lines.find((l) => l.name === 'Brotzeit')).toMatchObject({ quantity: 2, manual: true })
    expect(result.lines.filter((l) => l.name !== 'Brotzeit').every((l) => l.quantity === 0)).toBe(true)
  })
})

describe('Hilfsfunktionen', () => {
  it('createProductLine nutzt die Produktdaten', () => {
    const p = product('Festschrift', 1500, 7, 'feste_anzahl', 1)
    expect(createProductLine(p, verein(45))).toEqual({
      key: `p${p.id}`,
      productId: p.id,
      name: 'Festschrift',
      priceCents: 1500,
      vatRate: 7,
      mode: 'feste_anzahl',
      defaultQuantity: 1,
      quantity: 1,
      manual: false
    })
  })

  it('customerFromClub kopiert die Stammdaten', () => {
    expect(customerFromClub(club)).toEqual({
      kind: 'verein',
      clubId: 7,
      contactName: 'Erika Beispiel',
      clubName: 'Musterverein e.V.',
      street: 'Musterweg 3',
      zip: '01234',
      city: 'Musterstadt',
      registeredPersons: 45
    })
    expect(customerLabel(customerFromClub(club))).toBe('Musterverein e.V.')
    expect(customerLabel(null)).toBe('')
  })
})
