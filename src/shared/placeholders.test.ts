import { describe, expect, it } from 'vitest'
import { getSampleRenderData } from './invoice-render/sample-data'
import { NBSP } from './money'
import {
  buildPlaceholderValues,
  findPlaceholders,
  NUMBER_PENDING_TEXT,
  PLACEHOLDERS,
  replacePlaceholders,
  resolvePlaceholderField
} from './placeholders'

const data = getSampleRenderData({
  number: '2025-081',
  invoiceDate: '2025-06-01',
  serviceDate: '2025-05-31',
  dueDate: '2025-06-08',
  today: '2025-06-02'
})

describe('PLACEHOLDERS', () => {
  it('enthält alle geforderten Felder mit Beispielwerten', () => {
    const tokens = PLACEHOLDERS.map((p) => p.token)
    for (const t of [
      '{Rechnungsnummer}',
      '{Rechnungsdatum}',
      '{Rechnungsdatum_Lang}',
      '{Rechnungsdatum_DE}',
      '{Rechnungsdatum_ISO}',
      '{Leistungsdatum}',
      '{Leistungsdatum_DE}',
      '{Heute}',
      '{Heute_ISO}',
      '{Fälligkeitsdatum}',
      '{Fälligkeitsdatum_Lang}',
      '{Gesamtbetrag}',
      '{Verein}',
      '{Name}',
      '{Straße}',
      '{PLZ}',
      '{Ort}',
      '{Personen}',
      '{Zahlart}',
      '{Festname}',
      '{Originalrechnung}'
    ]) {
      expect(tokens).toContain(t)
    }
    expect(new Set(tokens).size).toBe(tokens.length)
    for (const p of PLACEHOLDERS) {
      expect(p.label.length).toBeGreaterThan(0)
      expect(p.example.length).toBeGreaterThan(0)
    }
  })

  it('jeder definierte Platzhalter wird ersetzt', () => {
    for (const p of PLACEHOLDERS) {
      const out = replacePlaceholders(p.token, data, { html: false })
      expect(out).not.toBe(p.token)
    }
  })
})

