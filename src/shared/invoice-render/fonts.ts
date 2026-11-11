/**
 * Gebündelte Schriften für die Rechnung (FontId → @font-face mit eingebetteten data:-URLs).
 *
 * - Die woff2-Dateien (Teilmenge „latin“, deckt Deutsch inkl. „ß“, „€“, „–“, „„…““ ab) werden per
 *   Vite-Import `?inline` als base64-data:-URL eingebunden. Das funktioniert identisch im Renderer-Bundle,
 *   im Main-Bundle (electron-vite) und in Vitest – das erzeugte HTML hat dadurch keine externen Verweise.
 * - Pro Rechnung wird nur die gewählte Schrift eingebettet (4 Schnitte: 400/700, normal/kursiv, je
 *   ca. 12–26 KB); das CSS wird pro Schrift zwischengespeichert.
 * - Familienname im HTML ist „FB <Name>“, damit nie eine lokal installierte Schrift gleichen Namens greift.
 *
 * Zuständig: Bereich „Vorlage“.
 */
import type { FontId } from '../types'
import { DEFAULT_FONT_ID, fontFamilyName, isFontId } from './fonts-meta'
import ARIMO_400_NORMAL from '@fontsource/arimo/files/arimo-latin-400-normal.woff2?inline'
import ARIMO_400_ITALIC from '@fontsource/arimo/files/arimo-latin-400-italic.woff2?inline'
import ARIMO_700_NORMAL from '@fontsource/arimo/files/arimo-latin-700-normal.woff2?inline'
import ARIMO_700_ITALIC from '@fontsource/arimo/files/arimo-latin-700-italic.woff2?inline'
import TINOS_400_NORMAL from '@fontsource/tinos/files/tinos-latin-400-normal.woff2?inline'
import TINOS_400_ITALIC from '@fontsource/tinos/files/tinos-latin-400-italic.woff2?inline'
import TINOS_700_NORMAL from '@fontsource/tinos/files/tinos-latin-700-normal.woff2?inline'
import TINOS_700_ITALIC from '@fontsource/tinos/files/tinos-latin-700-italic.woff2?inline'
import INTER_400_NORMAL from '@fontsource/inter/files/inter-latin-400-normal.woff2?inline'
import INTER_400_ITALIC from '@fontsource/inter/files/inter-latin-400-italic.woff2?inline'
import INTER_700_NORMAL from '@fontsource/inter/files/inter-latin-700-normal.woff2?inline'
import INTER_700_ITALIC from '@fontsource/inter/files/inter-latin-700-italic.woff2?inline'
import ROBOTO_400_NORMAL from '@fontsource/roboto/files/roboto-latin-400-normal.woff2?inline'
import ROBOTO_400_ITALIC from '@fontsource/roboto/files/roboto-latin-400-italic.woff2?inline'
import ROBOTO_700_NORMAL from '@fontsource/roboto/files/roboto-latin-700-normal.woff2?inline'
import ROBOTO_700_ITALIC from '@fontsource/roboto/files/roboto-latin-700-italic.woff2?inline'
import OPEN_SANS_400_NORMAL from '@fontsource/open-sans/files/open-sans-latin-400-normal.woff2?inline'
import OPEN_SANS_400_ITALIC from '@fontsource/open-sans/files/open-sans-latin-400-italic.woff2?inline'
import OPEN_SANS_700_NORMAL from '@fontsource/open-sans/files/open-sans-latin-700-normal.woff2?inline'
import OPEN_SANS_700_ITALIC from '@fontsource/open-sans/files/open-sans-latin-700-italic.woff2?inline'
import LATO_400_NORMAL from '@fontsource/lato/files/lato-latin-400-normal.woff2?inline'
import LATO_400_ITALIC from '@fontsource/lato/files/lato-latin-400-italic.woff2?inline'
import LATO_700_NORMAL from '@fontsource/lato/files/lato-latin-700-normal.woff2?inline'
import LATO_700_ITALIC from '@fontsource/lato/files/lato-latin-700-italic.woff2?inline'
import SOURCE_SANS_3_400_NORMAL from '@fontsource/source-sans-3/files/source-sans-3-latin-400-normal.woff2?inline'
import SOURCE_SANS_3_400_ITALIC from '@fontsource/source-sans-3/files/source-sans-3-latin-400-italic.woff2?inline'
import SOURCE_SANS_3_700_NORMAL from '@fontsource/source-sans-3/files/source-sans-3-latin-700-normal.woff2?inline'
import SOURCE_SANS_3_700_ITALIC from '@fontsource/source-sans-3/files/source-sans-3-latin-700-italic.woff2?inline'

