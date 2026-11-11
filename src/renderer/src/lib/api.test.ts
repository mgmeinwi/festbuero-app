import { describe, expect, it } from 'vitest'
import { cleanIpcError, isNotAvailableError } from './api'

describe('cleanIpcError', () => {
  it('entfernt Electrons Präfix', () => {
    const err = new Error(
      "Error invoking remote method 'festivals.create': Error: Bitte einen Namen für das Gründungsfest angeben."
    )
    expect(cleanIpcError(err).message).toBe('Bitte einen Namen für das Gründungsfest angeben.')
  })

  it('entfernt auch spezielle Fehlertypen', () => {
    const err = new Error("Error invoking remote method 'x.y': SqliteError: Die Startnummer kann nicht geändert werden.")
    expect(cleanIpcError(err).message).toBe('Die Startnummer kann nicht geändert werden.')
  })

  it('meldet nicht registrierte Kanäle verständlich', () => {
    const err = new Error(
      "Error invoking remote method 'products.list': Error: No handler registered for 'products.list'"
    )
    const cleaned = cleanIpcError(err)
    expect(cleaned.message).toBe('Funktion noch nicht verfügbar: products.list')
    expect(isNotAvailableError(cleaned)).toBe(true)
  })

  it('liefert eine Ersatzmeldung', () => {
    expect(cleanIpcError(undefined, 'a.b').message).toBe('Unbekannter Fehler bei a.b.')
    expect(cleanIpcError('Klartext').message).toBe('Klartext')
  })
})
