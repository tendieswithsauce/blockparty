// components/listing/BuyNowPanel.tsx
// Buy Now for fixed-price listings: holds the price on the buyer's saved card
// (with a 3D Secure check if their bank asks for one). The buyer confirms in a
// dialog first, and can undo the purchase for a few minutes afterwards.
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, CreditCard, ShoppingBag, Undo2 } from 'lucide-react'
import { loadStripe } from '@stripe/stripe-js'
import { createClient } from '@/lib/supabase/client'
import { formatCents } from '@/lib/money'
import { BUY_NOW_CANCEL_WINDOW_SECONDS } from '@/lib/purchase-rules'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { HandoffChoice, HandoffDeadlineNote } from '@/components/listing/HandoffChoice'
import { type HandoffMethod, type HandoffOptions, availableMethods, handoffDeadline, methodTitle } from '@/lib/handoff'
import { buyNow, cancelPurchase, confirmPurchase } from '@/app/purchases/actions'

type ListingInfo = {
  id: number
  title: string
  sellerId: string
  status: string
  priceCents: number
  acceptsOffers?: boolean
  handoff: HandoffOptions
}

/** The viewer's purchase of this listing, and until when they can undo it. */
type Purchase = { id: number; cancelUntil: number | null }

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
const WINDOW_MS = BUY_NOW_CANCEL_WINDOW_SECONDS * 1000

