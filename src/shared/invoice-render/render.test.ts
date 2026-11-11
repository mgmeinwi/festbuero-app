import { describe, expect, it } from 'vitest'
import { NBSP } from '../money'
import { replacePlaceholders } from '../placeholders'
import type { Invoice, InvoiceRenderData, TemplateConfig } from '../types'
import { getDefaultTemplateConfig } from './default-template'
import { FONT_IDS, getFontFaceCss } from './fonts'
import { addressLines, invoiceToRenderData, LAYOUT_MM, renderInvoiceHtml } from './index'
import { normalizeTemplateConfig } from './normalize'
import { buildSampleRenderData, getManyLinesSampleRenderData, getSampleRenderData, getSampleStornoRenderData } from './sample-data'

const LOGO = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4='

function render(data: InvoiceRenderData = getSampleRenderData(), template: TemplateConfig = getDefaultTemplateConfig(), logo: string | null = null) {
  return renderInvoiceHtml({ data, template, logoDataUrl: logo })
}

/** sichtbarer Text des Dokuments (ohne <style>/<script>, Tags entfernt, Entities für NBSP aufgelöst) */
function text(html: string): string {
  return html
    .replace(/<style>[\s\S]*?<\/style>/g, '')
    .replace(/<script>[\s\S]*?<\/script>/g, '')
    .replace(/<\/?(span|strong|em|u|s)\b[^>]*>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, NBSP)
    .replace(/&amp;/g, '&')
    .replace(/[ \t\r\n]+/g, ' ')
}

/** Inhalt eines Elements mit der Klasse (erste Fundstelle, grob) */
function section(html: string, cls: string): string {
  const start = html.indexOf(`class="${cls}`)
  if (start < 0) return ''
  return html.slice(start, start + 4000)
}

function withTemplate(patch: (t: TemplateConfig) => void): TemplateConfig {
  const t = getDefaultTemplateConfig()
  patch(t)
  return t
}

describe('renderInvoiceHtml – Grundaufbau', () => {
  it('liefert ein vollständiges A4-Dokument mit Seitenumbruch-Skript und Render-Signal', () => {
    const html = render()
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('@page { size: A4; margin: 0; }')
    expect(html).toContain('width: 210mm')
    expect(html).toContain('height: 297mm')
    expect(html).toContain('window.__FESTBUERO_RENDER_DONE__ = true')
    expect(html).toContain("type: 'festbuero:rendered'")
    expect(html).toContain('id="fb-doc"')
  })

  it('ersetzt Platzhalter in Betreff, Einleitung und Infozeilen', () => {
    const out = text(render(getSampleRenderData({ number: '2025-081', festivalName: 'Musterfest 2025', serviceDate: '2025-05-31' })))
    expect(out).toContain('Rechnung Nr. 2025-081')
    expect(out).toContain('Leistungen im Rahmen von „Musterfest 2025“.')
    expect(out).toContain('Leistungsdatum 31. Mai 2025')
    expect(out).toContain('Rechnungsdatum 1. Juni 2025')
    expect(out).toContain('Rechnungsnummer 2025-081')
    expect(out).not.toMatch(/\{(Rechnungsnummer|Festname|Leistungsdatum|Rechnungsdatum)\}/)
  })

  it('Entwurf ohne Nummer zeigt „(wird vergeben)“', () => {
    expect(text(render(getSampleRenderData({ number: null })))).toContain('Rechnung Nr. (wird vergeben)')
  })

  it('Beispieldaten ergeben exakt 670,20 € und zeigen alle 8 Positionen', () => {
    const html = render()
    const out = text(html)
    expect(out).toContain(`Gesamt 670,20${NBSP}€`)
    expect((html.match(/<td class="name">/g) ?? []).length).toBe(8)
    expect(out).toContain(`Festessen 14,50${NBSP}€ 18 261,00${NBSP}€`)
  })
})

