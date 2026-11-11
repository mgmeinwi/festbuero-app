/**
 * Standard-Vorlage nach dem Muster der Beispielrechnung (DIN 5008, A4) – mit NEUTRALEN Musterdaten.
 * Wird bei jeder Fest-Anlage und bei „Vorlage zurücksetzen“ verwendet.
 *
 * Zuständig: Bereich „Vorlage“ (darf Inhalte verfeinern; Funktionssignatur bleibt).
 */
import type { TemplateConfig } from '../types'

export function getDefaultTemplateConfig(): TemplateConfig {
  return {
    version: 1,
    fontFamily: 'arimo',
    baseFontSizePt: 11,
    logo: { enabled: true, position: 'right', widthMm: 35 },
    returnLine: {
      id: 'returnLine',
      html: '<p>Musterverein e.V. | Musterstraße 1 | 12345 Musterstadt</p>',
      fontSizePt: 8,
      align: 'left'
    },
    address: { fontSizePt: 11 },
    sender: {
      id: 'sender',
      html:
        '<p><strong>Musterverein e.V.</strong></p>' +
        '<p>Musterstraße 1</p>' +
        '<p>12345 Musterstadt</p>' +
        '<p>E-Mail: info@musterverein.example</p>',
      fontSizePt: 10,
      align: 'right'
    },
    info: {
      rows: [
        { id: 'info-leistungsdatum', label: 'Leistungsdatum', value: '{Leistungsdatum}' },
        { id: 'info-rechnungsdatum', label: 'Rechnungsdatum', value: '{Rechnungsdatum}' },
        { id: 'info-rechnungsnummer', label: 'Rechnungsnummer', value: '{Rechnungsnummer}' }
      ],
      fontSizePt: 10
    },
    subject: {
      id: 'subject',
      html: '<p><strong>Rechnung Nr. {Rechnungsnummer}</strong></p>',
      fontSizePt: 12,
      align: 'left'
    },
    stornoSubject: {
      id: 'stornoSubject',
      html: '<p><strong>Stornorechnung Nr. {Rechnungsnummer} zu Rechnung Nr. {Originalrechnung}</strong></p>',
      fontSizePt: 12,
      align: 'left'
    },
    intro: {
      id: 'intro',
      html: '<p>Leistungen im Rahmen des Gründungsfestes.</p>',
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
          align: 'left'
        },
        {
          id: 'note-festessen',
          html: '<p>Der Verkauf des Festessens erfolgt im Namen von Muster-Partyservice.</p>',
          align: 'left'
        }
      ],
      afterPayment: []
    },
    payment: { align: 'left' },
    footer: {
      columns: [
        {
          id: 'footer-1',
          html:
            '<p>Musterverein e.V., Registergericht Musterstadt VR 00000, St.-Nr.: 000/000/00000</p>' +
            '<p>Vertreten durch 1. Vorstand Max Mustermann</p>' +
            '<p>Bankverbindung: Musterbank eG, IBAN: DE00 0000 0000 0000 0000 00, BIC: MUSTDEXXXXX</p>',
          align: 'center'
        }
      ],
      fontSizePt: 8
    }
  }
}