export * from './fonts-meta'

export interface FontFaceFile {
  weight: 400 | 700
  style: 'normal' | 'italic'
  /** data:font/woff2;base64,… */
  url: string
}

export const FONT_FACES: Record<FontId, FontFaceFile[]> = {
  arimo: [
    { weight: 400, style: 'normal', url: ARIMO_400_NORMAL },
    { weight: 400, style: 'italic', url: ARIMO_400_ITALIC },
    { weight: 700, style: 'normal', url: ARIMO_700_NORMAL },
    { weight: 700, style: 'italic', url: ARIMO_700_ITALIC }
  ],
  tinos: [
    { weight: 400, style: 'normal', url: TINOS_400_NORMAL },
    { weight: 400, style: 'italic', url: TINOS_400_ITALIC },
    { weight: 700, style: 'normal', url: TINOS_700_NORMAL },
    { weight: 700, style: 'italic', url: TINOS_700_ITALIC }
  ],
  inter: [
    { weight: 400, style: 'normal', url: INTER_400_NORMAL },
    { weight: 400, style: 'italic', url: INTER_400_ITALIC },
    { weight: 700, style: 'normal', url: INTER_700_NORMAL },
    { weight: 700, style: 'italic', url: INTER_700_ITALIC }
  ],
  roboto: [
    { weight: 400, style: 'normal', url: ROBOTO_400_NORMAL },
    { weight: 400, style: 'italic', url: ROBOTO_400_ITALIC },
    { weight: 700, style: 'normal', url: ROBOTO_700_NORMAL },
    { weight: 700, style: 'italic', url: ROBOTO_700_ITALIC }
  ],
  'open-sans': [
    { weight: 400, style: 'normal', url: OPEN_SANS_400_NORMAL },
    { weight: 400, style: 'italic', url: OPEN_SANS_400_ITALIC },
    { weight: 700, style: 'normal', url: OPEN_SANS_700_NORMAL },
    { weight: 700, style: 'italic', url: OPEN_SANS_700_ITALIC }
  ],
  lato: [
    { weight: 400, style: 'normal', url: LATO_400_NORMAL },
    { weight: 400, style: 'italic', url: LATO_400_ITALIC },
    { weight: 700, style: 'normal', url: LATO_700_NORMAL },
    { weight: 700, style: 'italic', url: LATO_700_ITALIC }
  ],
  'source-sans-3': [
    { weight: 400, style: 'normal', url: SOURCE_SANS_3_400_NORMAL },
    { weight: 400, style: 'italic', url: SOURCE_SANS_3_400_ITALIC },
    { weight: 700, style: 'normal', url: SOURCE_SANS_3_700_NORMAL },
    { weight: 700, style: 'italic', url: SOURCE_SANS_3_700_ITALIC }
  ]
}

const faceCache = new Map<FontId, string>()

/** `@font-face`-Regeln der Schrift (alle Schnitte, eingebettet); Ergebnis wird zwischengespeichert. */
export function getFontFaceCss(id: FontId): string {
  const fontId = isFontId(id) ? id : DEFAULT_FONT_ID
  const cached = faceCache.get(fontId)
  if (cached) return cached
  const family = fontFamilyName(fontId)
  const css = FONT_FACES[fontId]
    .map(
      (f) =>
        `@font-face{font-family:${family};font-style:${f.style};font-weight:${f.weight};` +
        `font-display:block;src:url(${f.url}) format('woff2');}`
    )
    .join('\n')
  faceCache.set(fontId, css)
  return css
}
