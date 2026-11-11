import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDraft, insertFestival, insertProducts, setupTestContext, type TestContext } from './invoice-test-utils'

vi.mock('electron', async () => (await import('./invoice-test-utils')).electronMock())
vi.mock('./pdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pdf')>()
  return { ...actual, renderHtmlToPdf: vi.fn(async () => Buffer.from('%PDF-1.4\n% Export-Test\n%%EOF\n')) }
})

import { dialog } from 'electron'
import { renderHtmlToPdf } from './pdf'
import { finalizeInvoice } from './finalize'
import { exportInvoicePdf, exportInvoicesZip, zipEntryNames } from './invoice-export'
import { stornoInvoice } from './storno'

function stubSave(path: string | null): void {
  ;(dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async () =>
    path ? { canceled: false, filePath: path } : { canceled: true, filePath: '' }
}

describe('Export', () => {
  let ctx: TestContext
  beforeEach(() => {
    ctx = setupTestContext()
  })
  afterEach(() => ctx.cleanup())

  it('ZIP-Einträge in Rechnungen/ und Stornos/, doppelte Namen eindeutig', () => {
    expect(
      zipEntryNames([
        { type: 'rechnung', path: '/a/Rechnungen/2025-081.pdf' },
        { type: 'storno', path: '/a/Stornos/2025-082.pdf' },
        { type: 'rechnung', path: '/b/Rechnungen/2025-081.pdf' }
      ])
    ).toEqual(['Rechnungen/2025-081.pdf', 'Stornos/2025-082.pdf', 'Rechnungen/2025-081 (2).pdf'])
  })

  it('exportZip: fehlende PDFs werden vorher erzeugt, Ordnerstruktur im ZIP', async () => {
    const f = insertFestival(ctx.db)
    const products = insertProducts(ctx.db, f)
    vi.mocked(renderHtmlToPdf).mockRejectedValueOnce(new Error('PDF konnte nicht erzeugt werden: Test'))
    const a = await finalizeInvoice(buildDraft(f, products), {}, ctx.db)
    expect(a.invoice.pdfPath).toBeNull()
    const b = await finalizeInvoice(buildDraft(f, products), {}, ctx.db)
    const s = await stornoInvoice(b.invoice.id, 'Test', {}, ctx.db)

    const target = join(ctx.root, 'export', 'alle')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(ctx.root, 'export'))
    stubSave(target)
    const result = await exportInvoicesZip([s.invoice.id, a.invoice.id, b.invoice.id, a.invoice.id], ctx.db)
    expect(result).toBe(`${target}.zip`)
    const zip = readFileSync(result!)
    expect(zip.subarray(0, 2).toString()).toBe('PK')
    const content = zip.toString('latin1')
    for (const name of ['Rechnungen/2025-081.pdf', 'Rechnungen/2025-082.pdf', 'Stornos/2025-083.pdf']) {
      expect(content).toContain(name)
    }
    expect(existsSync(join(ctx.documentsDir, 'Testfest 2025', 'Rechnungen', '2025-081.pdf'))).toBe(true)
  })

  it('exportZip: Abbruch → null, leere Auswahl → Fehler', async () => {
    const f = insertFestival(ctx.db)
    const { invoice } = await finalizeInvoice(buildDraft(f, insertProducts(ctx.db, f)), {}, ctx.db)
    stubSave(null)
    expect(await exportInvoicesZip([invoice.id], ctx.db)).toBeNull()
    await expect(exportInvoicesZip([], ctx.db)).rejects.toThrow('Bitte mindestens eine Rechnung auswählen.')
    await expect(exportInvoicesZip([9999], ctx.db)).rejects.toThrow(/nicht gefunden/)
  })

  it('exportPdf: Kopie an den gewählten Ort', async () => {
    const f = insertFestival(ctx.db)
    const { invoice } = await finalizeInvoice(buildDraft(f, insertProducts(ctx.db, f)), {}, ctx.db)
    const target = join(ctx.root, 'kopie')
    stubSave(target)
    expect(await exportInvoicePdf(invoice.id, ctx.db)).toBe(`${target}.pdf`)
    expect(readFileSync(`${target}.pdf`).equals(readFileSync(invoice.pdfPath!))).toBe(true)
    stubSave(null)
    expect(await exportInvoicePdf(invoice.id, ctx.db)).toBeNull()
  })
})
