// components/listing/OfferPanel.tsx
// "Make an offer" on a set-price listing that's open to offers. The offer is
// held on the buyer's card right away (3D Secure, like Buy Now), so it's
// real: if the seller accepts, it's sold. Up to 3 offers per item, one at a
// time. The seller can answer "meet in the middle", which the buyer accepts
// with one tap (a new hold at the middle price).
'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { HandCoins, Handshake, Undo2 } from 'lucide-react'
import { loadStripe } from '@stripe/stripe-js'
import { createClient } from '@/lib/supabase/client'
import { dollarsToCents, formatCents } from '@/lib/money'
import { MIN_PRICE_CENTS } from '@/lib/fees'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { HandoffChoice } from '@/components/listing/HandoffChoice'
import { type HandoffMethod, type HandoffOptions, availableMethods, methodTitle } from '@/lib/handoff'
import type { OfferStatus } from '@/lib/supabase/database.types'
import {
  acceptCounter,
  declineCounter,
  finishCounter,
  finishOffer,
  makeOffer,
  withdrawOffer,
  type OfferResult,
} from '@/app/offers/actions'

type ListingInfo = { id: number; title: string; sellerId: string; status: string; priceCents: number; handoff: HandoffOptions }

type MyOffer = {
  id: number
  amount_cents: number
  counter_cents: number | null
  status: OfferStatus
  expires_at: string | null
  delivery_fee_cents: number
  handoff_method: HandoffMethod
  created_at: string
}

const MAX_OFFERS = 3
const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY

const when = (iso: string) => new Date(iso).toLocaleString('en-CA', { weekday: 'short', hour: 'numeric', minute: '2-digit' })

const PAST: Partial<Record<OfferStatus, string>> = {
  declined: 'The seller declined your last offer',
  auto_declined: 'Your last offer was below what the seller will consider',
  counter_declined: 'You passed on the middle price',
  withdrawn: 'You withdrew your last offer',
  expired: 'Your last offer expired',
}

