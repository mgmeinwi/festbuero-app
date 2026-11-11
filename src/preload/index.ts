/**
 * Preload (sandboxed): stellt ausschließlich `window.festbuero = { invoke, on }` bereit.
 * Wird von Feature-Arbeit nicht angefasst – neue Funktionen laufen über den IPC-Vertrag.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

const CHANNEL_PATTERN = /^[a-zA-Z][a-zA-Z0-9]*\.[a-zA-Z][a-zA-Z0-9]*$/

const bridge = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    if (typeof channel !== 'string' || !CHANNEL_PATTERN.test(channel)) {
      return Promise.reject(new Error(`Ungültiger Kanal: ${String(channel)}`))
    }
    return ipcRenderer.invoke(channel, ...args)
  },
  on(event: string, callback: (payload: unknown) => void): () => void {
    if (typeof event !== 'string' || !CHANNEL_PATTERN.test(event)) {
      throw new Error(`Ungültiges Event: ${String(event)}`)
    }
    const listener = (_e: IpcRendererEvent, payload: unknown): void => callback(payload)
    ipcRenderer.on(event, listener)
    return () => {
      ipcRenderer.removeListener(event, listener)
    }
  }
}

contextBridge.exposeInMainWorld('festbuero', bridge)
