// components/listing/ManageListing.tsx
// A seller's controls for their own listing: change a Set Price listing's
// price, end the listing (take it off sale), or delete it for good. Used on
// the listing page (as a card) and on dashboard tiles (as a "Manage" menu).
// The database functions (set_listing_price, end_my_listing,
// delete_my_listing) do the real checks.
'use client'

import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal, PauseCircle, Pencil, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { MAX_PRICE_CENTS, dollarsToCents, formatCents } from '@/lib/money'
import { MIN_PRICE_CENTS, PLATFORM_FEE_LABEL, sellerPayoutCents } from '@/lib/fees'

export type ManagedListing = {
  id: number
  title: string
  listingType: 'fixed' | 'auction' | 'free'
  status: string
  priceCents: number | null
  bidCount: number
}

export type ManageResult = 'price' | 'ended' | 'deleted'
type Dialog = 'price' | 'end' | 'delete' | null

export function canManage(l: Pick<ManagedListing, 'status'>) {
  return l.status === 'active' || l.status === 'inactive'
}

export function ManageListing({
  listing,
  variant,
  onDone,
}: {
  listing: ManagedListing
  variant: 'card' | 'menu'
  onDone: (result: ManageResult, message: string) => void
}) {
  const [dialog, setDialog] = useState<Dialog>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [price, setPrice] = useState(listing.priceCents ? String(listing.priceCents / 100) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)

  const fixed = listing.listingType === 'fixed'
  const canPrice = fixed && canManage(listing)
  const canEnd = listing.status === 'active' && (listing.listingType !== 'auction' || listing.bidCount === 0)
  const canDelete = canManage(listing) && listing.bidCount === 0

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [menuOpen])

  if (!canPrice && !canEnd && !canDelete) return null

  function open(d: Dialog) {
    setMenuOpen(false)
    setError('')
    if (d === 'price') setPrice(listing.priceCents ? String(listing.priceCents / 100) : '')
    setDialog(d)
  }

  async function run() {
    const supabase = createClient()
    setError('')
    if (dialog === 'price') {
      const cents = dollarsToCents(price)
      if (cents === null || cents < MIN_PRICE_CENTS || cents > MAX_PRICE_CENTS) {
        return setError(`Enter a price from ${formatCents(MIN_PRICE_CENTS)} to ${formatCents(MAX_PRICE_CENTS)}.`)
      }
      setBusy(true)
      const { error: rpcError } = await supabase.rpc('set_listing_price', { p_listing_id: listing.id, p_price_cents: cents })
      setBusy(false)
      if (rpcError) return setError(message(rpcError))
      setDialog(null)
      return onDone('price', `${listing.title} is now ${formatCents(cents)}.`)
    }
    if (dialog === 'end') {
      setBusy(true)
      const { error: rpcError } = await supabase.rpc('end_my_listing', { p_listing_id: listing.id })
      setBusy(false)
      if (rpcError) return setError(message(rpcError))
      setDialog(null)
      return onDone('ended', `${listing.title} is off sale. You can relist it from your dashboard's Inactive tab.`)
    }
    if (dialog === 'delete') {
      setBusy(true)
      const { data: photos, error: rpcError } = await supabase.rpc('delete_my_listing', { p_listing_id: listing.id })
      if (rpcError) {
        setBusy(false)
        return setError(message(rpcError))
      }
      // Photos live in the seller's own folder, which they're allowed to clear.
      if (photos && photos.length > 0) await supabase.storage.from('listing-photos').remove(photos)
      setBusy(false)
      setDialog(null)
      return onDone('deleted', `${listing.title} was deleted.`)
    }
  }

  const priceCents = dollarsToCents(price)
  const action = 'inline-flex items-center gap-1.5 font-semibold'

  return (
    <>
      {variant === 'card' ? (
        <div className="bg-white border rounded-2xl p-5 shadow-sm">
          <p className="font-bold text-[#0E4D5C]">Manage your listing</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {canPrice && (
              <button type="button" onClick={() => open('price')} className="px-4 py-2 rounded-full border-2 border-[#0E4D5C] text-[#0E4D5C] text-sm font-semibold inline-flex items-center gap-1.5">
                <Pencil className="w-4 h-4" /> Change price
              </button>
            )}
            {canEnd && (
              <button type="button" onClick={() => open('end')} className="px-4 py-2 rounded-full border-2 border-slate-300 text-slate-700 text-sm font-semibold inline-flex items-center gap-1.5">
                <PauseCircle className="w-4 h-4" /> End listing
              </button>
            )}
            {canDelete && (
              <button type="button" onClick={() => open('delete')} className="px-4 py-2 rounded-full border-2 border-red-200 text-red-600 text-sm font-semibold inline-flex items-center gap-1.5">
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            )}
          </div>
          {listing.listingType === 'auction' && listing.bidCount > 0 && listing.status === 'active' && (
            <p className="mt-2 text-xs text-slate-500">This auction has bids, which are binding, so it can&apos;t be ended early.</p>
          )}
        </div>
      ) : (
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className={`${action} mt-2 text-sm text-slate-600 hover:text-[#0E4D5C]`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <MoreHorizontal className="w-4 h-4" /> Manage
          </button>
          {menuOpen && (
            <div role="menu" className="absolute left-0 bottom-full mb-1 z-20 w-44 rounded-xl border bg-white shadow-lg py-1 text-sm">
              {canPrice && (
                <button role="menuitem" type="button" onClick={() => open('price')} className="w-full px-3 py-2 text-left hover:bg-slate-50 inline-flex items-center gap-2">
                  <Pencil className="w-4 h-4 text-[#0E4D5C]" /> Change price
                </button>
              )}
              {canEnd && (
                <button role="menuitem" type="button" onClick={() => open('end')} className="w-full px-3 py-2 text-left hover:bg-slate-50 inline-flex items-center gap-2">
                  <PauseCircle className="w-4 h-4 text-slate-600" /> End listing
                </button>
              )}
              {canDelete && (
                <button role="menuitem" type="button" onClick={() => open('delete')} className="w-full px-3 py-2 text-left hover:bg-red-50 text-red-600 inline-flex items-center gap-2">
                  <Trash2 className="w-4 h-4" /> Delete
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {dialog === 'price' && (
        <ConfirmDialog
          title="Change the price"
          confirmLabel="Save price"
          busyLabel="Saving…"
          busy={busy}
          error={error}
          onConfirm={run}
          onCancel={() => setDialog(null)}
        >
          <label className="block">
            <span className="font-semibold text-slate-700">New price ($)</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min={MIN_PRICE_CENTS / 100}
              max={MAX_PRICE_CENTS / 100}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="mt-1 w-full border px-3 py-2 rounded-lg text-base"
            />
          </label>
          <p>
            {priceCents && priceCents >= MIN_PRICE_CENTS
              ? `You'd get ${formatCents(sellerPayoutCents(priceCents))} after the ${PLATFORM_FEE_LABEL} fee. `
              : ''}
            People watching it are told if the price drops.
          </p>
        </ConfirmDialog>
      )}

      {dialog === 'end' && (
        <ConfirmDialog
          title="End this listing?"
          confirmLabel="End listing"
          busyLabel="Ending…"
          busy={busy}
          error={error}
          onConfirm={run}
          onCancel={() => setDialog(null)}
        >
          <p>
            <strong>{listing.title}</strong> comes off sale right away.{' '}
            {listing.listingType !== 'auction'
              ? 'You can put it back up any time from the Inactive tab on your dashboard.'
              : 'You can relist it later as a new auction from the Inactive tab on your dashboard.'}
          </p>
        </ConfirmDialog>
      )}

      {dialog === 'delete' && (
        <ConfirmDialog
          title="Delete this listing for good?"
          confirmLabel="Delete"
          busyLabel="Deleting…"
          busy={busy}
          error={error}
          onConfirm={run}
          onCancel={() => setDialog(null)}
        >
          <p>
            <strong>{listing.title}</strong> and its photos are removed permanently. This can&apos;t be undone. If you might
            sell it later, end the listing instead.
          </p>
        </ConfirmDialog>
      )}
    </>
  )
}

function message(e: { code?: string; message: string }) {
  return e.code === 'P0001' ? `${e.message}.` : 'Something went wrong. Please try again.'
}
