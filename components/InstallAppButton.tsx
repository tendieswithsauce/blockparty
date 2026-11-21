// components/InstallAppButton.tsx
// "Install Blockparty on your phone". On Chrome it opens the browser's own
// install prompt; on iPhone/iPad it explains Share > Add to Home Screen (Apple
// doesn't let sites start the install). Hidden once installed, inside the
// installed app, and on browsers that can't install. See lib/install-prompt.ts.
'use client'

import { useState, useSyncExternalStore } from 'react'
import { Plus, Share, Smartphone, X } from 'lucide-react'
import { promptInstall, useInstallMode } from '@/lib/install-prompt'

const DISMISS_KEY = 'bp_install_card_dismissed'

const dismissedStore = {
  subscribe(l: () => void) {
    window.addEventListener('storage', l)
    return () => window.removeEventListener('storage', l)
  },
  get: () => localStorage.getItem(DISMISS_KEY) === '1',
}

export function InstallAppButton({ variant }: { variant: 'hero' | 'card' }) {
  const mode = useInstallMode()
  const [showIos, setShowIos] = useState(false)
  const [done, setDone] = useState(false)
  const storedDismissed = useSyncExternalStore(dismissedStore.subscribe, dismissedStore.get, () => true)
  const [dismissed, setDismissed] = useState(false)

  if (mode === 'none' || done) return null
  if (variant === 'card' && (storedDismissed || dismissed)) return null

  async function install() {
    if (mode === 'ios') return setShowIos(true)
    if (await promptInstall()) setDone(true)
  }

  return (
    <>
      {variant === 'hero' ? (
        <button
          type="button"
          onClick={install}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full border-2 border-[#0E4D5C]/20 bg-white text-sm font-semibold text-[#0E4D5C] hover:border-[#0E4D5C]/40"
        >
          <Smartphone className="w-4 h-4" /> Install Blockparty on your phone
        </button>
      ) : (
        <div className="flex items-center gap-4 bg-white border rounded-2xl px-5 py-4 shadow-sm">
          <span className="w-10 h-10 shrink-0 rounded-full bg-[#0E4D5C]/10 text-[#0E4D5C] flex items-center justify-center">
            <Smartphone className="w-5 h-5" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="font-semibold">Get the Blockparty app</p>
            <p className="text-sm text-slate-500">Add it to your home screen for quicker bidding, buying and order updates.</p>
          </div>
          <button
            type="button"
            onClick={install}
            className="shrink-0 px-4 py-2 rounded-full bg-[#0E4D5C] text-white text-sm font-semibold hover:bg-[#0b3f4b]"
          >
            Install
          </button>
          <button
            type="button"
            onClick={() => {
              localStorage.setItem(DISMISS_KEY, '1')
              setDismissed(true)
            }}
            className="shrink-0 p-1 rounded-full text-slate-400 hover:bg-slate-100"
            aria-label="Hide this"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {showIos && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ios-install-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowIos(false)
          }}
        >
          <div className="bg-white w-full max-w-sm rounded-2xl p-6 space-y-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <h2 id="ios-install-title" className="text-lg font-bold">
                Add Blockparty to your home screen
              </h2>
              <button type="button" onClick={() => setShowIos(false)} className="p-1 rounded-full hover:bg-slate-100" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>
            <ol className="space-y-3 text-sm text-slate-700">
              <li className="flex items-center gap-3">
                <span className="w-7 h-7 shrink-0 rounded-full bg-[#0E4D5C] text-white text-xs font-bold flex items-center justify-center">1</span>
                <span>
                  Tap the <strong>Share</strong> button <Share className="inline w-4 h-4 -mt-1 text-[#0E4D5C]" aria-label="Share icon" /> in
                  Safari&apos;s toolbar (top or bottom of the screen; on some phones it&apos;s under <strong>⋯</strong>).
                </span>
              </li>
              <li className="flex items-center gap-3">
                <span className="w-7 h-7 shrink-0 rounded-full bg-[#0E4D5C] text-white text-xs font-bold flex items-center justify-center">2</span>
                <span>
                  Scroll down and tap <strong>Add to Home Screen</strong>{' '}
                  <Plus className="inline w-4 h-4 -mt-1 rounded border border-slate-400 text-slate-600" aria-hidden />.
                </span>
              </li>
              <li className="flex items-center gap-3">
                <span className="w-7 h-7 shrink-0 rounded-full bg-[#0E4D5C] text-white text-xs font-bold flex items-center justify-center">3</span>
                <span>
                  Tap <strong>Add</strong>. Blockparty opens from your home screen like any other app.
                </span>
              </li>
            </ol>
            <button
              type="button"
              onClick={() => setShowIos(false)}
              className="w-full py-2.5 rounded-full bg-[#0E4D5C] text-white font-semibold"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  )
}
