/**
 * Tastenkürzel im Electron-Accelerator-Format auswerten (reine Funktionen, ohne Electron-Import).
 * Genutzt für Windows/Linux, wo die Menü-Kürzel über `before-input-event` ausgelöst werden.
 */

export interface ParsedAccelerator {
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
  /** Taste in Kleinbuchstaben, z. B. "n", "enter", "1", "," */
  key: string
}

/** Tastatureingabe (Teilmenge von Electrons `Input`). */
export interface KeyInput {
  key: string
  control: boolean
  meta: boolean
  alt: boolean
  shift: boolean
}

/** „CmdOrCtrl+Shift+N“ → Modifikatoren + Taste (für Windows/Linux: CmdOrCtrl = Strg). */
export function parseAccelerator(accelerator: string): ParsedAccelerator | null {
  const parts = accelerator.split('+').map((p) => p.trim().toLowerCase())
  const key = parts.pop()
  if (!key) return null
  const has = (...names: string[]) => parts.some((p) => names.includes(p))
  return {
    ctrl: has('cmdorctrl', 'commandorcontrol', 'ctrl', 'control'),
    meta: has('cmd', 'command', 'super', 'meta'),
    alt: has('alt', 'option', 'altgr'),
    shift: has('shift'),
    key: key === 'return' ? 'enter' : key
  }
}

/**
 * Passt eine Eingabe zum Kürzel? Bei Satzzeichen (z. B. „/“ = Umschalt+7 auf deutscher Tastatur)
 * wird die Umschalttaste nur geprüft, wenn das Kürzel sie verlangt.
 */
export function matchesAccelerator(acc: ParsedAccelerator, input: KeyInput): boolean {
  const key = (input.key || '').toLowerCase()
  if (key !== acc.key) return false
  if (input.control !== acc.ctrl || input.meta !== acc.meta || input.alt !== acc.alt) return false
  const isPunctuation = acc.key.length === 1 && !/[a-z0-9]/.test(acc.key)
  if (isPunctuation && !acc.shift) return true
  return input.shift === acc.shift
}
