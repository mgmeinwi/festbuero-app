/**
 * Updater: sucht nach neuen Versionen (GitHub-Releases), lädt sie herunter und installiert sie.
 *
 * - **Windows:** `electron-updater` (NSIS). Download im Hintergrund, Installation auf Knopfdruck
 *   („Jetzt neu starten“) oder automatisch beim nächsten Beenden. Funktioniert auch unsigniert.
 * - **macOS:** Echte Auto-Updates (Squirrel.Mac) verlangen eine Developer-ID-Signatur. Bis dahin
 *   halbautomatisch: neueste Version über die GitHub-API prüfen, DMG herunterladen (SHA-256 aus dem
 *   Release geprüft), öffnen und die App beenden – der Nutzer zieht die neue App in „Programme“.
 *
 * Nur in der paketierten App aktiv, nie in Entwicklung oder E2E-Tests (keine Netzwerkzugriffe).
 * Es wird nie ungefragt installiert. Automatische Suchen beim Start bleiben bei Fehlern still
 * (offline ist der Normalfall), nur eine Suche auf Knopfdruck meldet Fehler.
 */
import { createHash } from 'node:crypto'
import { createWriteStream, rmSync, type WriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { app, net, shell } from 'electron'
import type { AppUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/types'
import { getUserDataDir, isE2E } from '../env'
import { isShuttingDown, registerShutdownHook } from '../lifecycle'
import { emitToRenderer } from '../window'
import { getSettings } from './settings'
import {
  compareVersions,
  describeUpdateError,
  findMacDmg,
  LATEST_RELEASE_API_URL,
  parseLatestRelease,
  progressPercent,
  releaseTagUrl,
  safeDownloadName,
  UpdateError,
  type ReleaseAsset
} from './update-check'

type Trigger = 'auto' | 'manual'

interface CheckResult {
  version: string
  available: boolean
  releaseUrl: string
}

/** Verzögerung der automatischen Suche nach dem Start (App soll erst in Ruhe laden). */
const STARTUP_CHECK_DELAY_MS = 8_000
const API_TIMEOUT_MS = 15_000

const isMac = process.platform === 'darwin'
const isWin = process.platform === 'win32'

function currentVersion(): string {
  return app.isPackaged ? app.getVersion() : __APP_VERSION__
}

function unsupportedReason(): string | null {
  if (!app.isPackaged || isE2E()) return 'Updates gibt es nur in der installierten App.'
  if (!isMac && !isWin) return 'Updates werden auf diesem Betriebssystem nicht unterstützt.'
  return null
}

function initialStatus(): UpdateStatus {
  const reason = unsupportedReason()
  return {
    phase: reason ? 'unsupported' : 'idle',
    currentVersion: currentVersion(),
    latestVersion: null,
    installMode: isWin ? 'install' : 'manual',
    progress: null,
    message: reason,
    releaseUrl: null,
    checkedAt: null
  }
}

let status: UpdateStatus | null = null
let checking: Promise<UpdateStatus> | null = null
let downloading: Promise<UpdateStatus> | null = null
/** letzter Download ist fehlgeschlagen → „Erneut versuchen“ darf neu laden */
let downloadFailed = false

/** macOS: gefundene DMG und – nach dem Download – ihr Pfad. */
let macAsset: ReleaseAsset | null = null
let macDmgPath: string | null = null
let macAbort: AbortController | null = null
let macPartPath: string | null = null

function getStatusRef(): UpdateStatus {
  if (!status) status = initialStatus()
  return status
}

export function getUpdateStatus(): UpdateStatus {
  return { ...getStatusRef() }
}

function setStatus(patch: Partial<UpdateStatus>): UpdateStatus {
  status = { ...getStatusRef(), ...patch }
  if (!isShuttingDown()) emitToRenderer('updates.statusChanged', { ...status })
  return { ...status }
}

function updatesDir(): string {
  return join(getUserDataDir(), 'updates')
}

/* ------------------------------------------------------------------ */
/* Windows: electron-updater                                           */
/* ------------------------------------------------------------------ */

let winUpdater: AppUpdater | null = null

async function getWinUpdater(): Promise<AppUpdater> {
  if (winUpdater) return winUpdater
  const { autoUpdater } = await import('electron-updater')
  autoUpdater.autoDownload = false
  // geladenes, aber nicht bestätigtes Update beim nächsten Beenden installieren
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  autoUpdater.logger = {
    info: () => undefined,
    debug: () => undefined,
    warn: (msg: unknown) => console.warn('[updater]', msg),
    error: (msg: unknown) => console.error('[updater]', msg)
  }
  autoUpdater.on('download-progress', (info) => {
    setStatus({ phase: 'downloading', progress: progressPercent(info.transferred, info.total) })
  })
  autoUpdater.on('update-downloaded', (info) => {
    setStatus({ phase: 'ready', progress: 100, latestVersion: info.version, message: null })
  })
  winUpdater = autoUpdater
  return autoUpdater
}

async function checkWindows(): Promise<CheckResult> {
  const updater = await getWinUpdater()
  const result = await updater.checkForUpdates()
  const version = result?.updateInfo.version ?? currentVersion()
  return {
    version,
    available: compareVersions(version, currentVersion()) > 0,
    releaseUrl: releaseTagUrl(version)
  }
}

async function downloadWindows(): Promise<void> {
  const updater = await getWinUpdater()
  await updater.downloadUpdate()
}

/* ------------------------------------------------------------------ */
/* macOS: GitHub-API + DMG                                             */
/* ------------------------------------------------------------------ */

async function checkMac(): Promise<CheckResult> {
  const response = await net.fetch(LATEST_RELEASE_API_URL, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Festbuero-Updater' },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
    cache: 'no-store'
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const release = parseLatestRelease(await response.json())
  const available = compareVersions(release.version, currentVersion()) > 0
  const dmg = findMacDmg(release)
  if (available && !dmg) {
    throw new UpdateError(`Version ${release.version} enthält keinen Mac-Installer. Bitte später erneut versuchen.`)
  }
  macAsset = available ? dmg : null
  return { version: release.version, available, releaseUrl: release.releaseUrl }
}

function writeChunk(stream: WriteStream, chunk: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(chunk, (err) => (err ? reject(err) : resolve()))
  })
}

function closeStream(stream: WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.end((err?: Error | null) => (err ? reject(err) : resolve()))
  })
}

