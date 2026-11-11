/**
 * Vorlagen-Renderer: TemplateConfig + InvoiceRenderData → vollständiges A4-HTML-Dokument.
 * EINZIGE Quelle für Vorschau (iframe) UND PDF (printToPDF).
 *
 * Vertrag für das erzeugte HTML:
 * - eigenständig: Schriften als data:-URLs eingebettet, Logo als data:-URL, keine externen Verweise
 *   (kein http:, file:, kein relativer Pfad) → identisches Ergebnis im Vorschau-iframe und im PDF-Fenster,
 * - A4 (`@page { size: A4; margin: 0 }`), alle Maße in mm, jede Seite ist ein `<section class="page">`
 *   mit exakt 210 × 297 mm; am Bildschirm stehen die Seiten mit 6 mm Abstand untereinander,
 * - ein Inline-Skript verteilt den Inhalt auf Seiten (siehe layout-script.ts), setzt danach
 *   `window.__FESTBUERO_RENDER_DONE__ = true` und meldet `parent.postMessage({ type: 'festbuero:rendered',
 *   height, pages }, '*')`.
 *
 * Layout nach der Beispielrechnung (DIN 5008): Logo rechts oben, Rücksendezeile + Anschriftfeld links in
 * Fensterposition, Absender + Infoblock rechts, Betreff, Einleitung, Positionstabelle, Summen, Hinweise,
 * Zahlungstext, Fußzeile am Seitenende.
 *
 * Zuständig: Bereich „Vorlage“.
 */
import { formatEuro, formatEuroOrDash } from '../money'
import { buildPlaceholderValues, escapeHtml, replacePlaceholders, type PlaceholderValues } from '../placeholders'
import type { CustomerSnapshot, Invoice, InvoiceRenderData, RichTextBlock, TemplateConfig, TextAlign } from '../types'
import { fontFamilyCss, fontFamilyName, getFontFaceCss } from './fonts'
import { buildLayoutScript } from './layout-script'
import { normalizeTemplateConfig } from './normalize'
import { sanitizeRichHtml } from './sanitize'

export { getDefaultTemplateConfig } from './default-template'
export { normalizeTemplateConfig, TEMPLATE_LIMITS } from './normalize'
export { sanitizeRichHtml, richHtmlToPlainText } from './sanitize'
export { FONT_IDS, FONT_META, fontFamilyCss } from './fonts-meta'

export interface RenderInvoiceInput {
  data: InvoiceRenderData
  template: TemplateConfig
  /** Logo als data:-URL oder null */
  logoDataUrl: string | null
}

/** Nachricht, die das gerenderte Dokument an die Vorschau sendet. */
export interface RenderedMessage {
  type: 'festbuero:rendered'
  /** Gesamthöhe des Dokuments in CSS-Pixeln (alle Seiten inkl. Abstand am Bildschirm) */
  height: number
  /** Anzahl der A4-Seiten (ab Version mit Seitenumbruch immer gesetzt) */
  pages?: number
  /** Wert des Attributs `data-render-id` am <html> (setzt die Vorschau zur Zuordnung), sonst null */
  renderId?: string | null
}

/**
 * Maße des Seitenrasters in mm (abgeleitet aus der Beispielrechnung, Ursprung = linke obere Seitenecke).
 * Exportiert für Vorschau (Seitenabstand) und Tests.
 */
export const LAYOUT_MM = {
  pageWidth: 210,
  pageHeight: 297,
  /** linker/rechter Satzspiegel */
  marginLeft: 22.6,
  marginRight: 11.9,
  logoTop: 12,
  /** maximale Logohöhe rechts (bis über den Absender) bzw. links/mittig (bis über die Rücksendezeile) */
  logoMaxHeightRight: 44,
  logoMaxHeightOther: 31,
  /** Rücksendezeile: Oberkante und Höhe der Zone über dem Anschriftfeld */
  returnTop: 45.7,
  returnHeight: 13,
  windowWidth: 85,
  addressMinHeight: 27.3,
  /** Absenderblock rechts: Oberkante, Mindesthöhe (5 Zeilen à 8 pt), Abstand zum Infoblock */
  sideTop: 59.55,
  senderMinHeight: 19.4,
  infoGap: 11.45,
  /** Unterkante des Briefkopfs (Infoblock) */
  headMinHeight: 106.3,
  /** Abstand Briefkopf → Betreff */
  subjectGap: 15.8,
  tableGap: 5.3,
  headerRule: 0.6,
  firstRowGap: 5,
  totalsGap: 5.3,
  notesGap: 10.9,
  paymentGap: 12,
  slotGap: 4,
  /** Fußzeile: Abstand der Unterkante vom Seitenende */
  footerBottom: 20.2,
  pageNumberBottom: 12,
  /** Mindestabstand Inhalt → Fußzeile (Seitenumbruch) */
  footerGap: 5,
  /** Oberer Rand der Folgeseiten */
  continuationTop: 20,
  /** Abstand zwischen den Seiten am Bildschirm (Vorschau) */
  screenPageGap: 6
} as const

