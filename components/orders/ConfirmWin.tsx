// components/orders/ConfirmWin.tsx
// After an auction ends, the winner has 24 hours to confirm and pay. Paying
// places a hold on their saved card (their bank may show a 3D Secure check);
// they're only charged at the handoff, like any purchase. Passing sends the
// item to the next bidder and counts as a cancellation. The seller sees a
// "waiting for the winner" note instead.
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CreditCard, Hourglass, Trophy } from 'lucide-react'
import { loadStripe } from '@stripe/stripe-js'
import { formatCents } from '@/lib/money'
import { formatMeetupTime } from '@/lib/orders'
import { methodTitle, type HandoffMethod } from '@/lib/handoff'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { SecuredByStripe } from '@/components/StripeBadge'
import { confirmAuctionWin, declineAuctionWin, finishAuctionWin } from '@/app/purchases/actions'

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
const card = 'bg-white border rounded-2xl p-6 shadow-sm space-y-4'

function timeLeft(ms: number) {
  const m = Math.max(0, Math.floor(ms / 60_000))
  const h = Math.floor(m / 60)
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`
}

export function ConfirmWin({
  orderId,
  role,
  amountCents,
  deliveryFeeCents,
  method,
  confirmBy,
  tz,
  otherName,
  now,
  onDone,
}: {
  orderId: number
  role: 'buyer' | 'seller'
  amountCents: number
  deliveryFeeCents: number
  method: HandoffMethod
  confirmBy: string
  tz: string
  otherName: string
  now: number | null
  onDone: () => void
}) {
  const [dialog, setDialog] = useState<'pay' | 'pass' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const msLeft = now === null ? null : new Date(confirmBy).getTime() - now
  const deadline = formatMeetupTime(confirmBy, tz)

  if (role === 'seller') {
    return (
      <div className={card}>
        <p className="flex items-center gap-2 font-bold">
          <Hourglass className="w-5 h-5 text-[#F4A261]" /> Waiting for {otherName} to confirm
        </p>
        <p className="text-sm text-slate-600">
          {otherName} won with {formatCents(amountCents)} and has until {deadline} to confirm and pay. If they don&apos;t, it goes
          to the next bidder who met your price. We&apos;ll let you know either way.
        </p>
      </div>
    )
  }

  async function pay() {
    setError('')
    setBusy(true)
    try {
      let result = await confirmAuctionWin(orderId)
      if (result.status === 'requires_action') {
        const stripe = publishableKey ? await loadStripe(publishableKey) : null
        if (!stripe) throw new Error('Stripe failed to load')
        await stripe.handleNextAction({ clientSecret: result.clientSecret })
        result = await finishAuctionWin(orderId)
      }
      if (result.status === 'authorized') {
        setDialog(null)
        onDone()
      } else if (result.status === 'error') setError(result.error)
      else setError('Your bank needs you to verify this payment. Please try again.')
    } catch {
      setError('Something went wrong. Please try again. You have not been charged.')
    } finally {
      setBusy(false)
    }
  }

  async function pass() {
    setError('')
    setBusy(true)
    const result = await declineAuctionWin(orderId).catch(() => ({ ok: false as const, error: 'Something went wrong.' }))
    setBusy(false)
    if (!result.ok) return setError(result.error)
    setDialog(null)
    onDone()
  }

  return (
    <div className={`${card} border-[#F26B5B]/40`}>
      <p className="flex items-center gap-2 font-bold text-lg">
        <Trophy className="w-5 h-5 text-[#F26B5B]" /> You won! Confirm and pay
      </p>
      <p className="text-sm text-slate-600">
        Confirm by <strong>{deadline}</strong>
        {msLeft !== null && msLeft > 0 && <> ({timeLeft(msLeft)} left)</>}, or it goes to the next bidder. We&apos;ll hold{' '}
        <strong>{formatCents(amountCents)}</strong>
        {deliveryFeeCents > 0 && <> (incl. {formatCents(deliveryFeeCents)} delivery)</>} on your saved card. You&apos;re only
        charged once you&apos;ve met {otherName} and checked the item ({methodTitle(method).toLowerCase()}).
      </p>
      {error && !dialog && <div className="p-3 rounded-xl text-sm bg-red-50 text-red-700">{error}</div>}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setError('')
            setDialog('pay')
          }}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#F26B5B] text-white font-bold hover:bg-[#e05a4a]"
        >
          <CreditCard className="w-4 h-4" /> Confirm and pay {formatCents(amountCents)}
        </button>
        <button
          type="button"
          onClick={() => {
            setError('')
            setDialog('pass')
          }}
          className="text-sm font-semibold text-slate-500 hover:text-red-600 underline"
        >
          I don&apos;t want it
        </button>
      </div>
      <p className="text-xs text-slate-500">
        Card declined? <Link href="/profile#payment-method" className="underline">Change your card</Link>, then come back
        and confirm before the time runs out.
      </p>
      <SecuredByStripe text="Your payment is handled by Stripe." />

      {dialog === 'pay' && (
        <ConfirmDialog
          title="Confirm your win?"
          confirmLabel={`Hold ${formatCents(amountCents)}`}
          busyLabel="Placing hold…"
          busy={busy}
          error={error}
          onConfirm={pay}
          onCancel={() => setDialog(null)}
        >
          <p>
            Blockparty will place a hold of <strong>{formatCents(amountCents)}</strong> on your saved card now. Your bank may
            ask you to verify it. Your card is only charged once you&apos;ve checked the item and given {otherName} your
            handoff code.
          </p>
          <p>You and {otherName} then have 5 days to do the handoff.</p>
        </ConfirmDialog>
      )}
      {dialog === 'pass' && (
        <ConfirmDialog
          title="Pass on this item?"
          confirmLabel="Pass to the next bidder"
          busyLabel="Passing…"
          busy={busy}
          error={error}
          onConfirm={pass}
          onCancel={() => setDialog(null)}
        >
          <p>
            It goes to the next-highest bidder and you won&apos;t be charged. This counts as a cancellation: cancelling 3 orders
            in 30 days pauses buying and bidding for a while.
          </p>
        </ConfirmDialog>
      )}
    </div>
  )
}
