import type { FestbueroBridge } from './types'

declare global {
  interface Window {
    festbuero: FestbueroBridge
  }
}

export {}