describe('Positionstabelle', () => {
  it('zeigt Positionen mit Menge 0 standardmäßig mit „0“ und „– €“', () => {
    const out = text(render())
    expect(getDefaultTemplateConfig().table.showZeroQuantity).toBe(true)
    expect(out).toContain(`1 Maß Bier (ohne Bedienung) 9,70${NBSP}€ 0 –${NBSP}€`)
    expect(out).toContain(`Korsoeinsatz 2,00${NBSP}€ 0 –${NBSP}€`)
  })

  it('blendet Menge-0-Positionen aus, wenn der Schalter aus ist', () => {
    const html = render(getSampleRenderData(), withTemplate((t) => (t.table.showZeroQuantity = false)))
    const out = text(html)
    expect(out).not.toContain('1 Maß Bier')
    expect(out).not.toContain('Korsoeinsatz')
    expect(out).toContain('Festzeichen')
    expect((html.match(/<td class="name">/g) ?? []).length).toBe(5)
  })

  it('nutzt die Tabellen-Beschriftungen der Vorlage (escaped)', () => {
    const html = render(
      getSampleRenderData(),
      withTemplate((t) => {
        t.table.labels = { name: 'Artikel <b>', unitPrice: 'Preis', quantity: 'Anzahl', total: 'Betrag', vat: 'USt', grandTotal: 'Endsumme' }
      })
    )
    expect(html).toContain('<th>Artikel &lt;b&gt;</th><th>Preis</th><th>Anzahl</th><th>Betrag</th>')
    expect(text(html)).toContain(`Endsumme 670,20${NBSP}€`)
  })

  it('MwSt-Spalte nur ohne Steuerbefreiung und nur wenn eingeschaltet', () => {
    const vatOn = withTemplate((t) => (t.table.showVatColumn = true))
    const withoutExemption = render(getSampleRenderData({ taxExempt: false }), vatOn)
    expect(withoutExemption).toContain('<th>MwSt.</th>')
    expect(withoutExemption).toContain('<td class="num vat">19&nbsp;%</td>')
    expect(withoutExemption).toContain('<td class="num vat">7&nbsp;%</td>')
    expect(withoutExemption).toContain('colspan="4"')

    const exempt = render(getSampleRenderData({ taxExempt: true }), vatOn)
    expect(exempt).not.toContain('<th>MwSt.</th>')
    expect(exempt).not.toContain('class="num vat"')

    const off = render(getSampleRenderData({ taxExempt: false }))
    expect(off).not.toContain('<th>MwSt.</th>')
    expect(off).toContain('colspan="3"')
  })
})

