/**
 * Reine Hilfsfunktionen für den Updater (ohne Electron, ohne Netzwerk – unit-getestet).
 *
 * Quelle der Updates sind die GitHub-Releases des Repositorys. Die Werte müssen zu
 * `publish` in `electron-builder.yml` passen (daraus erzeugt electron-builder die `app-update.yml`
 * für den Windows-Updater).
 */

export const UPDATE_REPO = { owner: 'mgmeinwi', repo: 'festbuero-app' } as const

/** GitHub-API: neueste veröffentlichte Version (ohne Entwürfe und Vorabversionen). */
export const LATEST_RELEASE_API_URL = `https://api.github.com/repos/${UPDATE_REPO.owner}/${UPDATE_REPO.repo}/releases/latest`

/** Download-Seite für Menschen. */
export const RELEASES_PAGE_URL = `https://github.com/${UPDATE_REPO.owner}/${UPDATE_REPO.repo}/releases/latest`

/** Seite einer bestimmten Version. */
export function releaseTagUrl(version: string): string {
  return `https://github.com/${UPDATE_REPO.owner}/${UPDATE_REPO.repo}/releases/tag/v${normalizeVersion(version)}`
}

/** Dateiname der macOS-DMG (siehe `artifactName` in electron-builder.yml). */
const MAC_DMG_PATTERN = /-mac-universal\.dmg$/i

interface ParsedVersion {
  parts: [number, number, number]
  prerelease: string | null
}

function parseVersion(input: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(input.trim())
  if (!match) return null
  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? null
  }
}

/** true für „1.2.3“ bzw. „v1.2.3“ (optional mit Vorabkennung). */
export function isValidVersion(input: string): boolean {
  return parseVersion(input) !== null
}

/** Normalisiert „v1.2.3“ → „1.2.3“. */
export function normalizeVersion(input: string): string {
  return input.trim().replace(/^v/, '')
}

/**
 * Vergleicht zwei Versionen (SemVer, vereinfacht): < 0 wenn a älter, 0 gleich, > 0 wenn a neuer.
 * Eine Vorabversion ist älter als dieselbe Version ohne Vorabkennung. Ungültige Angaben gelten als gleich.
 */
export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a)
  const vb = parseVersion(b)
  if (!va || !vb) return 0
  for (let i = 0; i < 3; i++) {
    const diff = va.parts[i]! - vb.parts[i]!
    if (diff !== 0) return diff
  }
  if (va.prerelease === vb.prerelease) return 0
  if (va.prerelease === null) return 1
  if (vb.prerelease === null) return -1
  return va.prerelease < vb.prerelease ? -1 : 1
}

export interface ReleaseAsset {
  name: string
  url: string
  size: number
  /** SHA-256 in Hex (aus dem GitHub-Feld `digest`), falls bekannt */
  sha256: string | null
}

export interface LatestRelease {
  version: string
  releaseUrl: string
  assets: ReleaseAsset[]
}

/** Prüft und vereinfacht die Antwort von `GET /repos/{owner}/{repo}/releases/latest`. */
export function parseLatestRelease(json: unknown): LatestRelease {
  const invalid = () => new UpdateError('Die Antwort des Update-Servers ist ungültig.')
  if (!json || typeof json !== 'object') throw invalid()
  const data = json as Record<string, unknown>
  const tag = typeof data.tag_name === 'string' ? data.tag_name : ''
  if (!isValidVersion(tag)) throw invalid()
  const releaseUrl = typeof data.html_url === 'string' ? data.html_url : RELEASES_PAGE_URL
  const assets: ReleaseAsset[] = []
  for (const raw of Array.isArray(data.assets) ? data.assets : []) {
    if (!raw || typeof raw !== 'object') continue
    const a = raw as Record<string, unknown>
    if (typeof a.name !== 'string' || typeof a.browser_download_url !== 'string') continue
    if (!/^https:\/\//.test(a.browser_download_url)) continue
    const digest = typeof a.digest === 'string' ? /^sha256:([0-9a-f]{64})$/i.exec(a.digest) : null
    assets.push({
      name: a.name,
      url: a.browser_download_url,
      size: typeof a.size === 'number' && a.size > 0 ? a.size : 0,
      sha256: digest ? digest[1]!.toLowerCase() : null
    })
  }
  return { version: normalizeVersion(tag), releaseUrl, assets }
}

/** DMG für macOS aus den Dateien einer Version. */
export function findMacDmg(release: LatestRelease): ReleaseAsset | null {
  return release.assets.find((a) => MAC_DMG_PATTERN.test(a.name)) ?? null
}

/** Sicherer lokaler Dateiname für einen Download (keine Pfadanteile). */
export function safeDownloadName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  const cleaned = base.replace(/[^0-9A-Za-z._-]/g, '_').replace(/^\.+/, '')
  return cleaned || 'Festbuero-Update.dmg'
}

/** Fortschritt in Prozent (0–100, ganzzahlig) oder null, wenn die Gesamtgröße unbekannt ist. */
export function progressPercent(received: number, total: number): number | null {
  if (!total || total <= 0) return null
  return Math.max(0, Math.min(100, Math.floor((received / total) * 100)))
}

/** Fehler mit fertiger deutscher Meldung (wird unverändert angezeigt). */
export class UpdateError extends Error {
  override name = 'UpdateError'
}

/** Verständliche deutsche Meldung für Netzwerk- und Serverfehler. */
export function describeUpdateError(err: unknown): string {
  if (err instanceof UpdateError) return err.message
  const raw = err instanceof Error ? err.message : String(err ?? '')
  if (/ERR_INTERNET_DISCONNECTED|ENOTFOUND|EAI_AGAIN|ERR_NAME_NOT_RESOLVED|ENETUNREACH|ERR_NETWORK_CHANGED/i.test(raw)) {
    return 'Keine Internetverbindung. Bitte später erneut versuchen.'
  }
  if (/ETIMEDOUT|ERR_TIMED_OUT|timeout|abort/i.test(raw)) {
    return 'Der Update-Server antwortet nicht. Bitte später erneut versuchen.'
  }
  if (/\b(403|429)\b|rate limit/i.test(raw)) {
    return 'Der Update-Server ist gerade ausgelastet. Bitte später erneut versuchen.'
  }
  if (/\b404\b/.test(raw)) {
    return 'Es wurde noch keine Version veröffentlicht.'
  }
  if (/sha|checksum|prüfsumme/i.test(raw)) {
    return 'Der Download ist beschädigt (Prüfsumme stimmt nicht). Bitte erneut versuchen.'
  }
  return 'Die Suche nach Updates ist fehlgeschlagen.'
}
