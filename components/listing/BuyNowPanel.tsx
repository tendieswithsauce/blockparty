// components/listing/BuyNowPanel.tsx
// Buy Now for fixed-price listings: holds the price on the buyer's saved card
// (with a 3D Secure check if their bank asks for one).
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, CreditCard, ShoppingBag } from 'lucide-react'
import { loadStripe } from '@stripe/stripe-js'
import { createClient } from '@/lib/supabase/client'
import { formatCents } from '@/lib/money'
import { buyNow, confirmPurchase } from '@/app/purchases/actions'

type ListingInfo = { id: number; sellerId: string; status: string; priceCents: number; hubName: string }

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY

export function BuyNowPanel({ listing }: { listing: ListingInfo }) {
  const [userId, setUserId] = useState<string | null | undefined>(undefined)
  const [hasCard, setHasCard] = useState(false)
  const [ownsPurchase, setOwnsPurchase] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [bought, setBought] = useState(false)

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    async function load() {
      const { data: auth } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }))
      if (cancelled) return
      const uid = auth.user?.id ?? null
      setUserId(uid)
      if (!uid) return
      const [{ data: profile }, { data: txn }] = await Promise.all([
        supabase.from('profiles').select('stripe_payment_method_id').eq('id', uid).single(),
        supabase
          .from('transactions')
          .select('id')
          .eq('listing_id', listing.id)
          .eq('buyer_id', uid)
          .in('status', ['authorized', 'dropped_off', 'completed'])
          .maybeSingle(),
      ])
      if (cancelled) return
      setHasCard(Boolean(profile?.stripe_payment_method_id))
      setOwnsPurchase(Boolean(txn))
    }
    load()
    return () => {
      cancelled = true
    }
  }, [listing.id])

  async function onBuy() {
    setError('')
    if (!agreed) return setError('Please confirm the payment terms below.')
    setSubmitting(true)
    try {
      let result = await buyNow(listing.id)
      if (result.status === 'requires_action') {
        // The bank wants a 3D Secure check before it approves the hold.
        const stripe = publishableKey ? await loadStripe(publishableKey) : null
        if (!stripe) throw new Error('Stripe failed to load')
        await stripe.handleNextAction({ clientSecret: result.clientSecret })
        result = await confirmPurchase(result.transactionId)
      }
      if (result.status === 'authorized') setBought(true)
      else if (result.status === 'error') setError(result.error)
      else setError('Your bank needs you to verify this purchase. Please try again.')
    } catch {
      setError('Something went wrong. Please try again. You have not been charged.')
    } finally {
      setSubmitting(false)
    }
  }

  const price = formatCents(listing.priceCents)
  const sold = bought || ownsPurchase

  return (
    <div className="bg-white border rounded-2xl p-6 shadow-sm space-y-4">
      <p className="text-sm text-slate-500">Price</p>
      <p className="text-4xl font-extrabold text-[#0E4D5C]">{price}</p>

      {sold ? (
        <div className="space-y-3">
          <div className="flex items-start gap-2 p-4 rounded-xl bg-green-50 text-green-800 text-sm">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <p>
              <span className="font-semibold">It&apos;s yours!</span> We&apos;ve placed a hold of {price} on your card. You&apos;ll
              be charged when you pick it up at {listing.hubName}. We&apos;ll email you when it&apos;s ready.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="block text-center w-full py-3 rounded-full border-2 border-[#0E4D5C] text-[#0E4D5C] font-bold hover:bg-[#0E4D5C]/5"
          >
            View in your dashboard
          </Link>
        </div>
      ) : listing.status !== 'active' ? (
        <p className="text-sm text-slate-600 bg-slate-50 rounded-xl p-3">This item has been sold.</p>
      ) : userId === undefined ? (
        <div className="h-12 rounded-full bg-slate-100 animate-pulse" />
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
          <p className="text-sm text-slate-600">Add a payment method to buy. Your card is only charged at pickup.</p>
          <Link
            href="/profile#payment-method"
            className="flex items-center justify-center gap-2 w-full py-3 rounded-full bg-[#0E4D5C] text-white font-bold hover:bg-[#0b3f4b]"
          >
            <CreditCard className="w-4 h-4" /> Add payment method
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {error && <div className="p-3 rounded-xl text-sm bg-red-50 text-red-700">{error}</div>}
          <button
            onClick={onBuy}
            disabled={submitting}
            className="flex items-center justify-center gap-2 w-full py-3 rounded-full bg-[#F26B5B] text-white font-bold hover:bg-[#e05a4a] disabled:opacity-60"
          >
            <ShoppingBag className="w-4 h-4" />
            {submitting ? 'Placing hold…' : `Buy Now for ${price}`}
          </button>
          <label className="flex items-start gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
            <span>
              Blockparty will place a hold of {price} on my saved card now and charge it when I pick up the item at{' '}
              {listing.hubName}. Purchases can&apos;t be cancelled.
            </span>
          </label>
        </div>
      )}
    </div>
  )
}