describe('Summenbereich und Hinweise', () => {
  it('mit Steuerbefreiung: nur „Gesamt“, Steuerhinweis als erster Hinweis vor den freien Hinweisen', () => {
    const html = render(getSampleRenderData({ taxExempt: true, taxExemptText: 'Hinweis nach § 19 UStG.' }))
    const out = text(html)
    expect(out).toContain(`Gesamt 670,20${NBSP}€`)
    expect(out).not.toContain('enthaltene MwSt')
    expect(out).not.toContain('Nettobetrag')
    const notes = section(html, 'notes')
    const tax = notes.indexOf('Hinweis nach § 19 UStG.')
    const firstNote = notes.indexOf('durchlaufenden Posten')
    expect(tax).toBeGreaterThan(0)
    expect(firstNote).toBeGreaterThan(tax)
  })

  it('ohne Steuerbefreiung: Gesamt brutto, enthaltene MwSt je Satz, Nettobetrag (aus data.totals)', () => {
    const data = getSampleRenderData({ taxExempt: false })
    const out = text(render(data))
    const r7 = data.totals.byRate.find((b) => b.rate === 7)!
    const r19 = data.totals.byRate.find((b) => b.rate === 19)!
    expect(out).toContain(`Gesamt 670,20${NBSP}€`)
    expect(out).toContain(`enthaltene MwSt 7${NBSP}% 26,56${NBSP}€`)
    expect(r7.vatCents).toBe(2656)
    expect(out).toContain(`enthaltene MwSt 19${NBSP}% ${(r19.vatCents / 100).toFixed(2).replace('.', ',')}${NBSP}€`)
    expect(out).toContain(`Nettobetrag ${(data.totals.netCents / 100).toFixed(2).replace('.', ',')}${NBSP}€`)
    // kein Steuerhinweis ohne Befreiung
    expect(out).not.toContain('Kleinunternehmer')
    expect(out.indexOf('Gesamt')).toBeLessThan(out.indexOf('enthaltene MwSt 7'))
    expect(out.indexOf('enthaltene MwSt 19')).toBeLessThan(out.indexOf('Nettobetrag'))
  })

  it('Steuerhinweis übernimmt Schriftgröße und Ausrichtung aus taxNote', () => {
    const html = render(getSampleRenderData(), withTemplate((t) => (t.taxNote = { fontSizePt: 9, align: 'center' })))
    expect(html).toMatch(/class="rt fb-split tax-note" style="font-size:9pt;text-align:center"/)
  })

  it('freie Blöcke erscheinen in den Slots in der gespeicherten Reihenfolge', () => {
    const html = render(
      getSampleRenderData(),
      withTemplate((t) => {
        t.slots.afterIntro = [{ id: 'a1', html: '<p>NACH-EINLEITUNG</p>' }]
        t.slots.notes = [
          { id: 'n2', html: '<p>ZWEITER-HINWEIS</p>' },
          { id: 'n1', html: '<p>ERSTER-HINWEIS</p>' },
          { id: 'leer', html: '<p></p>' }
        ]
        t.slots.afterPayment = [{ id: 'p1', html: '<p>NACH-ZAHLUNG {Gesamtbetrag}</p>', fontSizePt: 9, align: 'right' }]
      })
    )
    const out = text(html)
    const order = ['Leistungen im Rahmen', 'NACH-EINLEITUNG', 'Bezeichnung', 'Kleinunternehmer', 'ZWEITER-HINWEIS', 'ERSTER-HINWEIS', 'Betrag bar erhalten', 'NACH-ZAHLUNG']
    const positions = order.map((s) => out.indexOf(s))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(out).toContain(`NACH-ZAHLUNG 670,20${NBSP}€`)
    expect(html).toContain('data-block="p1" style="font-size:9pt;text-align:right"')
    expect(html).not.toContain('data-block="leer"')
  })

  it('Zahlungstext mit Platzhaltern (Überweisung) und eigener Formatierung', () => {
    const data = getSampleRenderData({
      paymentKind: 'ueberweisung',
      paymentLabel: 'Überweisung',
      paymentText: '<p>Bitte überweisen Sie {Gesamtbetrag} bis zum {Fälligkeitsdatum} ({Zahlart}).</p>',
      dueDate: '2025-06-08'
    })
    const html = render(data, withTemplate((t) => (t.payment = { fontSizePt: 10, align: 'justify' })))
    expect(text(html)).toContain(`Bitte überweisen Sie 670,20${NBSP}€ bis zum 8. Juni 2025 (Überweisung).`)
    expect(html).toContain('class="rt fb-split payment" style="font-size:10pt;text-align:justify"')
  })

  it('Fußzeile mit 1 bis 4 Spalten', () => {
    const three = render(
      getSampleRenderData(),
      withTemplate((t) => {
        t.footer.columns = [
          { id: 'f1', html: '<p>Spalte A</p>' },
          { id: 'f2', html: '<p>Spalte B</p>', align: 'center' },
          { id: 'f3', html: '<p>Spalte C</p>', align: 'right' }
        ]
        t.footer.fontSizePt = 7
      })
    )
    expect((three.match(/class="rt fb-split footer-col"/g) ?? []).length).toBe(3)
    expect(three).toContain('font-size: 7pt;')
    const five = normalizeTemplateConfig({
      ...getDefaultTemplateConfig(),
      footer: { columns: [1, 2, 3, 4, 5].map((n) => ({ id: `f${n}`, html: `<p>${n}</p>` })) }
    })
    expect(five.footer.columns).toHaveLength(4)
    expect(normalizeTemplateConfig({ ...getDefaultTemplateConfig(), footer: { columns: [] } }).footer.columns).toHaveLength(1)
  })
})

