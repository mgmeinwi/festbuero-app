import { describe, expect, it } from 'vitest'
import { matchesAccelerator, parseAccelerator, type KeyInput } from './accelerators'

const key = (k: string, mods: Partial<Omit<KeyInput, 'key'>> = {}): KeyInput => ({
  key: k,
  control: false,
  meta: false,
  alt: false,
  shift: false,
  ...mods
})

describe('parseAccelerator', () => {
  it('liest Modifikatoren und Taste', () => {
    expect(parseAccelerator('CmdOrCtrl+Shift+N')).toEqual({ ctrl: true, meta: false, alt: false, shift: true, key: 'n' })
    expect(parseAccelerator('Ctrl+Alt+P')).toEqual({ ctrl: true, meta: false, alt: true, shift: false, key: 'p' })
    expect(parseAccelerator('CmdOrCtrl+Return')?.key).toBe('enter')
    expect(parseAccelerator('Cmd+,')).toEqual({ ctrl: false, meta: true, alt: false, shift: false, key: ',' })
  })
})

describe('matchesAccelerator (Windows/Linux)', () => {
  it('Strg+N, Strg+Umschalt+N exakt', () => {
    const n = parseAccelerator('CmdOrCtrl+N')!
    const shiftN = parseAccelerator('CmdOrCtrl+Shift+N')!
    expect(matchesAccelerator(n, key('n', { control: true }))).toBe(true)
    expect(matchesAccelerator(n, key('N', { control: true, shift: true }))).toBe(false)
    expect(matchesAccelerator(shiftN, key('N', { control: true, shift: true }))).toBe(true)
    expect(matchesAccelerator(n, key('n'))).toBe(false)
    expect(matchesAccelerator(n, key('n', { control: true, alt: true }))).toBe(false)
  })

  it('Strg+Enter (Abschließen & drucken) und Ziffern', () => {
    expect(matchesAccelerator(parseAccelerator('CmdOrCtrl+Enter')!, key('Enter', { control: true }))).toBe(true)
    expect(matchesAccelerator(parseAccelerator('CmdOrCtrl+1')!, key('1', { control: true }))).toBe(true)
    expect(matchesAccelerator(parseAccelerator('CmdOrCtrl+1')!, key('2', { control: true }))).toBe(false)
  })

  it('Satzzeichen unabhängig von der Umschalttaste (deutsche Tastatur)', () => {
    const slash = parseAccelerator('CmdOrCtrl+/')!
    expect(matchesAccelerator(slash, key('/', { control: true, shift: true }))).toBe(true)
    expect(matchesAccelerator(slash, key('/', { control: true }))).toBe(true)
    expect(matchesAccelerator(parseAccelerator('Ctrl+,')!, key(',', { control: true }))).toBe(true)
  })
})