function mmss(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function BuyNowPanel({ listing }: { listing: ListingInfo }) {
  const [userId, setUserId] = useState<string | null | undefined>(undefined)
  const [hasCard, setHasCard] = useState(false)
  const [hasHomeAddress, setHasHomeAddress] = useState(false)
  const [method, setMethod] = useState<HandoffMethod>(() => availableMethods(listing.handoff)[0] ?? 'meetup')
  const [purchase, setPurchase] = useState<Purchase | null>(null)
  const [canceled, setCanceled] = useState(false)
  const [confirming, setConfirming] = useState(false)
  // When the dialog opened: the handoff deadline is counted from now.
  const [openedAt, setOpenedAt] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    async function load() {
      const { data: auth } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }))
      if (cancelled) return
      const uid = auth.user?.id ?? null
      if (!uid) return setUserId(null)
      const [{ data: profile }, { data: txn }] = await Promise.all([
        supabase.from('profiles').select('stripe_payment_method_id, home_address').eq('id', uid).single(),
        supabase
          .from('transactions')
          .select('id, status, authorized_at, offer_id')
          .eq('listing_id', listing.id)
          .eq('buyer_id', uid)
          .in('status', ['authorized', 'dropped_off', 'completed'])
          .maybeSingle(),
      ])
      if (cancelled) return
      setHasCard(Boolean(profile?.stripe_payment_method_id))
      setHasHomeAddress(Boolean(profile?.home_address))
      if (txn) {
        setPurchase({
          id: txn.id,
          // An accepted offer was agreed by both sides: no undo.
          cancelUntil:
            txn.status === 'authorized' && txn.authorized_at && !txn.offer_id
              ? new Date(txn.authorized_at).getTime() + WINDOW_MS
              : null,
        })
      }
      // Set last so the panel doesn't flash "sold" before we know it's theirs.
      setUserId(uid)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [listing.id])

  // Countdown while the purchase can still be undone.
  const cancelUntil = purchase?.cancelUntil ?? null
  useEffect(() => {
    if (cancelUntil === null) return
    const tick = () => setNow(Date.now())
    const first = setTimeout(tick, 0)
    const t = setInterval(tick, 1000)
    return () => {
      clearTimeout(first)
      clearInterval(t)
    }
  }, [cancelUntil])

  async function onConfirmBuy() {
    setError('')
    setSubmitting(true)
    try {
      let result = await buyNow(listing.id, method)
      if (result.status === 'requires_action') {
        // The bank wants a 3D Secure check before it approves the hold.
        const stripe = publishableKey ? await loadStripe(publishableKey) : null
        if (!stripe) throw new Error('Stripe failed to load')
        await stripe.handleNextAction({ clientSecret: result.clientSecret })
        result = await confirmPurchase(result.transactionId)
      }
      if (result.status === 'authorized') {
        setPurchase({ id: result.transactionId, cancelUntil: Date.now() + WINDOW_MS })
        setConfirming(false)
      } else if (result.status === 'error') setError(result.error)
      else setError('Your bank needs you to verify this purchase. Please try again.')
    } catch {
      setError('Something went wrong. Please try again. You have not been charged.')
    } finally {
      setSubmitting(false)
    }
  }

  async function onUndo() {
    if (!purchase) return
    setError('')
    setSubmitting(true)
    const result = await cancelPurchase(purchase.id).catch(() => ({ ok: false as const, error: 'Something went wrong. Please try again.' }))
    setSubmitting(false)
    if (result.ok) {
      setPurchase(null)
      setCanceled(true)
    } else {
      setError(result.error)
    }
  }

  const price = formatCents(listing.priceCents)
  const deliveryCents = method === 'delivery' ? (listing.handoff.deliveryFeeCents ?? 0) : 0
  const total = formatCents(listing.priceCents + deliveryCents)
  const msLeft = cancelUntil !== null && now !== null ? cancelUntil - now : null
  const canUndo = msLeft !== null && msLeft > 0
  const available = listing.status === 'active' || canceled

  return (
    <div className="bg-white border rounded-2xl p-6 shadow-sm space-y-4">
      <p className="text-sm text-slate-500">Price</p>
      <p className="text-4xl font-extrabold text-[#0E4D5C]">{price}</p>
      {listing.status === 'active' && (
        <p className="text-sm text-slate-500 -mt-2">
          {listing.acceptsOffers ? 'Open to offers' : 'Firm price'}
        </p>
      )}

      {canceled && <div className="p-3 rounded-xl text-sm bg-slate-50 text-slate-700">Purchase cancelled. Your card hold has been released.</div>}

      {purchase ? (
        <div className="space-y-3">
          <div className="flex items-start gap-2 p-4 rounded-xl bg-green-50 text-green-800 text-sm">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <p>
              <span className="font-semibold">It&apos;s yours!</span> We&apos;ve placed a hold on your card. Agree on a time with the
              seller on the order page. You&apos;re only charged once you&apos;ve checked the item.
            </p>
          </div>
          {error && <div className="p-3 rounded-xl text-sm bg-red-50 text-red-700">{error}</div>}
          {canUndo && (
            <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-dashed text-sm">
              <span className="text-slate-600">
                Changed your mind? You can cancel for <span className="font-semibold tabular-nums">{mmss(msLeft)}</span>
              </span>
              <button
                onClick={onUndo}
                disabled={submitting}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full border-2 border-slate-300 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 shrink-0"
              >
                <Undo2 className="w-4 h-4" /> {submitting ? 'Cancelling…' : 'Cancel purchase'}
              </button>
            </div>
          )}
          <Link
            href={`/orders/${purchase.id}`}
            className="block text-center w-full py-3 rounded-full border-2 border-[#0E4D5C] text-[#0E4D5C] font-bold hover:bg-[#0E4D5C]/5"
          >
            View order &amp; meetup
          </Link>
        </div>
      ) : userId === undefined ? (
        <div className="h-12 rounded-full bg-slate-100 animate-pulse" />
      ) : !available ? (
        <p className="text-sm text-slate-600 bg-slate-50 rounded-xl p-3">This item has been sold.</p>
      ) : userId === null ? (
        <Link
          href={`/login?next=${encodeURIComponent(`/listings/${listing.id}`)}`}
          className="block text-center w-full py-3 rounded-full bg-[#F26B5B] text-white font-bold hover:bg-[#e05a4a]"
        >
          Sign in to buy
        </Link>
      ) : userId === listing.sellerId ? (
        <p className="text-sm text-slate-600 bg-slate-50 rounded-xl p-3">This is your listing, so you can&apos;t buy it.</p>
      ) : !hasCard ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Add a payment method to buy. Your card is only charged once you&apos;ve met the seller and accepted the item.</p>
          <Link
            href="/profile#payment-method"
            className="flex items-center justify-center gap-2 w-full py-3 rounded-full bg-[#0E4D5C] text-white font-bold hover:bg-[#0b3f4b]"
          >
            <CreditCard className="w-4 h-4" /> Add payment method
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {error && !confirming && <div className="p-3 rounded-xl text-sm bg-red-50 text-red-700">{error}</div>}
          <button
            onClick={() => {
              setError('')
              setOpenedAt(Date.now())
              setConfirming(true)
            }}
            className="flex items-center justify-center gap-2 w-full py-3 rounded-full bg-[#F26B5B] text-white font-bold hover:bg-[#e05a4a]"
          >
            <ShoppingBag className="w-4 h-4" /> Buy for {price}
          </button>
          <p className="text-xs text-slate-500">You&apos;ll review your purchase before anything happens.</p>
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          title={`Buy ${listing.title}?`}
          confirmLabel={`Buy for ${total}`}
          busyLabel="Placing hold…"
          busy={submitting}
          error={error}
          onConfirm={onConfirmBuy}
          onCancel={() => {
            setConfirming(false)
            setError('')
          }}
        >
          <HandoffChoice
            options={listing.handoff}
            value={method}
            onChange={setMethod}
            hasHomeAddress={hasHomeAddress}
            listingId={listing.id}
          />
          <p>
            Blockparty will place a hold of <strong>{total}</strong>
            {deliveryCents > 0 && <> ({price} + {formatCents(deliveryCents)} delivery)</>} on your saved card now. Your card is
            only charged once you&apos;ve checked the item and accepted it ({methodTitle(method).toLowerCase()}).
          </p>
          <HandoffDeadlineNote deadline={handoffDeadline(openedAt)} auction={false} />
          <p>
            You can cancel within {BUY_NOW_CANCEL_WINDOW_SECONDS / 60} minutes if you change your mind. After that the
            purchase is final.
          </p>
        </ConfirmDialog>
      )}
    </div>
  )
}