describe('Storno', () => {
  it('Betreff aus stornoSubject, negative Beträge, kein Zahlungstext, Grund unter der Einleitung', () => {
    const data = getSampleStornoRenderData({ stornoReason: 'Personenzahl falsch' })
    const html = render(data)
    const out = text(html)
    expect(out).toContain('Stornorechnung Nr. 2025-082 zu Rechnung Nr. 2025-081')
    expect(out).not.toContain('Rechnung Nr. 2025-082 ') // Rechnungs-Betreff wird nicht verwendet
    expect(out).toContain(`Festzeichen 3,00${NBSP}€ -45 -135,00${NBSP}€`)
    expect(out).toContain(`Gesamt -670,20${NBSP}€`)
    expect(out).toContain(`1 Maß Bier (ohne Bedienung) 9,70${NBSP}€ 0 –${NBSP}€`)
    expect(out).not.toContain('Betrag bar erhalten')
    expect(html).not.toContain('class="rt fb-split payment"')
    const intro = out.indexOf('Leistungen im Rahmen')
    const reason = out.indexOf('Grund der Stornierung: Personenzahl falsch')
    expect(reason).toBeGreaterThan(intro)
    expect(reason).toBeLessThan(out.indexOf('Bezeichnung'))
  })

  it('ohne Grund keine Grundzeile; Rechnungen zeigen nie einen Stornogrund', () => {
    expect(text(render(getSampleStornoRenderData({ stornoReason: null })))).not.toContain('Grund der Stornierung')
    expect(text(render(getSampleRenderData({ stornoReason: 'x' })))).not.toContain('Grund der Stornierung')
  })

  it('Platzhalter {Stornogrund} und {Originalrechnung}', () => {
    const data = getSampleStornoRenderData({ stornoReason: 'Doppelt <erfasst>' })
    expect(replacePlaceholders('{Stornogrund}', data, { html: false })).toBe('Doppelt <erfasst>')
    expect(replacePlaceholders('{Stornogrund}', data, { html: true })).toBe('Doppelt &lt;erfasst&gt;')
    expect(replacePlaceholders('{Originalrechnung}', data, { html: false })).toBe('2025-081')
    expect(replacePlaceholders('[{Stornogrund}]', getSampleRenderData(), { html: false })).toBe('[]')
  })
})

describe('Anschriftfeld', () => {
  const base = getSampleRenderData().customer

  it('Verein: Name, Verein, Straße, „PLZ Ort“ – leere Zeilen entfallen', () => {
    expect(addressLines(base)).toEqual(['Max Mustermann', 'Radsportverein Beispielhausen', 'Hauptstraße 12', '01234 Beispielhausen'])
    expect(addressLines({ ...base, contactName: '  ', street: '' })).toEqual(['Radsportverein Beispielhausen', '01234 Beispielhausen'])
    expect(addressLines({ ...base, zip: '', city: 'Beispielhausen' })).toEqual([
      'Max Mustermann',
      'Radsportverein Beispielhausen',
      'Hauptstraße 12',
      'Beispielhausen'
    ])
  })

  it('Einzelrechnung: nur „Einzelrechnung“, außer Name oder Adresse sind eingetragen', () => {
    const empty = { ...base, kind: 'einzel' as const, contactName: '', clubName: '', street: '', zip: '', city: '' }
    expect(addressLines(empty)).toEqual(['Einzelrechnung'])
    expect(addressLines({ ...empty, contactName: 'Erika Musterfrau' })).toEqual(['Erika Musterfrau'])
    expect(addressLines({ ...empty, street: 'Weg 1', zip: '12345', city: 'Musterstadt' })).toEqual(['Weg 1', '12345 Musterstadt'])
    const html = render(getSampleRenderData({ customer: empty, persons: null }))
    expect(section(html, 'address')).toContain('<div>Einzelrechnung</div>')
  })
})

