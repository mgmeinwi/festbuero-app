/**
 * IPC `updates.*` – Updater (siehe services/updater.ts).
 */
import { checkForUpdates, downloadUpdate, getUpdateStatus, installUpdate } from '../services/updater'
import { handle } from './handle'

export function register(): void {
  handle('updates.getStatus', () => getUpdateStatus())
  handle('updates.check', () => checkForUpdates('manual'))
  handle('updates.download', () => downloadUpdate())
  handle('updates.install', () => installUpdate())
}
