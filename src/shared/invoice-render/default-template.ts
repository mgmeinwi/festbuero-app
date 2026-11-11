/**
 * Standard-Vorlage nach dem Muster der Beispielrechnung (DIN 5008, A4) – mit NEUTRALEN Musterdaten
 * (Musterverein e.V. …). Aufbau, Schriftgrößen und Ausrichtungen entsprechen der Beispielrechnung:
 * Arimo (metrisch identisch mit Arial) 12 pt, Rücksendezeile/Absender/Fußzeile 8 pt, Betreff 16 pt,
 * Hinweise und Zahlungstext 11 pt, Logo rechts oben.
 *
 * Wird bei jeder Fest-Anlage und bei „Auf Standard zurücksetzen“ verwendet. Muss deterministisch sein
 * (feste IDs), weil Tests das Ergebnis vergleichen.
 *
 * Zuständig: Bereich „Vorlage“.
 */
import type { TemplateConfig } from '../types'

/** Platzhalter-Baustein, wie ihn der Rich-Text-Editor erzeugt. */
function ph(field: string): string {
  return `<span data-placeholder="${field}">{${field}}</span>`
}

export function getDefaultTemplateConfig(): TemplateConfig {
  return {
    version: 1,
    fontFamily: 'arimo',
    baseFontSizePt: 12,
    logo: { enabled: true, position: 'right', widthMm: 35 },
    returnLine: {
      id: 'returnLine',
      html: '<p>Musterverein e.V. | Musterstraße 1 | 12345 Musterstadt</p>',
      fontSizePt: 8,
      align: 'left'
    },
    address: { fontSizePt: 12 },
    sender: {
      id: 'sender',
      html:
        '<p>Musterverein e.V.</p>' +
        '<p>Musterstraße 1</p>' +
        '<p>12345 Musterstadt</p>' +
        '<p>E-Mail: info@musterverein.example</p>',
      fontSizePt: 8,
      align: 'right'
    },
    info: {
      rows: [
        { id: 'info-leistungsdatum', label: 'Leistungsdatum', value: '{Leistungsdatum}' },
        { id: 'info-rechnungsdatum', label: 'Rechnungsdatum', value: '{Rechnungsdatum}' },
        { id: 'info-rechnungsnummer', label: 'Rechnungsnummer', value: '{Rechnungsnummer}' }
      ],
      fontSizePt: 12
    },
    subject: {
      id: 'subject',
      html: `<p>Rechnung Nr. ${ph('Rechnungsnummer')}</p>`,
      fontSizePt: 16,
      align: 'left'
    },
    stornoSubject: {
      id: 'stornoSubject',
      html: `<p>Stornorechnung Nr. ${ph('Rechnungsnummer')} zu Rechnung Nr. ${ph('Originalrechnung')}</p>`,
      fontSizePt: 16,
      align: 'left'
    },
    intro: {
      id: 'intro',
      html: `<p>Leistungen im Rahmen von „${ph('Festname')}“.</p>`,
      align: 'left'
    },
    table: {
      showZeroQuantity: true,
      showVatColumn: false,
      labels: {
        name: 'Bezeichnung',
        unitPrice: 'Einzelpreis',
        quantity: 'Menge',
        total: 'Summe',
        vat: 'MwSt.',
        grandTotal: 'Gesamt'
      }
    },
    slots: {
      afterIntro: [],
      notes: [
        {
          id: 'note-durchlaufender-posten',
          html: '<p>Beim Verkauf der Essensmarken handelt es sich um einen durchlaufenden Posten für den Musterverein e.V.</p>',
          fontSizePt: 11,
          align: 'left'
        },
        {
          id: 'note-festessen',
          html: '<p>Der Verkauf des Festessens erfolgt im Namen von Muster-Partyservice.</p>',
          fontSizePt: 11,
          align: 'left'
        }
      ],
      afterPayment: []
    },
    payment: { fontSizePt: 11, align: 'left' },
    taxNote: { fontSizePt: 11, align: 'left' },
    footer: {
      columns: [
        {
          id: 'footer-1',
          html:
            '<p><strong>Musterverein e.V.</strong>, Registergericht Musterstadt VR 00000, <strong>St.-Nr.:</strong> 000/000/00000</p>' +
            '<p>Vertreten durch 1. Vorstand Max Mustermann</p>' +
            '<p><strong>Bankverbindung:</strong> Musterbank eG, IBAN: DE00 0000 0000 0000 0000 00, BIC: MUSTDEXXXXX</p>',
          align: 'left'
        }
      ],
      fontSizePt: 8
    }
  }
}