describe('Sicherheit und Eigenständigkeit', () => {
  it('escaped alle Kundendaten (XSS: <script> im Vereinsnamen)', () => {
    const evil = '<script>alert("x")</script>'
    const data = getSampleRenderData({
      customer: { ...getSampleRenderData().customer, clubName: evil, contactName: '<img src=x onerror=alert(1)>' },
      lines: [{ name: evil, priceCents: 100, vatRate: 7, quantity: 1, lineTotalCents: 100 }],
      festivalName: evil
    })
    const t = withTemplate((tpl) => {
      tpl.intro.html = '<p>{Verein} – {Festname}</p>'
      tpl.info.rows.push({ id: 'x', label: '<b>Verein</b>', value: '{Verein}' })
    })
    const html = render(data, t)
    expect((html.match(/<script>/g) ?? []).length).toBe(1) // nur das eigene Layout-Skript
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('<th>&lt;b&gt;Verein&lt;/b&gt;</th>')
  })

  it('bereinigt Rich-Text aus Vorlage und Zahlungstext', () => {
    const t = withTemplate((tpl) => {
      tpl.sender.html = '<p onclick="evil()">Absender<script>alert(1)</script><img src="http://example.com/x.png"></p>'
    })
    const html = render(getSampleRenderData({ paymentText: '<p>Bar <iframe src="file:///etc/passwd"></iframe><strong>fett</p>' }), t)
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('example.com')
    expect((html.match(/<script>/g) ?? []).length).toBe(1)
    expect(html).toContain('Bar <strong>fett</strong></p>')
  })

  it('enthält keine externen Verweise (http:, https:, file:, relative Pfade)', () => {
    for (const data of [getSampleRenderData(), getSampleStornoRenderData(), getManyLinesSampleRenderData(40)]) {
      const html = render(data, getDefaultTemplateConfig(), LOGO)
      expect(html).not.toMatch(/https?:/i)
      expect(html).not.toMatch(/file:/i)
      expect(html).not.toMatch(/<link\b/i)
      for (const m of html.matchAll(/\bsrc="([^"]*)"/g)) expect(m[1]).toMatch(/^data:image\//)
      for (const m of html.matchAll(/url\(([^)]*)\)/g)) expect(m[1]).toMatch(/^data:font\/woff2;base64,/)
    }
  })

  it('Logo nur als data:-URL und nur wenn aktiviert; Position und Breite aus der Vorlage', () => {
    const on = render(getSampleRenderData(), withTemplate((t) => (t.logo = { enabled: true, position: 'center', widthMm: 40 })), LOGO)
    expect(on).toContain('<div class="logo pos-center"><img src="data:image/svg+xml;base64,')
    expect(on).toContain('style="width:40mm"')
    const off = render(getSampleRenderData(), withTemplate((t) => (t.logo.enabled = false)), LOGO)
    expect(off).not.toContain('class="logo')
    const external = render(getSampleRenderData(), getDefaultTemplateConfig(), 'file:///tmp/logo.png')
    expect(external).not.toContain('class="logo')
    expect(external).not.toContain('file:')
  })
})

describe('Schriften', () => {
  it('bettet nur die gewählte Schrift ein (alle 4 Schnitte als woff2-data:-URL)', () => {
    const arimo = render()
    expect(arimo).toContain('font-family:"FB Arimo"')
    expect((arimo.match(/@font-face/g) ?? []).length).toBe(4)
    expect(arimo).not.toContain('"FB Tinos"')

    const tinos = render(getSampleRenderData(), withTemplate((t) => (t.fontFamily = 'tinos')))
    expect(tinos).toContain('font-family: "FB Tinos", \'Times New Roman\'')
    expect(tinos).toContain('font-family:"FB Tinos";font-style:italic;font-weight:700')
    expect(tinos).not.toContain('"FB Arimo"')
    expect(tinos).toContain('FAMILY = "\\"FB Tinos\\""')
  })

  it('alle sieben Schriften sind eingebunden und werden zwischengespeichert', () => {
    expect(FONT_IDS).toHaveLength(7)
    for (const id of FONT_IDS) {
      const css = getFontFaceCss(id)
      expect((css.match(/data:font\/woff2;base64,/g) ?? []).length).toBe(4)
      expect(getFontFaceCss(id)).toBe(css)
    }
  })

  it('Grundschriftgröße und Blockgrößen wirken', () => {
    const html = render(getSampleRenderData(), withTemplate((t) => {
      t.baseFontSizePt = 10.5
      t.subject.fontSizePt = 18
      t.subject.align = 'center'
    }))
    expect(html).toContain('font-size: 10.5pt;')
    expect(html).toMatch(/class="rt fb-split subject" data-block="subject" style="font-size:18pt;text-align:center"/)
  })
})

