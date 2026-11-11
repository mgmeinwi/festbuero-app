/**
 * Vorlagen-Renderer: TemplateConfig + InvoiceRenderData → vollständiges A4-HTML-Dokument.
 * EINZIGE Quelle für Vorschau (iframe) UND PDF (printToPDF).
 *
 * STUB des Bereichs „Basis“ – der Bereich „Vorlage“ ersetzt diese Datei durch den echten Renderer
 * (Schriften, Seitenumbruch, Blöcke). Die exportierten Signaturen bleiben gleich.
 *
 * Vertrag für das erzeugte HTML:
 * - setzt nach dem Layout `window.__FESTBUERO_RENDER_DONE__ = true` (PDF-Erzeugung wartet darauf),
 * - meldet der Vorschau seine Höhe per `parent.postMessage({ type: 'festbuero:rendered', height }, '*')`.
 */
import { formatEuro, formatEuroOrDash } from '../money'
import { buildPlaceholderValues, escapeHtml, replacePlaceholders } from '../placeholders'
import type { Invoice, InvoiceRenderData, RichTextBlock, TemplateConfig } from '../types'

export interface RenderInvoiceInput {
  data: InvoiceRenderData
  template: TemplateConfig
  /** Logo als data:-URL oder null */
  logoDataUrl: string | null
}

/** Nachricht, die das gerenderte Dokument an die Vorschau sendet. */
export interface RenderedMessage {
  type: 'festbuero:rendered'
  /** Gesamthöhe des Dokuments in CSS-Pixeln */
  height: number
}

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
    taxExemptText: invoice.taxExemptText
  }
}

function addressLines(data: InvoiceRenderData): string[] {
  const c = data.customer
  const cityLine = [c.zip, c.city].filter(Boolean).join(' ')
  if (c.kind === 'einzel') {
    const lines = [c.contactName, c.street, cityLine].filter((s) => s && s.trim() !== '')
    return lines.length > 0 ? lines : ['Einzelrechnung']
  }
  return [c.contactName, c.clubName, c.street, cityLine].filter((s) => s && s.trim() !== '')
}

