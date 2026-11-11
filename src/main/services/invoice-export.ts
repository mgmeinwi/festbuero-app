/**
 * PDF öffnen, einzeln exportieren („Speichern unter“) und als ZIP exportieren.
 * Fehlende PDFs werden vorher automatisch erzeugt (Nummer bleibt).
 *
 * Zuständig: Bereich „Abschluss & Druck“. (`invoices.exportListExcel` gehört zu „Liste & Auswertung“.)
 */
import { copyFileSync, createWriteStream, existsSync, renameSync, unlinkSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { ZipArchive } from 'archiver'
import { app, dialog, type SaveDialogOptions } from 'electron'
import { todayIso } from '@shared/dates'
import { sanitizeFileName } from '@shared/filename'
import { getDb, type Db } from '../db/connection'
import * as repo from '../db/repositories/invoices'
import { getMainWindow } from '../window'
import { ensureInvoicePdf, INVOICE_FOLDER, STORNO_FOLDER, variantFileName } from './filing'
import { getSettings } from './settings'
import { openPath } from './shell'

function requirePdfPath(result: { ok: boolean; path: string | null; error?: string }): string {
  if (!result.ok || !result.path) throw new Error(result.error ?? 'Das PDF konnte nicht erzeugt werden.')
  return result.path
}

async function showSaveDialog(options: SaveDialogOptions): Promise<string | null> {
  const win = getMainWindow()
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null
  return result.filePath
}

function defaultExportDir(db: Db): string {
  const docs = getSettings(db).documentsDir
  if (docs && existsSync(docs)) return docs
  try {
    return app.getPath('documents')
  } catch {
    return ''
  }
}

/** `invoices.openPdf`: fehlendes PDF nachholen und mit dem Standardprogramm öffnen. */
export async function openInvoicePdf(id: number, db: Db = getDb()): Promise<void> {
  if (!repo.findInvoice(db, id)) throw new Error('Die Rechnung wurde nicht gefunden.')
  const path = requirePdfPath(await ensureInvoicePdf(id, db))
  await openPath(path)
}

/** `invoices.exportPdf`: „Speichern unter“-Dialog und Kopie des abgelegten PDFs; null bei Abbruch. */
export async function exportInvoicePdf(id: number, db: Db = getDb()): Promise<string | null> {
  if (!repo.findInvoice(db, id)) throw new Error('Die Rechnung wurde nicht gefunden.')
  const source = requirePdfPath(await ensureInvoicePdf(id, db))
  const target = await showSaveDialog({
    title: 'PDF exportieren',
    buttonLabel: 'Exportieren',
    defaultPath: join(defaultExportDir(db), basename(source)),
    filters: [{ name: 'PDF-Dokument', extensions: ['pdf'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation']
  })
  if (!target) return null
  const dest = /\.pdf$/i.test(target) ? target : `${target}.pdf`
  if (dest === source) return dest
  try {
    copyFileSync(source, dest)
  } catch (err) {
    throw new Error(`Das PDF konnte nicht gespeichert werden: ${err instanceof Error ? err.message : String(err)}`)
  }
  return dest
}

/** Einträge für das ZIP: `Rechnungen/<datei>` bzw. `Stornos/<datei>`, doppelte Namen mit „ (2)“. */
export function zipEntryNames(items: Array<{ type: 'rechnung' | 'storno'; path: string }>): string[] {
  const used = new Set<string>()
  return items.map((item) => {
    const folder = item.type === 'storno' ? STORNO_FOLDER : INVOICE_FOLDER
    const file = basename(item.path)
    const stem = file.replace(/\.pdf$/i, '')
    for (let n = 1; ; n++) {
      const name = `${folder}/${variantFileName(stem, n)}`
      const key = name.toLowerCase()
      if (!used.has(key)) {
        used.add(key)
        return name
      }
    }
  })
}

/** Schreibt ein ZIP mit den angegebenen Dateien (erst `.part`, dann umbenennen). */
export async function writeZip(target: string, entries: Array<{ source: string; name: string }>): Promise<void> {
  const part = join(dirname(target), `.${basename(target)}.part`)
  try {
    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(part)
      const archive = new ZipArchive({ zlib: { level: 6 } })
      output.on('close', () => resolve())
      output.on('error', reject)
      archive.on('error', reject)
      archive.on('warning', (err) => reject(err))
      archive.pipe(output)
      for (const entry of entries) archive.file(entry.source, { name: entry.name })
      archive.finalize().catch(reject)
    })
    renameSync(part, target)
  } catch (err) {
    try {
      if (existsSync(part)) unlinkSync(part)
    } catch {
      // ignorieren
    }
    throw new Error(`Die ZIP-Datei konnte nicht geschrieben werden: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** `invoices.exportZip`: alle PDFs der Auswahl (fehlende vorher erzeugen) als ZIP; null bei Abbruch. */
export async function exportInvoicesZip(ids: number[], db: Db = getDb()): Promise<string | null> {
  if (!Array.isArray(ids) || ids.length === 0) throw new Error('Bitte mindestens eine Rechnung auswählen.')
  const unique = [...new Set(ids)]
  const invoices = unique.map((id) => {
    const invoice = repo.findInvoice(db, id)
    if (!invoice) throw new Error('Mindestens eine der gewählten Rechnungen wurde nicht gefunden.')
    return invoice
  })
  invoices.sort((a, b) => a.seq - b.seq || a.id - b.id)

  const items: Array<{ type: 'rechnung' | 'storno'; path: string }> = []
  const failed: string[] = []
  for (const invoice of invoices) {
    const pdf = await ensureInvoicePdf(invoice.id, db)
    if (pdf.ok && pdf.path) items.push({ type: invoice.type, path: pdf.path })
    else failed.push(invoice.number)
  }
  if (failed.length > 0) {
    throw new Error(`Für folgende Belege konnte kein PDF erzeugt werden: ${failed.join(', ')}. Es wurde keine ZIP-Datei erstellt.`)
  }

  const festivalNames = [...new Set(invoices.map((i) => i.festivalName))]
  const label = festivalNames.length === 1 ? sanitizeFileName(festivalNames[0]!) : 'Festbüro'
  const target = await showSaveDialog({
    title: 'Rechnungen als ZIP exportieren',
    buttonLabel: 'Exportieren',
    defaultPath: join(defaultExportDir(db), `Rechnungen ${label} ${todayIso()}.zip`),
    filters: [{ name: 'ZIP-Archiv', extensions: ['zip'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation']
  })
  if (!target) return null
  const dest = /\.zip$/i.test(target) ? target : `${target}.zip`
  const names = zipEntryNames(items)
  await writeZip(
    dest,
    items.map((item, i) => ({ source: item.path, name: names[i]! }))
  )
  return dest
}
