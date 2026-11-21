// lib/install-prompt.ts
// Remembers Chrome's "install this app" prompt (the beforeinstallprompt event)
// so our own button can show it later. Chrome fires the event once, early,
// often before the button is on screen, so it's caught by a listener mounted
// in the root layout (InstallPromptListener) and kept here.
//
// Safari (iPhone/iPad) has no such event: sites can't start an install there,
// so the button shows "Share > Add to Home Screen" instructions instead.
'use client'

import { useEffect, useSyncExternalStore } from 'react'

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPromptEvent | null = null
let installed = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Mount once (root layout). */
export function InstallPromptListener() {
  useEffect(() => {
    const onPrompt = (e: Event) => {
      // Keep Chrome's own mini-bar from popping up; we show our button instead.
      e.preventDefault()
      deferred = e as InstallPromptEvent
      emit()
    }
    const onInstalled = () => {
      installed = true
      deferred = null
      emit()
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])
  return null
}

export type InstallMode =
  /** Chrome can show its install prompt. */
  | 'prompt'
  /** iPhone/iPad: show Add to Home Screen instructions. */
  | 'ios'
  /** Already installed, or a browser that can't install: show nothing. */
  | 'none'

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function isIos() {
  const ua = navigator.userAgent
  // iPadOS reports itself as a Mac, but with a touch screen.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

function snapshot(): InstallMode {
  if (installed || isStandalone()) return 'none'
  if (deferred) return 'prompt'
  if (isIos()) return 'ios'
  return 'none'
}

export function useInstallMode(): InstallMode {
  return useSyncExternalStore(subscribe, snapshot, () => 'none')
}

/** Shows Chrome's install prompt. Returns true if the person installed. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred
  if (!e) return false
  // The event can only be used once.
  deferred = null
  emit()
  await e.prompt()
  const { outcome } = await e.userChoice
  return outcome === 'accepted'
}
