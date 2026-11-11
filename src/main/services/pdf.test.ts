import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultTemplateConfig } from '@shared/invoice-render/default-template'

vi.mock('electron', async () => (await import('./invoice-test-utils')).electronMock())

import { buildInvoiceHtml, isFakePdfFail, loadLogoDataUrl } from './pdf'
import { buildDraft, insertFestival, insertProducts, setupTestContext } from './invoice-test-utils'
import { createInvoiceRecord } from './finalize'
import * as repo from '../db/repositories/invoices'

describe('PDF: Logo und HTML', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'festbuero-logos-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('lädt Logos als data:-URL nur aus dem Logo-Ordner', () => {
    writeFileSync(join(dir, 'abc.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    writeFileSync(join(dir, 'x.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    expect(loadLogoDataUrl('abc.svg', dir)).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(loadLogoDataUrl('x.png', dir)).toBe('data:image/png;base64,iVBORw==')
    expect(loadLogoDataUrl(null, dir)).toBeNull()
    expect(loadLogoDataUrl('fehlt.png', dir)).toBeNull()
    expect(loadLogoDataUrl('../abc.svg', dir)).toBeNull()
    expect(loadLogoDataUrl('datei.exe', dir)).toBeNull()
  })

  it('FESTBUERO_FAKE_PDF_FAIL wird bei jedem Aufruf neu gelesen', () => {
    delete process.env.FESTBUERO_FAKE_PDF_FAIL
    expect(isFakePdfFail()).toBe(false)
    process.env.FESTBUERO_FAKE_PDF_FAIL = '1'
    expect(isFakePdfFail()).toBe(true)
    delete process.env.FESTBUERO_FAKE_PDF_FAIL
  })

  it('HTML einer Rechnung kommt aus dem Snapshot und meldet das Render-Ende', () => {
    const ctx = setupTestContext()
    try {
      const f = insertFestival(ctx.db, { template: getDefaultTemplateConfig() })
      const { id } = createInvoiceRecord(buildDraft(f, insertProducts(ctx.db, f)), ctx.db)
      ctx.db.prepare("UPDATE festival SET name = 'Später umbenannt' WHERE id = ?").run(f)
      const html = buildInvoiceHtml(repo.findInvoice(ctx.db, id)!, null)
      expect(html).toContain('2025-081')
      expect(html).toContain('670,20')
      expect(html).toContain('__FESTBUERO_RENDER_DONE__')
      expect(html).not.toContain('Später umbenannt')
    } finally {
      ctx.cleanup()
    }
  })

  it('Logo-Datei aus dem Snapshot landet als data:-URL im HTML', () => {
    const ctx = setupTestContext()
    try {
      mkdirSync(join(ctx.userData, 'logos'), { recursive: true })
      const svg = readFileSync(join(process.cwd(), 'resources', 'sample', 'beispiel-logo.svg'))
      writeFileSync(join(ctx.userData, 'logos', 'beispiel.svg'), svg)
      const f = insertFestival(ctx.db, { template: getDefaultTemplateConfig(), logoFile: 'beispiel.svg' })
      const { id } = createInvoiceRecord(buildDraft(f, insertProducts(ctx.db, f)), ctx.db)
      const html = buildInvoiceHtml(repo.findInvoice(ctx.db, id)!)
      expect(html).toContain(`data:image/svg+xml;base64,${svg.toString('base64')}`)
    } finally {
      ctx.cleanup()
    }
  })
})