describe('Daten und Vorlage', () => {
  it('invoiceToRenderData baut nur aus dem Snapshot, today = Rechnungsdatum, Stornogrund übernommen', () => {
    const sample = getSampleStornoRenderData()
    const invoice = {
      id: 7,
      festivalId: 1,
      number: '2025-082',
      seq: 82,
      type: 'storno',
      status: 'abgeschlossen',
      originalInvoiceId: 6,
      originalNumber: '2025-081',
      stornoReason: 'Grund X',
      stornoInvoiceId: null,
      stornoNumber: null,
      customer: sample.customer,
      persons: 45,
      paymentKind: 'bar',
      paymentLabel: 'Bar',
      paymentText: '<p>bar</p>',
      dueDays: 7,
      invoiceDate: '2025-06-03',
      serviceDate: '2025-06-01',
      dueDate: '2025-06-10',
      totals: sample.totals,
      taxExempt: true,
      taxExemptText: 'Hinweis',
      festivalName: 'Snapshot-Fest',
      template: getDefaultTemplateConfig(),
      logoFile: null,
      pdfPath: null,
      pdfCreatedAt: null,
      printed: false,
      printedAt: null,
      printError: null,
      createdAt: '2025-06-03T10:00:00.000Z',
      lines: sample.lines.map((l, i) => ({ ...l, id: i + 1, invoiceId: 7, position: i + 1, productId: null }))
    } satisfies Invoice
    const data = invoiceToRenderData(invoice)
    expect(data.today).toBe('2025-06-03')
    expect(data.stornoReason).toBe('Grund X')
    expect(data.festivalName).toBe('Snapshot-Fest')
    expect(data.lines[2]).toEqual({ name: 'Festzeichen', priceCents: 300, vatRate: 19, quantity: -45, lineTotalCents: -13500 })
    expect(invoiceToRenderData({ ...invoice, type: 'rechnung', stornoReason: 'egal' }).stornoReason).toBeNull()
  })

  it('normalizeTemplateConfig ergänzt fehlende Felder und begrenzt Werte', () => {
    const n = normalizeTemplateConfig({ fontFamily: 'comic-sans', baseFontSizePt: 200, logo: { widthMm: 1 }, slots: { notes: 'x' } })
    expect(n.fontFamily).toBe('arimo')
    expect(n.baseFontSizePt).toBe(48)
    expect(n.logo.widthMm).toBe(10)
    expect(n.slots.notes).toEqual(getDefaultTemplateConfig().slots.notes)
    expect(normalizeTemplateConfig(null)).toEqual(getDefaultTemplateConfig())
    expect(normalizeTemplateConfig(getDefaultTemplateConfig())).toEqual(getDefaultTemplateConfig())
    // Rendern einer alten/teilweisen Vorlage wirft nicht
    expect(() => render(getSampleRenderData(), { version: 1 } as unknown as TemplateConfig)).not.toThrow()
  })

  it('getDefaultTemplateConfig ist deterministisch und neutral', () => {
    const a = JSON.stringify(getDefaultTemplateConfig())
    expect(JSON.stringify(getDefaultTemplateConfig())).toBe(a)
    expect(a).toContain('Musterverein e.V.')
    expect(getDefaultTemplateConfig().logo).toEqual({ enabled: true, position: 'right', widthMm: 35 })
  })

  it('buildSampleRenderData übernimmt Fest-Einstellungen und Zahlungsart', () => {
    const festival = {
      name: 'Sommerfest',
      festivalDate: '2026-07-04',
      taxExempt: false,
      taxExemptText: '',
      numberPrefix: 'SF-',
      numberDigits: 4,
      numberNext: 12
    }
    const paymentMethods = [
      { kind: 'bar' as const, label: 'Bar', text: '<p>bar</p>', dueDays: 0 },
      { kind: 'ueberweisung' as const, label: 'Überweisung', text: '<p>Bis {Fälligkeitsdatum_DE}</p>', dueDays: 14 }
    ]
    const data = buildSampleRenderData({ festival, paymentMethods, paymentKind: 'ueberweisung' })
    expect(data).toMatchObject({ festivalName: 'Sommerfest', number: 'SF-0012', taxExempt: false, dueDate: '2026-07-18', paymentLabel: 'Überweisung' })
    expect(text(render(data))).toContain('Bis 18.07.2026')
    const storno = buildSampleRenderData({ festival, paymentMethods, type: 'storno' })
    expect(storno).toMatchObject({ type: 'storno', number: 'SF-0013', originalNumber: 'SF-0012' })
    expect(storno.totals.grossCents).toBe(-67020)
  })

  it('Layout-Maße entsprechen der Beispielrechnung (Satzspiegel, Fußzeile)', () => {
    expect(LAYOUT_MM.marginLeft).toBeCloseTo(22.6, 1)
    expect(210 - LAYOUT_MM.marginRight).toBeCloseTo(198.1, 1)
    expect(LAYOUT_MM.returnTop).toBeCloseTo(45.7, 1)
  })
})