/** Tabellenspalten in mm (Bezeichnung = Rest). */
const COLUMNS_MM = { vat: 18, unitPrice: 32.3, quantity: 26.5, total: 26.5 }

/** Baut die Render-Daten einer abgeschlossenen Rechnung aus ihrem Snapshot (nie aus Stammdaten). */
export function invoiceToRenderData(invoice: Invoice): InvoiceRenderData {
  return {
    type: invoice.type,
    number: invoice.number,
    originalNumber: invoice.originalNumber,
    festivalName: invoice.festivalName,
    invoiceDate: invoice.invoiceDate,
    serviceDate: invoice.serviceDate,
    dueDate: invoice.dueDate,
    today: invoice.invoiceDate,
    customer: invoice.customer,
    persons: invoice.persons,
    paymentKind: invoice.paymentKind,
    paymentLabel: invoice.paymentLabel,
    paymentText: invoice.paymentText,
    lines: invoice.lines.map((l) => ({
      name: l.name,
      priceCents: l.priceCents,
      vatRate: l.vatRate,
      quantity: l.quantity,
      lineTotalCents: l.lineTotalCents
    })),
    totals: invoice.totals,
    taxExempt: invoice.taxExempt,
    taxExemptText: invoice.taxExemptText,
    stornoReason: invoice.type === 'storno' ? (invoice.stornoReason ?? null) : null
  }
}

/** Zeilen des Anschriftfelds (leere Zeilen entfallen; Einzelrechnung ohne Angaben → „Einzelrechnung“). */
export function addressLines(customer: CustomerSnapshot): string[] {
  const clean = (v: string | null | undefined): string => (typeof v === 'string' ? v.trim() : '')
  const cityLine = [clean(customer.zip), clean(customer.city)].filter(Boolean).join(' ')
  if (customer.kind === 'einzel') {
    const lines = [clean(customer.contactName), clean(customer.clubName), clean(customer.street), cityLine].filter(Boolean)
    return lines.length > 0 ? lines : ['Einzelrechnung']
  }
  return [clean(customer.contactName), clean(customer.clubName), clean(customer.street), cityLine].filter(Boolean)
}

function formatQuantity(quantity: number): string {
  if (!Number.isFinite(quantity) || quantity === 0) return '0'
  return String(quantity)
}

function pt(value: number | undefined): string {
  return value === undefined ? '' : `${Math.round(value * 100) / 100}pt`
}

function styleAttr(fontSizePt: number | undefined, align: TextAlign | undefined): string {
  const parts: string[] = []
  if (fontSizePt !== undefined) parts.push(`font-size:${pt(fontSizePt)}`)
  if (align) parts.push(`text-align:${align}`)
  return parts.length > 0 ? ` style="${parts.join(';')}"` : ''
}

/** Rich-Text-HTML bereinigen und Platzhalter (HTML-escaped) einsetzen. */
function richContent(html: string, values: PlaceholderValues): string {
  return replacePlaceholders(sanitizeRichHtml(html), values, { html: true })
}

function isBlank(html: string): boolean {
  return sanitizeRichHtml(html)
    .replace(/<br>|<\/?(p|div|span|strong|em|u|s|sub|sup|small)[^>]*>|&nbsp;|\s/g, '')
    .trim() === ''
}

