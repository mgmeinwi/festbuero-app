/**
 * Blöcke des Vorlagen-Editors in Seitenreihenfolge (Blockliste links bzw. Auswahl bei schmalen Fenstern).
 */
import {
  Building2,
  CornerUpLeft,
  Heading1,
  Info,
  LayoutList,
  type LucideIcon,
  MapPin,
  MessageSquareText,
  PanelBottom,
  ReceiptText,
  Settings2,
  Table2,
  Text,
  Undo2,
  Wallet
} from 'lucide-react'
import { richHtmlToPlainText } from '@shared/invoice-render/sanitize'
import type { TemplateConfig } from '@shared/types'

export type BlockKey =
  | 'general'
  | 'returnLine'
  | 'address'
  | 'sender'
  | 'info'
  | 'subject'
  | 'stornoSubject'
  | 'intro'
  | 'afterIntro'
  | 'table'
  | 'notes'
  | 'payment'
  | 'afterPayment'
  | 'footer'

export type SlotKey = keyof TemplateConfig['slots']
export type RichBlockKey = 'returnLine' | 'sender' | 'subject' | 'stornoSubject' | 'intro'

export interface BlockDefinition {
  key: BlockKey
  label: string
  description: string
  icon: LucideIcon
  /** Kurzinfo in der Blockliste */
  summary(config: TemplateConfig): string
}

function plain(html: string): string {
  return richHtmlToPlainText(html.replace(/<span data-placeholder="([^"]+)">\{[^}]*\}<\/span>/g, '{$1}')) || '(leer)'
}

function count(n: number, one: string, many: string): string {
  return n === 0 ? `keine ${many}` : `${n} ${n === 1 ? one : many}`
}

export const BLOCKS: readonly BlockDefinition[] = [
  {
    key: 'general',
    label: 'Allgemein',
    description: 'Schriftart, Grundschriftgröße und Logo der ganzen Vorlage.',
    icon: Settings2,
    summary: (c) => `${c.baseFontSizePt} pt · Logo ${c.logo.enabled ? 'an' : 'aus'}`
  },
  {
    key: 'returnLine',
    label: 'Rücksendezeile',
    description: 'Kleine Absenderzeile über dem Anschriftfeld (sichtbar im Fensterumschlag).',
    icon: CornerUpLeft,
    summary: (c) => plain(c.returnLine.html)
  },
  {
    key: 'address',
    label: 'Anschriftfeld',
    description: 'Wird automatisch aus dem Kunden erzeugt (Name, Verein, Straße, PLZ Ort bzw. „Einzelrechnung“).',
    icon: MapPin,
    summary: (c) => `automatisch · ${c.address.fontSizePt} pt`
  },
  {
    key: 'sender',
    label: 'Absender',
    description: 'Absenderblock rechts oben, rechtsbündig.',
    icon: Building2,
    summary: (c) => plain(c.sender.html)
  },
  {
    key: 'info',
    label: 'Infozeilen',
    description: 'Rechts unter dem Absender: Beschriftung fett, Wert mit Feldern (z. B. Rechnungsdatum).',
    icon: Info,
    summary: (c) => count(c.info.rows.length, 'Zeile', 'Zeilen')
  },
  {
    key: 'subject',
    label: 'Betreff',
    description: 'Überschrift über der Tabelle.',
    icon: Heading1,
    summary: (c) => plain(c.subject.html)
  },
  {
    key: 'stornoSubject',
    label: 'Storno-Betreff',
    description: 'Betreff von Stornorechnungen (statt des normalen Betreffs).',
    icon: Undo2,
    summary: (c) => plain(c.stornoSubject.html)
  },
  {
    key: 'intro',
    label: 'Einleitung',
    description: 'Text unter dem Betreff.',
    icon: Text,
    summary: (c) => plain(c.intro.html)
  },
  {
    key: 'afterIntro',
    label: 'Nach der Einleitung',
    description: 'Freie Textblöcke zwischen Einleitung und Tabelle.',
    icon: LayoutList,
    summary: (c) => count(c.slots.afterIntro.length, 'Block', 'Blöcke')
  },
  {
    key: 'table',
    label: 'Positionstabelle',
    description: 'Spaltenbeschriftungen und Anzeigeoptionen der Positionen.',
    icon: Table2,
    summary: (c) => `Menge 0 ${c.table.showZeroQuantity ? 'sichtbar' : 'ausgeblendet'}`
  },
  {
    key: 'notes',
    label: 'Hinweise',
    description: 'Unter der Tabelle: zuerst der Steuerhinweis (automatisch), dann eigene Hinweistexte.',
    icon: MessageSquareText,
    summary: (c) => count(c.slots.notes.length, 'Hinweis', 'Hinweise')
  },
  {
    key: 'payment',
    label: 'Zahlungstext',
    description: 'Text der gewählten Zahlungsart (Inhalt unter „Zahlarten“). Bei Stornos nicht gedruckt.',
    icon: Wallet,
    summary: (c) => (c.payment.fontSizePt ? `${c.payment.fontSizePt} pt` : 'Standardgröße')
  },
  {
    key: 'afterPayment',
    label: 'Nach dem Zahlungstext',
    description: 'Freie Textblöcke unter dem Zahlungstext.',
    icon: ReceiptText,
    summary: (c) => count(c.slots.afterPayment.length, 'Block', 'Blöcke')
  },
  {
    key: 'footer',
    label: 'Fußzeile',
    description: 'Am Seitenende jeder Seite, 1 bis 4 Spalten.',
    icon: PanelBottom,
    summary: (c) => count(c.footer.columns.length, 'Spalte', 'Spalten')
  }
]

export function getBlock(key: BlockKey): BlockDefinition {
  return BLOCKS.find((b) => b.key === key) ?? BLOCKS[0]!
}

/** Neue, eindeutige Block-ID */
export function newBlockId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}
