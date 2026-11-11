/**
 * electron-builder `afterSign`-Hook (macOS): Ist die App nach dem Signierschritt nicht gültig signiert
 * (unsignierter Build ohne Developer-ID-Zertifikat), wird sie ad-hoc signiert (`codesign --sign -`).
 *
 * Warum: Ein gar nicht signiertes Bundle meldet macOS auf Apple-Silicon-Macs nach dem Download als
 * „beschädigt“. Ad-hoc signiert erscheint stattdessen die übliche Warnung „Entwickler nicht verifiziert“,
 * die Nutzer über „Systemeinstellungen → Datenschutz & Sicherheit → Dennoch öffnen“ bestätigen können.
 *
 * Mit echtem Zertifikat (CSC_LINK …) ist die App bereits gültig signiert – dann tut der Hook nichts.
 */
const { execFileSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { join } = require('node:path')

function isValidlySigned(appPath) {
  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

exports.default = async function adhocSignMac(context) {
  if (context.electronPlatformName !== 'darwin' || process.platform !== 'darwin') return
  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  if (!existsSync(appPath) || isValidlySigned(appPath)) return
  console.log(`  • ad-hoc signing (unsignierter Build)  file=${appPath}`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', appPath], { stdio: 'inherit' })
  if (!isValidlySigned(appPath)) throw new Error(`Ad-hoc-Signatur ungültig: ${appPath}`)
}