async function downloadMac(): Promise<void> {
  const asset = macAsset
  if (!asset) throw new UpdateError('Es ist kein Update zum Herunterladen vorhanden.')
  const dir = updatesDir()
  await mkdir(dir, { recursive: true })
  const target = join(dir, safeDownloadName(asset.name))
  const part = `${target}.part`
  macPartPath = part
  const controller = new AbortController()
  macAbort = controller

  const response = await net.fetch(asset.url, { signal: controller.signal, cache: 'no-store' })
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
  const total = Number(response.headers.get('content-length')) || asset.size
  const hash = createHash('sha256')
  const out = createWriteStream(part)
  let received = 0
  let lastPercent: number | null = -1
  try {
    const reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(value)
      await writeChunk(out, value)
      received += value.byteLength
      const percent = progressPercent(received, total)
      if (percent !== lastPercent) {
        lastPercent = percent
        setStatus({ phase: 'downloading', progress: percent })
      }
    }
    await closeStream(out)
  } catch (err) {
    out.destroy()
    await rm(part, { force: true })
    throw err
  }

  if (asset.size && received !== asset.size) {
    await rm(part, { force: true })
    throw new UpdateError('Der Download ist unvollständig. Bitte erneut versuchen.')
  }
  if (asset.sha256 && hash.digest('hex') !== asset.sha256) {
    await rm(part, { force: true })
    throw new UpdateError('Der Download ist beschädigt (Prüfsumme stimmt nicht). Bitte erneut versuchen.')
  }
  await rename(part, target)
  macPartPath = null
  macAbort = null
  macDmgPath = target
  setStatus({ phase: 'ready', progress: 100, message: null })
}

/* ------------------------------------------------------------------ */
/* Öffentliche Funktionen                                              */
/* ------------------------------------------------------------------ */