describe('replacePlaceholders', () => {
  it('ersetzt Text- und Datumsfelder', () => {
    expect(replacePlaceholders('Rechnung Nr. {Rechnungsnummer}', data, { html: false })).toBe('Rechnung Nr. 2025-081')
    expect(replacePlaceholders('{Rechnungsdatum}', data, { html: false })).toBe('1. Juni 2025')
    expect(replacePlaceholders('{Rechnungsdatum_Lang}', data, { html: false })).toBe('1. Juni 2025')
    expect(replacePlaceholders('{Rechnungsdatum_DE}', data, { html: false })).toBe('01.06.2025')
    expect(replacePlaceholders('{Rechnungsdatum_ISO}', data, { html: false })).toBe('2025-06-01')
    expect(replacePlaceholders('{Rechnungsdatum_Kurz}', data, { html: false })).toBe('1.6.2025')
    expect(replacePlaceholders('{Leistungsdatum}', data, { html: false })).toBe('31. Mai 2025')
    expect(replacePlaceholders('{Heute_DE}', data, { html: false })).toBe('02.06.2025')
    expect(replacePlaceholders('{Fälligkeitsdatum}', data, { html: false })).toBe('8. Juni 2025')
    expect(replacePlaceholders('{Gesamtbetrag}', data, { html: false })).toBe(`670,20${NBSP}€`)
    expect(replacePlaceholders('{Verein}, {Name}, {Straße}, {PLZ} {Ort}', data, { html: false })).toBe(
      'Radsportverein Beispielhausen, Max Mustermann, Hauptstraße 12, 01234 Beispielhausen'
    )
    expect(replacePlaceholders('{Personen} Personen, {Zahlart}', data, { html: false })).toBe('45 Personen, Bar')
    expect(replacePlaceholders('{Festname}', data, { html: false })).toBe('100-jähriges Gründungsfest')
  })

  it('freie date-fns-Muster als Variante', () => {
    expect(replacePlaceholders('{Rechnungsdatum_dd.MM.yyyy}', data, { html: false })).toBe('01.06.2025')
    expect(replacePlaceholders('{Rechnungsdatum_dd.MM.yy}', data, { html: false })).toBe('01.06.25')
    expect(replacePlaceholders('{Heute_EEEE, d. MMMM}', data, { html: false })).toBe('Montag, 2. Juni')
    expect(replacePlaceholders('{Rechnungsdatum_foo}', data, { html: false })).toBe('1. Juni 2025')
  })

  it('Feldnamen tolerant (Groß-/Kleinschreibung, Umlaute)', () => {
    expect(replacePlaceholders('{rechnungsnummer}', data, { html: false })).toBe('2025-081')
    expect(replacePlaceholders('{RECHNUNGSDATUM_de}', data, { html: false })).toBe('01.06.2025')
    expect(replacePlaceholders('{Strasse}', data, { html: false })).toBe('Hauptstraße 12')
    expect(replacePlaceholders('{Faelligkeitsdatum_ISO}', data, { html: false })).toBe('2025-06-08')
    expect(resolvePlaceholderField('plz')).toBe('PLZ')
  })

  it('unbekannte Platzhalter bleiben unverändert', () => {
    expect(replacePlaceholders('{Unbekannt} {Verein_Lang} {} {Rechnungsnummer', data, { html: false })).toBe(
      '{Unbekannt} {Verein_Lang} {} {Rechnungsnummer'
    )
  })

  it('fehlende Nummer im Entwurf', () => {
    const draft = { ...data, number: null }
    expect(replacePlaceholders('Nr. {Rechnungsnummer}', draft, { html: false })).toBe(`Nr. ${NUMBER_PENDING_TEXT}`)
  })

  it('Originalrechnung und Storno', () => {
    const storno = { ...data, type: 'storno' as const, number: '2025-090', originalNumber: '2025-081' }
    expect(
      replacePlaceholders('Stornorechnung Nr. {Rechnungsnummer} zu Rechnung Nr. {Originalrechnung}', storno, {
        html: false
      })
    ).toBe('Stornorechnung Nr. 2025-090 zu Rechnung Nr. 2025-081')
    expect(replacePlaceholders('{Originalrechnung}', data, { html: false })).toBe('')
  })

  it('Einzelrechnung ohne Personen', () => {
    const einzel = {
      ...data,
      persons: null,
      customer: { ...data.customer, kind: 'einzel' as const, clubName: '', contactName: '' }
    }
    expect(replacePlaceholders('[{Personen}][{Verein}]', einzel, { html: false })).toBe('[][]')
  })

  it('HTML-Modus escaped eingesetzte Werte', () => {
    const evil = { ...data, customer: { ...data.customer, clubName: 'Turn- & Sport <Verein> "e.V."' } }
    expect(replacePlaceholders('<p>{Verein}</p>', evil, { html: true })).toBe(
      '<p>Turn- &amp; Sport &lt;Verein&gt; &quot;e.V.&quot;</p>'
    )
    expect(replacePlaceholders('<p>{Verein}</p>', evil, { html: false })).toBe('<p>Turn- & Sport <Verein> "e.V."</p>')
  })

  it('TipTap-Baustein: Text im Inneren wird ersetzt, Attribut bleibt', () => {
    const html = '<p>Nr. <span data-placeholder="Rechnungsnummer">{Rechnungsnummer}</span></p>'
    expect(replacePlaceholders(html, data, { html: true })).toBe(
      '<p>Nr. <span data-placeholder="Rechnungsnummer">2025-081</span></p>'
    )
  })

  it('HTML-Entities in Varianten werden dekodiert', () => {
    // „&amp;“ wird im Muster zu „&“ dekodiert und im Ergebnis wieder escaped
    expect(replacePlaceholders("{Rechnungsdatum_d.M.yyyy &amp;&amp; 'x'}", data, { html: true })).toBe(
      '1.6.2025 &amp;&amp; x'
    )
    expect(replacePlaceholders('{Rechnungsdatum_&#39;am&#39; d.M.}', data, { html: true })).toBe('am 1.6.')
  })

  it('Standard-Datumsvariante einstellbar (Dateinamen)', () => {
    expect(replacePlaceholders('{Rechnungsdatum}', data, { html: false, defaultDateVariant: 'ISO' })).toBe(
      '2025-06-01'
    )
  })

  it('akzeptiert vorberechnete Werte', () => {
    const values = buildPlaceholderValues(data)
    expect(replacePlaceholders('{Rechnungsnummer}', values, { html: false })).toBe('2025-081')
  })

  it('leerer Text', () => {
    expect(replacePlaceholders('', data, { html: true })).toBe('')
  })
})

describe('findPlaceholders', () => {
  it('erkennt bekannte und unbekannte Tokens', () => {
    const found = findPlaceholders('{Rechnungsnummer} {Rechnungsdatum_DE} {Foo} {Verein_x}')
    expect(found.map((f) => [f.token, f.known])).toEqual([
      ['{Rechnungsnummer}', true],
      ['{Rechnungsdatum_DE}', true],
      ['{Foo}', false],
      ['{Verein_x}', false]
    ])
  })
})
