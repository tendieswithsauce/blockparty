// lib/payments/close-auction.ts
// Closes an ended auction: holds the top eligible bidder's card for their bid,
// moving on to the next-highest bidder if a card fails. Also used when a
// winner backs out of the order (cancel_order sets the listing back to active),
// so the item goes straight to the next bidder. Called by the cron route and
// by cancelOrder (app/orders/actions.ts).
import Stripe from 'stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe } from '@/lib/stripe/server'
import { MIN_PLATFORM_FEE_CENTS, PLATFORM_FEE_BPS } from '@/lib/fees'
import { NoSavedCardError, createHold, markAuthorized } from '@/lib/payments/holds'

// Bidders to try per auction in one run before leaving it for the next run.
const MAX_ATTEMPTS = 10

export type CloseAuctionOutcome =
  | { listingId: number; result: 'won'; transactionId: number; bidderTries: number }
  | { listingId: number; result: 'no_winner' | 'already_closed' }
  | { listingId: number; result: 'error'; message: string }

export async function closeAuction(listingId: number): Promise<CloseAuctionOutcome> {
  const admin = createAdminClient()
  const stripe = getStripe()

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { data: txn, error } = await admin.rpc('close_auction', {
      p_listing_id: listingId,
      p_fee_bps: PLATFORM_FEE_BPS,
      p_min_fee_cents: MIN_PLATFORM_FEE_CENTS,
    })
    if (error) return { listingId, result: 'error', message: error.message }
    if (!txn?.id) return { listingId, result: 'no_winner' }
    if (txn.status !== 'pending') return { listingId, result: 'already_closed' }

    let intent: Stripe.PaymentIntent | null = null
    try {
      intent = txn.stripe_payment_intent_id
        ? await stripe.paymentIntents.retrieve(txn.stripe_payment_intent_id)
        : await createHold(txn, { offSession: true })
      if (intent.status === 'requires_capture') {
        await markAuthorized(txn.id)
        return { listingId, result: 'won', transactionId: txn.id, bidderTries: attempt }
      }
    } catch (err) {
      const cardProblem = err instanceof Stripe.errors.StripeCardError || err instanceof NoSavedCardError
      if (!cardProblem) {
        // Stripe or network trouble: leave the transaction pending and retry
        // on a later run rather than skipping a winner who did nothing wrong.
        console.error('close-auctions: hold failed', listingId, err)
        return { listingId, result: 'error', message: err instanceof Error ? err.message : 'unknown error' }
      }
      if (err instanceof Stripe.errors.StripeCardError) intent = err.payment_intent ?? null
    }

    // This bidder's card was declined or needs authentication they can't
    // give right now: release it and offer the item to the next bidder.
    if (intent && intent.status !== 'canceled') {
      await stripe.paymentIntents.cancel(intent.id).catch(() => {})
    }
    await admin.rpc('cancel_pending_purchase', { p_transaction_id: txn.id })
  }
  return { listingId, result: 'error', message: 'Too many failed cards; will retry' }
}