/** Sucht nach einer neuen Version. Wirft nie; Fehler stehen im Status (bei `auto` still). */
export function checkForUpdates(trigger: Trigger = 'manual'): Promise<UpdateStatus> {
  const current = getStatusRef()
  if (current.phase === 'unsupported') return Promise.resolve(getUpdateStatus())
  // laufender Download oder fertiges Update: nicht unterbrechen
  if (current.phase === 'downloading' || current.phase === 'ready') return Promise.resolve(getUpdateStatus())
  if (checking) return checking

  const before = { ...current }
  downloadFailed = false
  if (trigger === 'manual') setStatus({ phase: 'checking', message: null })
  checking = (async () => {
    try {
      const result = isWin ? await checkWindows() : await checkMac()
      return setStatus({
        phase: result.available ? 'available' : 'upToDate',
        latestVersion: result.version,
        releaseUrl: result.releaseUrl,
        progress: null,
        message: null,
        checkedAt: new Date().toISOString()
      })
    } catch (err) {
      console.warn('[updater] Suche fehlgeschlagen:', err)
      if (trigger === 'auto') return setStatus({ ...before })
      return setStatus({ phase: 'error', progress: null, message: describeUpdateError(err) })
    } finally {
      checking = null
    }
  })()
  return checking
}

/** Lädt die gefundene Version herunter. Wirft nie; Fehler stehen im Status. */
export function downloadUpdate(): Promise<UpdateStatus> {
  const current = getStatusRef()
  if (downloading) return downloading
  if (current.phase !== 'available' && !(current.phase === 'error' && downloadFailed)) {
    return Promise.resolve(getUpdateStatus())
  }
  downloadFailed = false
  setStatus({ phase: 'downloading', progress: 0, message: null })
  downloading = (async () => {
    try {
      if (isWin) await downloadWindows()
      else await downloadMac()
      return getUpdateStatus()
    } catch (err) {
      if (isShuttingDown()) return getUpdateStatus()
      console.warn('[updater] Download fehlgeschlagen:', err)
      downloadFailed = true
      const message = describeUpdateError(err)
      return setStatus({
        phase: 'error',
        progress: null,
        message: message === 'Die Suche nach Updates ist fehlgeschlagen.' ? 'Der Download ist fehlgeschlagen.' : message
      })
    } finally {
      downloading = null
      macAbort = null
    }
  })()
  return downloading
}

/**
 * Installiert das geladene Update. Windows: App beenden, still installieren, neu starten.
 * macOS: DMG öffnen und die App beenden, damit sie in „Programme“ ersetzt werden kann.
 */
export async function installUpdate(): Promise<void> {
  if (getStatusRef().phase !== 'ready') throw new Error('Es ist noch kein Update heruntergeladen.')
  if (isWin) {
    const updater = await getWinUpdater()
    // nach der IPC-Antwort beenden (isSilent = true, isForceRunAfter = true)
    setTimeout(() => updater.quitAndInstall(true, true), 200)
    return
  }
  if (!macDmgPath) throw new Error('Die heruntergeladene Datei wurde nicht gefunden. Bitte erneut herunterladen.')
  const error = await shell.openPath(macDmgPath)
  if (error) throw new Error(`Die Installationsdatei konnte nicht geöffnet werden: ${error}`)
  // dem Finder Zeit geben, die DMG einzubinden; dann regulär beenden (kein app.exit)
  setTimeout(() => app.quit(), 1_500)
}

/**
 * Beim Start aufrufen (nach dem Hauptfenster): räumt alte Downloads auf und sucht – wenn eingeschaltet –
 * nach kurzer Verzögerung still nach Updates.
 */
export function initUpdater(): void {
  status = initialStatus()
  if (status.phase === 'unsupported') return

  void rm(updatesDir(), { recursive: true, force: true }).catch(() => undefined)

  registerShutdownHook('updater', () => {
    macAbort?.abort()
    if (macPartPath) {
      try {
        rmSync(macPartPath, { force: true })
      } catch {
        // ignorieren
      }
    }
  })

  let autoCheck = true
  try {
    autoCheck = getSettings().autoUpdateCheck
  } catch {
    autoCheck = true
  }
  if (!autoCheck) return
  const timer = setTimeout(() => void checkForUpdates('auto'), STARTUP_CHECK_DELAY_MS)
  registerShutdownHook('updater-startup-check', () => clearTimeout(timer))
}
