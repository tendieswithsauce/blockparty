// components/SafetyMenu.tsx
// The "⋯" menu on listings, profiles and orders: report the listing, report
// the member, block / unblock them.
'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Ban, Flag, MoreHorizontal } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ReportDialog, type ReportTarget } from '@/components/ReportDialog'

export function SafetyMenu({
  userId,
  username,
  listing,
  loginNext,
}: {
  /** The other member (seller, profile owner, other party in an order). */
  userId: string
  username: string
  /** On a listing page: also offer "Report listing". */
  listing?: { id: number; title: string }
  /** Where to come back to after signing in. */
  loginNext: string
}) {
  const [me, setMe] = useState<string | null | undefined>(undefined)
  const [blockedByMe, setBlockedByMe] = useState(false)
  const [open, setOpen] = useState(false)
  // Which way the menu opens: towards whichever side of the button has room,
  // so it never runs off a phone screen (the button can sit on either side).
  const [openRight, setOpenRight] = useState(false)
  const [report, setReport] = useState<ReportTarget | null>(null)
  const [confirmBlock, setConfirmBlock] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false
    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id ?? null
      if (uid && uid !== userId) {
        const { data: b } = await supabase.rpc('is_blocked_with', { p_other: userId })
        if (!cancelled) setBlockedByMe(!!b?.[0]?.by_me)
      }
      if (!cancelled) setMe(uid)
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (me === undefined || me === userId) return null

  async function toggleBlock() {
    setBusy(true)
    setError('')
    const supabase = createClient()
    const { error: err } = blockedByMe
      ? await supabase.from('user_blocks').delete().eq('blocked_id', userId)
      : await supabase.rpc('block_user', { p_user_id: userId })
    setBusy(false)
    if (err) return setError(err.code === 'P0001' ? `${err.message}.` : 'Something went wrong. Please try again.')
    setConfirmBlock(false)
    // Listings, bid panels and search results all change: reload the page.
    window.location.reload()
  }

  const item = 'w-full flex items-center gap-2 px-4 py-3 text-left text-sm font-semibold hover:bg-slate-50'

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => {
          const box = menuRef.current?.getBoundingClientRect()
          // 240px menu + a little margin.
          if (box) setOpenRight(box.right - 248 < 0)
          setOpen((o) => !o)
        }}
        aria-label="More options"
        aria-expanded={open}
        className="p-2 rounded-full border text-slate-600 hover:bg-slate-50"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div
          className={`absolute ${openRight ? 'left-0' : 'right-0'} mt-2 w-60 max-w-[calc(100vw-1rem)] bg-white border rounded-2xl shadow-xl z-40 overflow-hidden divide-y`}
        >
          {me === null ? (
            <Link href={`/login?next=${encodeURIComponent(loginNext)}`} className={item}>
              <Flag className="w-4 h-4 text-red-600" /> Sign in to report or block
            </Link>
          ) : (
            <>
              {listing && (
                <button
                  type="button"
                  className={item}
                  onClick={() => {
                    setOpen(false)
                    setReport({ type: 'listing', listingId: listing.id, label: 'this listing' })
                  }}
                >
                  <Flag className="w-4 h-4 text-red-600" /> Report listing
                </button>
              )}
              <button
                type="button"
                className={item}
                onClick={() => {
                  setOpen(false)
                  setReport({ type: 'user', userId, label: username })
                }}
              >
                <Flag className="w-4 h-4 text-red-600" /> Report {username}
              </button>
              <button
                type="button"
                className={item}
                onClick={() => {
                  setOpen(false)
                  setError('')
                  setConfirmBlock(true)
                }}
              >
                <Ban className="w-4 h-4 text-slate-600" /> {blockedByMe ? `Unblock ${username}` : `Block ${username}`}
              </button>
            </>
          )}
        </div>
      )}

      {report && <ReportDialog target={report} onClose={() => setReport(null)} />}

      {confirmBlock && (
        <ConfirmDialog
          title={blockedByMe ? `Unblock ${username}?` : `Block ${username}?`}
          confirmLabel={blockedByMe ? 'Unblock' : 'Block'}
          busyLabel="Saving…"
          busy={busy}
          error={error}
          onConfirm={toggleBlock}
          onCancel={() => setConfirmBlock(false)}
        >
          {blockedByMe ? (
            <p>You&apos;ll see each other&apos;s listings again, and can buy, bid and ask questions.</p>
          ) : (
            <>
              <p>
                You won&apos;t see each other&apos;s listings, and neither of you can buy from, bid on or ask questions about the
                other&apos;s items. {username} isn&apos;t told.
              </p>
              <p>Orders already under way aren&apos;t affected; you can still cancel them. You can unblock any time from your profile.</p>
            </>
          )}
        </ConfirmDialog>
      )}
    </div>
  )
}
