#!/usr/bin/env node
/**
 * Lädt SumatraPDF (portable, 64-Bit) für den Windows-Build und legt es unter
 * `resources/win/SumatraPDF.exe` ab (nicht eingecheckt, siehe .gitignore).
 *
 *   npm run fetch:sumatra        (läuft automatisch vor `npm run dist:win`)
 *
 * - Version fest gepinnt, Download nur von der offiziellen Seite sumatrapdfreader.org.
 * - SHA-256 von ZIP und entpackter EXE werden geprüft; bei Abweichung bricht das Skript ab.
 * - Ist die passende EXE schon vorhanden (Prüfsumme stimmt), wird nichts geladen.
 * - Offline-Build: `FESTBUERO_SUMATRA_ZIP=/pfad/SumatraPDF-<version>-64.zip` verwendet eine lokale
 *   ZIP-Datei (wird genauso geprüft).
 *
 * Lizenz: SumatraPDF steht unter (A)GPLv3 (einzelne Teile BSD), siehe resources/win/README.md.
 * Ohne Abhängigkeiten: ZIP wird mit node:zlib entpackt.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

export const SUMATRA_VERSION = '3.6.1'
const ZIP_NAME = `SumatraPDF-${SUMATRA_VERSION}-64.zip`
const EXE_IN_ZIP = `SumatraPDF-${SUMATRA_VERSION}-64.exe`
export const SUMATRA_URL = `https://www.sumatrapdfreader.org/dl/rel/${SUMATRA_VERSION}/${ZIP_NAME}`
/** einmalig ermittelt (2026-11-11) aus dem offiziellen Download */
export const ZIP_SHA256 = '98b33a518d42986856d225064b0cd2d3643ecf78cbf84ab873d26cc51877a544'
export const EXE_SHA256 = '719f689b34f47be8ca105ce8484948474dafde0e106bab599e4a89326070c3d0'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'resources', 'win', 'SumatraPDF.exe')

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

function fail(message) {
  console.error(`[fetch-sumatra] FEHLER: ${message}`)
  process.exit(1)
}

/** Liest eine Datei aus einem ZIP (zentrales Verzeichnis; Methoden stored/deflate). */
function extractFromZip(zip, wanted) {
  let eocd = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 0xffff - 22); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('ZIP-Verzeichnis nicht gefunden')
  const count = zip.readUInt16LE(eocd + 10)
  let offset = zip.readUInt32LE(eocd + 16)
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('defektes ZIP-Verzeichnis')
    const method = zip.readUInt16LE(offset + 10)
    const compressedSize = zip.readUInt32LE(offset + 20)
    const size = zip.readUInt32LE(offset + 24)
    const nameLength = zip.readUInt16LE(offset + 28)
    const extraLength = zip.readUInt16LE(offset + 30)
    const commentLength = zip.readUInt16LE(offset + 32)
    const localOffset = zip.readUInt32LE(offset + 42)
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength)
    if (name === wanted) {
      const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28)
      const raw = zip.subarray(dataStart, dataStart + compressedSize)
      const data = method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw) : null
      if (!data) throw new Error(`nicht unterstützte Kompression (${method})`)
      if (data.length !== size) throw new Error('Größe der entpackten Datei stimmt nicht')
      return data
    }
    offset += 46 + nameLength + extraLength + commentLength
  }
  throw new Error(`${wanted} ist nicht im ZIP enthalten`)
}

async function loadZip() {
  const local = process.env.FESTBUERO_SUMATRA_ZIP
  if (local) {
    console.log(`[fetch-sumatra] verwende lokale Datei ${local}`)
    return readFileSync(local)
  }
  console.log(`[fetch-sumatra] lade ${SUMATRA_URL}`)
  const response = await fetch(SUMATRA_URL, { redirect: 'follow', headers: { 'User-Agent': 'festbuero-build' } })
  if (!response.ok) throw new Error(`Download fehlgeschlagen: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

async function main() {
  if (existsSync(target) && sha256(readFileSync(target)) === EXE_SHA256) {
    console.log(`[fetch-sumatra] SumatraPDF ${SUMATRA_VERSION} ist bereits vorhanden: ${target}`)
    return
  }
  let zip
  try {
    zip = await loadZip()
  } catch (err) {
    fail(`${err instanceof Error ? err.message : String(err)} – Netzwerk prüfen oder FESTBUERO_SUMATRA_ZIP setzen.`)
  }
  const zipHash = sha256(zip)
  if (zipHash !== ZIP_SHA256) {
    fail(`Prüfsumme der ZIP-Datei stimmt nicht.\n  erwartet: ${ZIP_SHA256}\n  erhalten: ${zipHash}`)
  }
  let exe
  try {
    exe = extractFromZip(zip, EXE_IN_ZIP)
  } catch (err) {
    fail(`ZIP konnte nicht entpackt werden: ${err instanceof Error ? err.message : String(err)}`)
  }
  const exeHash = sha256(exe)
  if (exeHash !== EXE_SHA256) {
    fail(`Prüfsumme der EXE stimmt nicht.\n  erwartet: ${EXE_SHA256}\n  erhalten: ${exeHash}`)
  }
  mkdirSync(dirname(target), { recursive: true })
  const tmp = join(dirname(target), 'SumatraPDF.download.exe') // ebenfalls durch .gitignore abgedeckt
  writeFileSync(tmp, exe)
  renameSync(tmp, target)
  console.log(`[fetch-sumatra] SumatraPDF ${SUMATRA_VERSION} geprüft und abgelegt: ${target} (${exe.length} Bytes)`)
}

await main()
