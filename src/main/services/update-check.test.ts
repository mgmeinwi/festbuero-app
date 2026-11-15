import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  describeUpdateError,
  findMacDmg,
  isValidVersion,
  normalizeVersion,
  parseLatestRelease,
  progressPercent,
  releaseTagUrl,
  safeDownloadName,
  UpdateError
} from './update-check'

const SHA = 'a'.repeat(64)

/** Ausschnitt einer Antwort von GET /repos/{owner}/{repo}/releases/latest (erfundene Werte). */
function releaseJson(overrides: Record<string, unknown> = {}) {
  return {
    tag_name: 'v1.2.0',
    html_url: 'https://github.com/mgmeinwi/festbuero-app/releases/tag/v1.2.0',
    draft: false,
    prerelease: false,
    assets: [
      {
        name: 'Festbuero-1.2.0-win-x64-setup.exe',
        browser_download_url: 'https://github.com/mgmeinwi/festbuero-app/releases/download/v1.2.0/Festbuero-1.2.0-win-x64-setup.exe',
        size: 1000,
        digest: `sha256:${'b'.repeat(64)}`
      },
      {
        name: 'Festbuero-1.2.0-mac-universal.dmg',
        browser_download_url: 'https://github.com/mgmeinwi/festbuero-app/releases/download/v1.2.0/Festbuero-1.2.0-mac-universal.dmg',
        size: 2000,
        digest: `sha256:${SHA.toUpperCase()}`
      },
      { name: 'latest.yml', browser_download_url: 'https://github.com/x/latest.yml', size: 300 }
    ],
    ...overrides
  }
}

describe('compareVersions', () => {
  it('vergleicht Haupt-, Neben- und Patchversion numerisch', () => {
    expect(compareVersions('1.0.1', '1.0.0')).toBeGreaterThan(0)
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0)
    expect(compareVersions('2.0.0', '10.0.0')).toBeLessThan(0)
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
  })

  it('wertet Vorabversionen als älter', () => {
    expect(compareVersions('1.1.0-beta.1', '1.1.0')).toBeLessThan(0)
    expect(compareVersions('1.1.0', '1.1.0-beta.1')).toBeGreaterThan(0)
    expect(compareVersions('1.1.0-beta.2', '1.1.0-beta.1')).toBeGreaterThan(0)
    expect(compareVersions('1.1.0-beta.1', '1.0.0')).toBeGreaterThan(0)
  })

  it('behandelt ungültige Angaben als gleich (kein Update)', () => {
    expect(compareVersions('neu', '1.0.0')).toBe(0)
    expect(isValidVersion('1.0')).toBe(false)
    expect(isValidVersion('v1.0.0')).toBe(true)
    expect(normalizeVersion(' v1.0.0 ')).toBe('1.0.0')
  })
})

describe('parseLatestRelease', () => {
  it('liest Version, Seite und Dateien mit Prüfsumme', () => {
    const release = parseLatestRelease(releaseJson())
    expect(release.version).toBe('1.2.0')
    expect(release.releaseUrl).toBe('https://github.com/mgmeinwi/festbuero-app/releases/tag/v1.2.0')
    expect(release.assets).toHaveLength(3)
    const dmg = findMacDmg(release)
    expect(dmg).toMatchObject({ name: 'Festbuero-1.2.0-mac-universal.dmg', size: 2000, sha256: SHA })
    expect(release.assets[2]!.sha256).toBeNull()
  })

  it('ignoriert unvollständige und unsichere Einträge', () => {
    const release = parseLatestRelease(
      releaseJson({
        assets: [
          { name: 'ohne-url.dmg' },
          { name: 'Festbuero-1.2.0-mac-universal.dmg', browser_download_url: 'http://unsicher.example/x.dmg' },
          null
        ]
      })
    )
    expect(release.assets).toEqual([])
    expect(findMacDmg(release)).toBeNull()
  })

  it('lehnt Antworten ohne gültige Version mit deutscher Meldung ab', () => {
    expect(() => parseLatestRelease(null)).toThrow(UpdateError)
    expect(() => parseLatestRelease({ tag_name: 'latest' })).toThrow('Die Antwort des Update-Servers ist ungültig.')
  })
})

describe('Hilfsfunktionen', () => {
  it('erzeugt sichere Dateinamen', () => {
    expect(safeDownloadName('Festbuero-1.2.0-mac-universal.dmg')).toBe('Festbuero-1.2.0-mac-universal.dmg')
    expect(safeDownloadName('../../etc/passwd')).toBe('passwd')
    expect(safeDownloadName('..')).toBe('Festbuero-Update.dmg')
    expect(safeDownloadName('Fest büro.dmg')).toBe('Fest_b_ro.dmg')
  })

  it('berechnet den Fortschritt begrenzt auf 0–100', () => {
    expect(progressPercent(50, 200)).toBe(25)
    expect(progressPercent(300, 200)).toBe(100)
    expect(progressPercent(10, 0)).toBeNull()
  })

  it('baut die Seite einer Version', () => {
    expect(releaseTagUrl('v1.2.0')).toBe('https://github.com/mgmeinwi/festbuero-app/releases/tag/v1.2.0')
  })

  it('übersetzt typische Fehler ins Deutsche', () => {
    expect(describeUpdateError(new Error('net::ERR_INTERNET_DISCONNECTED'))).toMatch(/Keine Internetverbindung/)
    expect(describeUpdateError(new Error('getaddrinfo ENOTFOUND api.github.com'))).toMatch(/Keine Internetverbindung/)
    expect(describeUpdateError(new Error('The operation was aborted due to timeout'))).toMatch(/antwortet nicht/)
    expect(describeUpdateError(new Error('HTTP 403'))).toMatch(/ausgelastet/)
    expect(describeUpdateError(new Error('HTTP 404'))).toMatch(/noch keine Version/)
    expect(describeUpdateError(new Error('sha512 checksum mismatch'))).toMatch(/beschädigt/)
    expect(describeUpdateError(new UpdateError('Eigene Meldung.'))).toBe('Eigene Meldung.')
    expect(describeUpdateError(new Error('something odd'))).toBe('Die Suche nach Updates ist fehlgeschlagen.')
  })
})