export function OfferPanel({ listing }: { listing: ListingInfo }) {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null | undefined>(undefined)
  const [hasCard, setHasCard] = useState(false)
  const [hasHomeAddress, setHasHomeAddress] = useState(false)
  const [offers, setOffers] = useState<MyOffer[]>([])
  const [method, setMethod] = useState<HandoffMethod>(() => availableMethods(listing.handoff)[0] ?? 'meetup')
  const [amount, setAmount] = useState('')
  const [pendingCents, setPendingCents] = useState<number | null>(null)
  const [dialog, setDialog] = useState<'offer' | 'counter' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data: auth } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }))
    const uid = auth.user?.id ?? null
    if (!uid) return setUserId(null)
    const [{ data: profile }, { data: mine }] = await Promise.all([
      supabase.from('profiles').select('stripe_payment_method_id, home_address').eq('id', uid).single(),
      supabase
        .from('offers')
        .select('id, amount_cents, counter_cents, status, expires_at, delivery_fee_cents, handoff_method, created_at')
        .eq('listing_id', listing.id)
        .eq('buyer_id', uid)
        .order('created_at', { ascending: false }),
    ])
    setHasCard(Boolean(profile?.stripe_payment_method_id))
    setHasHomeAddress(Boolean(profile?.home_address))
    setOffers((mine as MyOffer[] | null) ?? [])
    setUserId(uid)
  }, [listing.id])

  useEffect(() => {
    const first = setTimeout(load, 0)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => {
      clearTimeout(first)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  // Only signed-in buyers with a card, on an item still for sale.
  if (!userId || userId === listing.sellerId || !hasCard || listing.status !== 'active') return null

  const active = offers.find((o) => o.status === 'open' || o.status === 'countered')
  const used = offers.filter((o) => o.status !== 'failed' && o.status !== 'placing').length
  const left = Math.max(MAX_OFFERS - used, 0)
  const last = offers.find((o) => o.status in PAST)

  async function run(first: () => Promise<OfferResult>, finish: (id: number) => Promise<OfferResult>) {
    setError('')
    setBusy(true)
    try {
      let result = await first()
      if (result.status === 'requires_action') {
        const stripe = publishableKey ? await loadStripe(publishableKey) : null
        if (!stripe) throw new Error('Stripe failed to load')
        await stripe.handleNextAction({ clientSecret: result.clientSecret })
        result = await finish(result.offerId)
      }
      return result
    } catch {
      return { status: 'error', error: 'Something went wrong. Please try again. You have not been charged.' } as OfferResult
    } finally {
      setBusy(false)
    }
  }

  function review(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setMessage('')
    const cents = dollarsToCents(amount)
    if (cents === null) return setError('Enter a valid amount.')
    if (cents < MIN_PRICE_CENTS) return setError(`Offers start at ${formatCents(MIN_PRICE_CENTS)}.`)
    if (cents >= listing.priceCents) return setError("That's the asking price or more. Buy it instead.")
    setPendingCents(cents)
    setDialog('offer')
  }

  async function sendOffer() {
    if (pendingCents === null) return
    const result = await run(
      () => makeOffer(listing.id, pendingCents, method),
      (id) => finishOffer(id),
    )
    if (result.status === 'error') return setError(result.error)
    setDialog(null)
    setAmount('')
    setMessage(
      result.status === 'auto_declined'
        ? `The seller won't consider offers that low, so it was declined automatically. Nothing was held on your card.`
        : 'Offer sent! The seller has 48 hours to answer. The amount is on hold on your card until then.',
    )
    load()
  }

  async function takeCounter() {
    if (!active) return
    const result = await run(
      () => acceptCounter(active.id),
      (id) => finishCounter(id),
    )
    if (result.status === 'accepted') return router.push(`/orders/${result.transactionId}`)
    if (result.status === 'error') setError(result.error)
  }

  async function simple(action: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) {
    setError('')
    setMessage('')
    setBusy(true)
    const result = await action().catch(() => ({ ok: false as const, error: 'Something went wrong. Please try again.' }))
    setBusy(false)
    if (!result.ok) return setError(result.error)
    setMessage(done)
    load()
  }

  const deliveryCents = method === 'delivery' ? (listing.handoff.deliveryFeeCents ?? 0) : 0

  return (
    <div className="bg-white border rounded-2xl p-6 shadow-sm space-y-3">
      <p className="flex items-center gap-2 font-bold">
        <HandCoins className="w-5 h-5 text-[#0E4D5C]" /> Make an offer
      </p>

      {message && <div className="p-3 rounded-xl text-sm bg-green-50 text-green-800">{message}</div>}
      {error && !dialog && <div className="p-3 rounded-xl text-sm bg-red-50 text-red-700">{error}</div>}

      {active?.status === 'countered' && active.counter_cents ? (
        <div className="space-y-3">
          <div className="flex items-start gap-2 p-4 rounded-xl bg-[#F4A261]/15 text-sm">
            <Handshake className="w-5 h-5 shrink-0 text-[#0E4D5C]" />
            <p>
              <span className="font-semibold">The seller will meet you in the middle at {formatCents(active.counter_cents)}</span>{' '}
              (you offered {formatCents(active.amount_cents)}). It&apos;s yours if you accept
              {active.expires_at && <> by {when(active.expires_at)}</>}.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setError('')
                setDialog('counter')
              }}
              className="px-5 py-2.5 rounded-full bg-[#F26B5B] text-white font-bold hover:bg-[#e05a4a] disabled:opacity-60"
            >
              Buy for {formatCents(active.counter_cents + active.delivery_fee_cents)}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => simple(() => declineCounter(active.id), 'No problem. The hold on your card has been released.')}
              className="px-5 py-2.5 rounded-full border-2 border-slate-300 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              No thanks
            </button>
          </div>
        </div>
      ) : active ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Your offer of <strong>{formatCents(active.amount_cents)}</strong> is with the seller
            {active.expires_at && <> until {when(active.expires_at)}</>}. It&apos;s on hold on your card; if they accept,
            it&apos;s yours.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => simple(() => withdrawOffer(active.id), 'Offer withdrawn. The hold on your card has been released.')}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border-2 border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            <Undo2 className="w-4 h-4" /> Withdraw offer
          </button>
        </div>
      ) : left === 0 ? (
        <p className="text-sm text-slate-600">
          You&apos;ve made {MAX_OFFERS} offers on this item, the most allowed. You can still buy it at{' '}
          {formatCents(listing.priceCents)}.
        </p>
      ) : (
        <form onSubmit={review} className="space-y-2">
          {last && !message && (
            <p className="text-sm text-slate-500">
              {PAST[last.status]} ({formatCents(last.amount_cents)}).
            </p>
          )}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min={MIN_PRICE_CENTS / 100}
                max={(listing.priceCents - 1) / 100}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Your price"
                aria-label="Your offer in dollars"
                className="w-full border rounded-full pl-7 pr-3 py-2.5"
              />
            </div>
            <button
              type="submit"
              disabled={busy || !amount}
              className="px-5 py-2.5 rounded-full border-2 border-[#0E4D5C] text-[#0E4D5C] font-bold hover:bg-[#0E4D5C]/5 disabled:opacity-60"
            >
              Make offer
            </button>
          </div>
          <p className="text-xs text-slate-500">
            {left} of {MAX_OFFERS} offers left on this item. The seller can accept, meet you in the middle, or decline.
          </p>
        </form>
      )}

      {dialog === 'offer' && pendingCents !== null && (
        <ConfirmDialog
          title={`Offer ${formatCents(pendingCents)} for ${listing.title}?`}
          confirmLabel={`Offer ${formatCents(pendingCents + deliveryCents)}`}
          busyLabel="Placing hold…"
          busy={busy}
          error={error}
          onConfirm={sendOffer}
          onCancel={() => {
            setDialog(null)
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
            Blockparty will hold <strong>{formatCents(pendingCents + deliveryCents)}</strong>
            {deliveryCents > 0 && <> ({formatCents(pendingCents)} + {formatCents(deliveryCents)} delivery)</>} on your saved card
            now. If the seller accepts within 48 hours, <strong>it&apos;s yours</strong>, and you&apos;re charged once you&apos;ve
            checked the item ({methodTitle(method).toLowerCase()}). If they decline or don&apos;t answer, the hold is released.
          </p>
          <p>
            The asking price is {formatCents(listing.priceCents)}. You can make up to {MAX_OFFERS} offers on this item; you have{' '}
            {left} left.
          </p>
        </ConfirmDialog>
      )}

      {dialog === 'counter' && active?.counter_cents && (
        <ConfirmDialog
          title={`Buy ${listing.title} for ${formatCents(active.counter_cents + active.delivery_fee_cents)}?`}
          confirmLabel={`Buy for ${formatCents(active.counter_cents + active.delivery_fee_cents)}`}
          busyLabel="Placing hold…"
          busy={busy}
          error={error}
          onConfirm={takeCounter}
          onCancel={() => {
            setDialog(null)
            setError('')
          }}
        >
          <p>
            Blockparty will hold {formatCents(active.counter_cents + active.delivery_fee_cents)} on your saved card and release
            the hold for your first offer. The item is yours, and you&apos;re charged once you&apos;ve checked it (
            {methodTitle(active.handoff_method).toLowerCase()}).
          </p>
        </ConfirmDialog>
      )}
    </div>
  )
}
