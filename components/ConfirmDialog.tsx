// components/ConfirmDialog.tsx
// Small "are you sure?" dialog used before committing money (bids, Buy Now).
'use client'

import { useEffect, useRef } from 'react'

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busyLabel,
  busy = false,
  error,
  onConfirm,
  onCancel,
  hideCancel = false,
}: {
  title: string
  children: React.ReactNode
  confirmLabel: string
  busyLabel?: string
  busy?: boolean
  error?: string
  onConfirm: () => void
  onCancel: () => void
  /** Single-button dialogs (e.g. "Done"). */
  hideCancel?: boolean
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    // Focus "Cancel" so a stray Enter press doesn't commit.
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onCancel])

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel()
      }}
    >
      <div className="bg-white max-w-md w-full p-6 rounded-2xl space-y-4 shadow-xl max-h-[90dvh] overflow-y-auto">
        <h2 id="confirm-title" className="text-xl font-bold text-[#1E293B]">
          {title}
        </h2>
        <div className="text-sm text-slate-600 space-y-3">{children}</div>
        {error && <div className="p-3 rounded-xl text-sm bg-red-50 text-red-700">{error}</div>}
        <div className="flex justify-end gap-3 pt-2">
          {!hideCancel && (
            <button
              ref={cancelRef}
              onClick={onCancel}
              disabled={busy}
              className="px-5 py-2.5 rounded-full text-slate-600 font-semibold hover:bg-slate-100 disabled:opacity-60"
            >
              Cancel
            </button>
          )}
          <button
            onClick={onConfirm}
            disabled={busy}
            className="px-5 py-2.5 rounded-full bg-[#F26B5B] text-white font-bold hover:bg-[#e05a4a] disabled:opacity-60"
          >
            {busy ? (busyLabel ?? 'Working…') : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