function richBlock(
  block: RichTextBlock,
  values: PlaceholderValues,
  cls: string,
  defaults: { fontSizePt?: number; align?: TextAlign } = {}
): string {
  const size = block.fontSizePt ?? defaults.fontSizePt
  const align = block.align ?? defaults.align
  return `<div class="rt fb-split ${cls}" data-block="${escapeHtml(block.id)}"${styleAttr(size, align)}>${richContent(block.html, values)}</div>`
}

function slotBlocks(blocks: RichTextBlock[], values: PlaceholderValues, cls: string): string {
  const html = blocks
    .filter((b) => !isBlank(b.html))
    .map((b) => richBlock(b, values, 'slot-block'))
    .join('')
  return html ? `<div class="slot fb-split ${cls}">${html}</div>` : ''
}

function buildCss(t: TemplateConfig, logoMaxHeight: number): string {
  const L = LAYOUT_MM
  const footerSize = t.footer.fontSizePt ?? 8
  return `
@page { size: A4; margin: 0; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; padding: 0; background: transparent; }
*, *::before, *::after { box-sizing: border-box; }
body {
  font-family: ${fontFamilyCss(t.fontFamily)};
  font-size: ${pt(t.baseFontSizePt)};
  line-height: 1.25;
  color: #000;
  font-kerning: normal;
  font-variant-ligatures: none;
  overflow-wrap: break-word;
}
#fb-doc { width: ${L.pageWidth}mm; }
.page {
  position: relative;
  width: ${L.pageWidth}mm;
  height: ${L.pageHeight}mm;
  overflow: hidden;
  background: #fff;
  break-after: page;
  page-break-after: always;
}
.page:last-child { break-after: auto; page-break-after: auto; }
@media screen { .page + .page { margin-top: ${L.screenPageGap}mm; } }
@media print { html, body { background: #fff; } }

p { margin: 0; }
strong, b { font-weight: 700; }
em, i { font-style: italic; }
.rt p:empty::before { content: '\\00a0'; }

.logo { position: absolute; top: ${L.logoTop}mm; line-height: 0; }
.logo.pos-left { left: ${L.marginLeft}mm; }
.logo.pos-right { right: ${L.marginRight}mm; }
.logo.pos-center { left: 50%; transform: translateX(-50%); }
.logo img { display: block; height: auto; max-height: ${logoMaxHeight}mm; object-fit: contain; }
.logo.pos-left img { object-position: left top; }
.logo.pos-right img { object-position: right top; }
.logo.pos-center img { object-position: center top; }

.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 4mm;
  padding: ${L.returnTop}mm ${L.marginRight}mm 0 ${L.marginLeft}mm;
  min-height: ${L.headMinHeight}mm;
}
.window { flex: 0 0 ${L.windowWidth}mm; min-width: 0; }
.return { height: ${L.returnHeight}mm; overflow: hidden; line-height: 1.375; }
.address { min-height: ${L.addressMinHeight}mm; font-size: ${pt(t.address.fontSizePt)}; line-height: 1.25; }
.side {
  flex: 0 1 auto;
  min-width: 0;
  max-width: ${L.windowWidth}mm;
  margin-top: ${Math.round((L.sideTop - L.returnTop) * 100) / 100}mm;
  display: flex;
  flex-direction: column;
}
.sender { min-height: ${L.senderMinHeight}mm; line-height: 1.375; }
.info {
  align-self: flex-end;
  margin-top: ${L.infoGap}mm;
  border-collapse: collapse;
  line-height: 1.25;
  ${t.info.fontSizePt !== undefined ? `font-size: ${pt(t.info.fontSizePt)};` : ''}
}
.info th { font-weight: 700; text-align: right; padding: 0 1.9mm 0 0; white-space: nowrap; vertical-align: top; }
.info td { text-align: left; padding: 0; width: 25.2mm; white-space: nowrap; vertical-align: top; }

.flow { padding: 0 ${L.marginRight}mm 0 ${L.marginLeft}mm; }
.page-cont .flow { padding-top: ${L.continuationTop}mm; }
.page-cont .flow > :first-child { margin-top: 0 !important; }
.subject { margin-top: ${L.subjectGap}mm; line-height: 1.15; }
.intro { margin-top: 0; }
.storno-reason { margin-top: 2mm; }
.slot { margin-top: ${L.slotGap}mm; }

table.items {
  width: calc(100% + 1.5mm);
  margin: ${L.tableGap}mm -0.4mm 0 -1.1mm;
  border-collapse: collapse;
  table-layout: fixed;
}
table.items th, table.items td { padding: 0 1.1mm; vertical-align: top; }
table.items th {
  font-weight: 700;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-bottom: ${L.headerRule}mm solid #000;
}
table.items td.name { overflow-wrap: anywhere; }
table.items td.num { text-align: right; white-space: nowrap; }
table.items td.vat { padding-right: 3mm; }
table.items td.price { padding-right: 1.7mm; }
table.items td.qty { padding-right: 1mm; }
table.items td.sum { padding-right: 2.5mm; }
table.items tbody.items-body tr:first-child td { padding-top: ${L.firstRowGap}mm; }
table.items tbody.totals tr:first-child td { padding-top: ${L.totalsGap}mm; }
table.items tbody.totals td.label { text-align: right; padding-right: 1mm; }
table.items tr.grand td.label { font-weight: 700; }

.notes { margin-top: ${L.notesGap}mm; }
.payment { margin-top: ${L.paymentGap}mm; }

.page-footer {
  position: absolute;
  left: ${L.marginLeft}mm;
  right: ${L.marginRight}mm;
  bottom: ${L.footerBottom}mm;
  display: flex;
  gap: 6mm;
  font-size: ${pt(footerSize)};
  line-height: 1.375;
}
.page-footer > .rt { flex: 1 1 0; min-width: 0; }
.page-number {
  position: absolute;
  right: ${L.marginRight}mm;
  bottom: ${L.pageNumberBottom}mm;
  font-size: ${pt(Math.max(footerSize, 7))};
  line-height: 1.2;
}
`
}