export function renderInvoiceHtml({ data, template, logoDataUrl }: RenderInvoiceInput): string {
  const values = buildPlaceholderValues(data)
  const rich = (block: RichTextBlock | undefined): string => {
    if (!block) return ''
    const style = [
      block.fontSizePt ? `font-size:${block.fontSizePt}pt` : '',
      block.align ? `text-align:${block.align}` : ''
    ]
      .filter(Boolean)
      .join(';')
    return `<div class="rt" style="${style}">${replacePlaceholders(block.html, values, { html: true })}</div>`
  }

  const showVat = !data.taxExempt && template.table.showVatColumn
  const labels = template.table.labels
  const visibleLines = data.lines.filter((l) => template.table.showZeroQuantity || l.quantity !== 0)
  const rows = visibleLines
    .map(
      (l) => `<tr>
        <td>${escapeHtml(l.name)}</td>
        ${showVat ? `<td class="num">${l.vatRate} %</td>` : ''}
        <td class="num">${formatEuro(l.priceCents)}</td>
        <td class="num">${l.quantity}</td>
        <td class="num">${formatEuroOrDash(l.lineTotalCents)}</td>
      </tr>`
    )
    .join('')
  const colSpan = showVat ? 4 : 3
  const taxRows = data.taxExempt
    ? ''
    : data.totals.byRate
        .map(
          (b) =>
            `<tr class="sub"><td colspan="${colSpan}">enthaltene MwSt. ${b.rate} % (netto ${formatEuro(b.netCents)})</td><td class="num">${formatEuro(b.vatCents)}</td></tr>`
        )
        .join('') +
      `<tr class="sub"><td colspan="${colSpan}">Nettobetrag</td><td class="num">${formatEuro(data.totals.netCents)}</td></tr>`

  const subject = data.type === 'storno' ? template.stornoSubject : template.subject
  const logoJustify = { left: 'flex-start', center: 'center', right: 'flex-end' }[template.logo.position]
  const logo =
    template.logo.enabled && logoDataUrl
      ? `<div class="logo" style="justify-content:${logoJustify}"><img src="${escapeHtml(logoDataUrl)}" style="width:${template.logo.widthMm}mm" alt=""></div>`
      : ''
  const infoRows = template.info.rows
    .map(
      (r) =>
        `<tr><th>${escapeHtml(r.label)}</th><td>${replacePlaceholders(escapeHtml(r.value), values, { html: true })}</td></tr>`
    )
    .join('')
  const footerCols = template.footer.columns.map((c) => rich(c)).join('')

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>${escapeHtml(values.text.Rechnungsnummer)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: ${template.baseFontSizePt}pt; line-height: 1.3; }
  .page { position: relative; width: 210mm; min-height: 297mm; padding: 15mm 20mm 32mm 25mm; overflow: hidden; }
  .rt p { margin: 0; min-height: 1em; }
  .logo { display: flex; margin-bottom: 4mm; }
  .head { display: flex; justify-content: space-between; gap: 8mm; }
  .window { width: 85mm; margin-top: 12mm; }
  .return { font-size: 7.5pt; border-bottom: 0.2mm solid #000; padding-bottom: 1mm; margin-bottom: 3mm; }
  .address { font-size: ${template.address.fontSizePt}pt; min-height: 27mm; }
  .side { text-align: right; }
  .info { margin-top: 8mm; margin-left: auto; border-collapse: collapse; ${template.info.fontSizePt ? `font-size:${template.info.fontSizePt}pt;` : ''} }
  .info th { font-weight: bold; text-align: right; padding: 0 3mm 0 0; }
  .info td { text-align: right; padding: 0; }
  .subject { margin-top: 12mm; }
  .intro { margin-top: 2mm; margin-bottom: 6mm; }
  table.items { width: 100%; border-collapse: collapse; }
  table.items th { text-align: left; border-bottom: 0.3mm solid #000; padding: 1.5mm 1mm; }
  table.items td { padding: 1.2mm 1mm; }
  table.items .num { text-align: right; white-space: nowrap; }
  table.items tr.total td { border-top: 0.3mm solid #000; font-weight: bold; padding-top: 2mm; }
  table.items tr.sub td { font-size: 0.9em; }
  .notes { margin-top: 8mm; }
  .payment { margin-top: 8mm; ${template.payment.fontSizePt ? `font-size:${template.payment.fontSizePt}pt;` : ''} ${template.payment.align ? `text-align:${template.payment.align};` : ''} }
  .footer { position: absolute; left: 25mm; right: 20mm; bottom: 10mm; display: flex; gap: 6mm; font-size: ${template.footer.fontSizePt ?? 8}pt; border-top: 0.2mm solid #000; padding-top: 2mm; }
  .footer > .rt { flex: 1; }
  .stub-hint { position: absolute; top: 4mm; left: 25mm; font-size: 7pt; color: #999; }
</style>
</head>
<body>
<div class="page">
  ${logo}
  <div class="head">
    <div class="window">
      <div class="return">${rich(template.returnLine)}</div>
      <div class="address">${addressLines(data).map((l) => `<div>${escapeHtml(l)}</div>`).join('')}</div>
    </div>
    <div class="side">
      ${rich(template.sender)}
      <table class="info">${infoRows}</table>
    </div>
  </div>
  <div class="subject">${rich(subject)}</div>
  <div class="intro">${rich(template.intro)}</div>
  ${template.slots.afterIntro.map((b) => rich(b)).join('')}
  <table class="items">
    <thead><tr>
      <th>${escapeHtml(labels.name)}</th>
      ${showVat ? `<th class="num">${escapeHtml(labels.vat)}</th>` : ''}
      <th class="num">${escapeHtml(labels.unitPrice)}</th>
      <th class="num">${escapeHtml(labels.quantity)}</th>
      <th class="num">${escapeHtml(labels.total)}</th>
    </tr></thead>
    <tbody>
      ${rows}
      <tr class="total"><td colspan="${colSpan}" class="num">${escapeHtml(labels.grandTotal)}</td><td class="num">${formatEuro(data.totals.grossCents)}</td></tr>
      ${taxRows}
    </tbody>
  </table>
  <div class="notes">
    ${data.taxExempt && data.taxExemptText ? `<div class="rt"><p>${escapeHtml(data.taxExemptText)}</p></div>` : ''}
    ${template.slots.notes.map((b) => rich(b)).join('')}
  </div>
  <div class="payment rt">${replacePlaceholders(data.paymentText, values, { html: true })}</div>
  ${template.slots.afterPayment.map((b) => rich(b)).join('')}
  <div class="footer">${footerCols}</div>
</div>
<script>
  (function () {
    function done() {
      window.__FESTBUERO_RENDER_DONE__ = true;
      try {
        parent.postMessage({ type: 'festbuero:rendered', height: document.documentElement.scrollHeight }, '*');
      } catch (e) {}
    }
    if (document.fonts && document.fonts.ready) { document.fonts.ready.then(done, done); } else { done(); }
  })();
</script>
</body>
</html>`
}
