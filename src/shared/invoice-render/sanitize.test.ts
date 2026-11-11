import { describe, expect, it } from 'vitest'
import { richHtmlToPlainText, sanitizeRichHtml, sanitizeStyle } from './sanitize'

describe('sanitizeRichHtml', () => {
  it('behält TipTap-Formatierung und Platzhalter-Bausteine', () => {
    const html =
      '<p style="text-align: center">Hallo <strong>fett</strong> <em>kursiv</em> <u>unter</u><br>' +
      '<span style="font-size: 12pt">groß</span> <span data-placeholder="Rechnungsdatum_DE">{Rechnungsdatum_DE}</span></p>'
    expect(sanitizeRichHtml(html)).toBe(html)
  })

  it('entfernt Skripte, Ereignis-Handler, Bilder, Links und iframes', () => {
    const out = sanitizeRichHtml(
      '<p onclick="x()" class="a">A<script>alert(1)</script><img src=x onerror=alert(2)>' +
        '<a href="javascript:alert(3)">Link</a><iframe src="http://x"></iframe><style>p{}</style>B</p>'
    )
    expect(out).toBe('<p>ALinkB</p>')
  })

  it('filtert style-Eigenschaften', () => {
    expect(sanitizeStyle('font-size: 12pt; background: url(http://x); text-align: right; position: fixed')).toBe(
      'font-size: 12pt; text-align: right'
    )
    expect(sanitizeStyle('font-size: expression(alert(1))')).toBeNull()
    expect(sanitizeRichHtml('<span style="color: red">x</span>')).toBe('<span>x</span>')
  })

  it('verwirft ungültige Platzhalter-Attribute', () => {
    expect(sanitizeRichHtml('<span data-placeholder="x&quot; onclick=&quot;y">t</span>')).toBe('<span>t</span>')
  })

  it('balanciert Tags (kein „Auslaufen“ von Formatierungen)', () => {
    expect(sanitizeRichHtml('<p><strong>fett')).toBe('<p><strong>fett</strong></p>')
    expect(sanitizeRichHtml('<p>a</em>b</p></p>')).toBe('<p>ab</p>')
    expect(sanitizeRichHtml('<p>eins<p>zwei</p>')).toBe('<p>eins</p><p>zwei</p>')
    expect(sanitizeRichHtml('<b>x</b><i>y</i>')).toBe('<strong>x</strong><em>y</em>')
  })

  it('escaped lose spitze Klammern im Text, lässt Entities stehen', () => {
    expect(sanitizeRichHtml('a < b > c &amp; d')).toBe('a &lt; b &gt; c &amp; d')
    expect(sanitizeRichHtml('<scr<script>ipt>alert(1)</script>')).toBe('&lt;scr')
    expect(sanitizeRichHtml('<!-- Kommentar --><p>x</p>')).toBe('<p>x</p>')
  })

  it('robust bei Nicht-Strings', () => {
    expect(sanitizeRichHtml(undefined)).toBe('')
    expect(sanitizeRichHtml(42)).toBe('')
  })
})

describe('richHtmlToPlainText', () => {
  it('liefert lesbaren Text', () => {
    expect(richHtmlToPlainText('<p>Hallo <strong>Welt</strong></p><p>zweite&nbsp;Zeile<br>dritte</p>')).toBe(
      'Hallo Welt zweite Zeile dritte'
    )
  })
})