/** Erzeugt das vollständige HTML-Dokument einer Rechnung (siehe Moduldokumentation). */
export function renderInvoiceHtml({ data, template, logoDataUrl }: RenderInvoiceInput): string {
  const t = normalizeTemplateConfig(template)
  const values = buildPlaceholderValues(data)
  const isStorno = data.type === 'storno'

  // Logo (nur data:-URLs von Bildern – nie externe Verweise)
  const logoOk = t.logo.enabled && typeof logoDataUrl === 'string' && /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/i.test(logoDataUrl)
  const logoMaxHeight = t.logo.position === 'right' ? LAYOUT_MM.logoMaxHeightRight : LAYOUT_MM.logoMaxHeightOther
  const logo = logoOk
    ? `<div class="logo pos-${t.logo.position}"><img src="${escapeHtml(logoDataUrl.replace(/\s+/g, ''))}" alt="" style="width:${t.logo.widthMm}mm"></div>`
    : ''

  // Briefkopf
  const address = addressLines(data.customer)
    .map((line) => `<div>${escapeHtml(line)}</div>`)
    .join('')
  const infoRows = t.info.rows
    .filter((r) => r.label.trim() !== '' || r.value.trim() !== '')
    .map(
      (r) =>
        `<tr><th>${escapeHtml(r.label)}</th><td>${replacePlaceholders(escapeHtml(r.value), values, { html: true })}</td></tr>`
    )
    .join('')

  // Positionstabelle
  const showVat = !data.taxExempt && t.table.showVatColumn
  const labels = t.table.labels
  const visibleLines = data.lines.filter((l) => t.table.showZeroQuantity || l.quantity !== 0)
  const columnCount = showVat ? 5 : 4
  const itemRows = visibleLines
    .map(
      (l) =>
        `<tr><td class="name">${escapeHtml(l.name)}</td>` +
        (showVat ? `<td class="num vat">${l.vatRate}&nbsp;%</td>` : '') +
        `<td class="num price">${formatEuro(l.priceCents)}</td>` +
        `<td class="num qty">${formatQuantity(l.quantity)}</td>` +
        `<td class="num sum">${formatEuroOrDash(l.lineTotalCents)}</td></tr>`
    )
    .join('')
  const totalRow = (cls: string, label: string, cents: number): string =>
    `<tr class="${cls}"><td class="label" colspan="${columnCount - 1}">${label}</td><td class="num sum">${formatEuro(cents)}</td></tr>`
  const totalsRows = [
    totalRow('grand', escapeHtml(labels.grandTotal), data.totals.grossCents),
    ...(data.taxExempt
      ? []
      : [
          ...data.totals.byRate.map((b) => totalRow('tax', `enthaltene MwSt ${b.rate}&nbsp;%`, b.vatCents)),
          totalRow('net', 'Nettobetrag', data.totals.netCents)
        ])
  ].join('')
  const colgroup =
    '<colgroup><col class="c-name">' +
    (showVat ? `<col style="width:${COLUMNS_MM.vat}mm">` : '') +
    `<col style="width:${COLUMNS_MM.unitPrice}mm"><col style="width:${COLUMNS_MM.quantity}mm"><col style="width:${COLUMNS_MM.total}mm"></colgroup>`
  const table =
    `<table class="items">${colgroup}<thead><tr>` +
    `<th>${escapeHtml(labels.name)}</th>` +
    (showVat ? `<th>${escapeHtml(labels.vat)}</th>` : '') +
    `<th>${escapeHtml(labels.unitPrice)}</th><th>${escapeHtml(labels.quantity)}</th><th>${escapeHtml(labels.total)}</th>` +
    `</tr></thead><tbody class="items-body">${itemRows}</tbody><tbody class="totals">${totalsRows}</tbody></table>`

  // Hinweise: automatischer Steuerhinweis zuerst, dann die freien Hinweistexte
  const taxNoteText = data.taxExempt ? (data.taxExemptText ?? '').trim() : ''
  const taxNote = taxNoteText
    ? `<div class="rt fb-split tax-note"${styleAttr(t.taxNote?.fontSizePt, t.taxNote?.align)}><p>${replacePlaceholders(escapeHtml(taxNoteText), values, { html: true })}</p></div>`
    : ''
  const noteBlocks = t.slots.notes.filter((b) => !isBlank(b.html)).map((b) => richBlock(b, values, 'note'))
  const notes = taxNote || noteBlocks.length > 0 ? `<div class="notes fb-split">${taxNote}${noteBlocks.join('')}</div>` : ''

  // Zahlungstext (bei Storno nicht gedruckt)
  const payment =
    !isStorno && !isBlank(data.paymentText ?? '')
      ? `<div class="rt fb-split payment"${styleAttr(t.payment.fontSizePt, t.payment.align)}>${richContent(data.paymentText, values)}</div>`
      : ''

  const stornoReason =
    isStorno && data.stornoReason && data.stornoReason.trim() !== ''
      ? `<div class="rt storno-reason"><p>Grund der Stornierung: ${escapeHtml(data.stornoReason.trim())}</p></div>`
      : ''

  const subjectBlock = isStorno ? t.stornoSubject : t.subject
  const footerColumns = t.footer.columns.map((c) => richBlock(c, values, 'footer-col')).join('')
  const title = `${isStorno ? 'Stornorechnung' : 'Rechnung'} ${values.text.Rechnungsnummer}`

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${getFontFaceCss(t.fontFamily)}
${buildCss(t, logoMaxHeight)}
</style>
</head>
<body>
<div id="fb-doc" data-pages="1">
<section class="page page-first">
${logo}
<header class="head">
<div class="window">
<div class="return">${richBlock(t.returnLine, values, 'return-line')}</div>
<div class="address">${address}</div>
</div>
<div class="side">
${richBlock(t.sender, values, 'sender', { align: 'right' })}
${infoRows ? `<table class="info">${infoRows}</table>` : ''}
</div>
</header>
<div class="flow">
${richBlock(subjectBlock, values, 'subject')}
${richBlock(t.intro, values, 'intro')}
${stornoReason}
${slotBlocks(t.slots.afterIntro, values, 'slot-after-intro')}
${table}
${notes}
${payment}
${slotBlocks(t.slots.afterPayment, values, 'slot-after-payment')}
</div>
<footer class="page-footer">${footerColumns}</footer>
<div class="page-number"></div>
</section>
</div>
<script>
${buildLayoutScript({ fontFamily: fontFamilyName(t.fontFamily), footerGapMm: LAYOUT_MM.footerGap })}
</script>
</body>
</html>`
}
