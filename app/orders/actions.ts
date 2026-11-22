// app/orders/actions.ts
// The handoff and cancelling. Scheduling (spot and times) happens through
// database functions the buyer and seller call directly; these steps also
// move money, so they run on the server.
'use server'

import { after } from 'next/server'
import { getCurrentUser } from '@/lib/auth/current-user'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe, stripeConfigured } from '@/lib/stripe/server'
import { CANCEL_REASONS } from '@/lib/orders'
import { payoutSeller } from '@/lib/payments/payouts'
import { closeAuction } from '@/lib/payments/close-auction'

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

/**
 * The seller enters the buyer's handoff code at the meetup. On a match the
 * buyer's card is charged and the seller is paid (price minus the fee),
 * straight away or, for a new seller, a few days later (payoutDueAt).
 */
export async function completeHandoff(
  transactionId: number,
  code: string,
): Promise<Result<{ payoutCents: number; payoutPending: boolean; payoutDueAt: string | null }>> {
  if (!stripeConfigured()) return { ok: false, error: 'Payments are not set up yet.' }
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: 'Please sign in.' }

  const admin = createAdminClient()
  const { data: matches, error: codeError } = await admin.rpc('check_handoff_code', {
    p_transaction_id: transactionId,
    p_seller_id: user.id,
    p_code: code,
  })
  if (codeError) {
    return { ok: false, error: codeError.code === 'P0001' ? `${codeError.message}.` : 'Something went wrong. Please try again.' }
  }
  if (!matches) return { ok: false, error: "That code doesn't match. Ask the buyer to check the code on their order page." }

  const { data: txn } = await admin
    .from('transactions')
    .select('id, listing_id, buyer_id, seller_id, amount_cents, platform_fee_cents, stripe_payment_intent_id')
    .eq('id', transactionId)
    .single()
  if (!txn?.stripe_payment_intent_id) return { ok: false, error: 'This order has no payment to collect.' }
  const payoutCents = txn.amount_cents - txn.platform_fee_cents

  const stripe = getStripe()
  // 1. Charge the buyer's held card.
  let chargeId: string | null = null
  try {
    let intent = await stripe.paymentIntents.retrieve(txn.stripe_payment_intent_id)
    if (intent.status === 'requires_capture') {
      intent = await stripe.paymentIntents.capture(intent.id, {}, { idempotencyKey: `capture-${txn.id}` })
    }
    if (intent.status !== 'succeeded') {
      return { ok: false, error: "We couldn't charge the buyer's card (the hold may have expired). Don't hand over the item." }
    }
    chargeId = typeof intent.latest_charge === 'string' ? intent.latest_charge : (intent.latest_charge?.id ?? null)
  } catch (err) {
    console.error('completeHandoff: capture failed', txn.id, err)
    return { ok: false, error: "We couldn't charge the buyer's card. Don't hand over the item yet; try again in a moment." }
  }

  // 2. The sale is complete. The database says when the seller is paid: now,
  //    or some days from now for a new seller (the cron pays it then).
  const { data: payoutDueAt, error: completeError } = await admin.rpc('complete_order', { p_transaction_id: txn.id })
  if (completeError) console.error('completeHandoff: complete_order failed', txn.id, completeError)
  const due = payoutDueAt ? new Date(payoutDueAt) : null
  if (due && due.getTime() > Date.now() + 60_000) {
    return { ok: true, payoutCents, payoutPending: false, payoutDueAt: due.toISOString() }
  }

  // 3. Pay the seller now. The buyer has paid either way, so if this fails
  //    the cron route retries it (same idempotency key: never paid twice).
  const transferId = due ? await payoutSeller({ ...txn, payout_cents: payoutCents }, chargeId) : null
  return { ok: true, payoutCents, payoutPending: transferId === null, payoutDueAt: null }
}

/**
 * Either party cancels before the handoff. The buyer's hold is released.
 * A seller cancelling because something came up ('extenuating') explains it
 * in a note the buyer sees. If
 * the buyer backed out of an auction, cancel_order puts the listing back to
 * active and we offer it to the next-highest bidder straight away (the cron
 * route picks it up within a minute if this doesn't finish).
 */
export async function cancelOrder(transactionId: number, reason: string, note?: string): Promise<Result> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: 'Please sign in.' }
  if (!Object.hasOwn(CANCEL_REASONS.buyer, reason) && !Object.hasOwn(CANCEL_REASONS.seller, reason)) {
    return { ok: false, error: 'Choose a reason.' }
  }

  const { data: paymentIntentId, error } = await createAdminClient().rpc('cancel_order', {
    p_transaction_id: transactionId,
    p_user_id: user.id,
    p_reason: reason,
    p_note: reason === 'extenuating' ? (note ?? '').slice(0, 500) : undefined,
  })
  if (error) {
    return { ok: false, error: error.code === 'P0001' ? `${error.message}.` : 'Something went wrong. Please try again.' }
  }
  if (paymentIntentId && stripeConfigured()) {
    await getStripe()
      .paymentIntents.cancel(paymentIntentId)
      .catch((err) => console.error('cancelOrder: releasing hold failed', paymentIntentId, err))
  }

  const { data: txn } = await createAdminClient()
    .from('transactions')
    .select('listing_id, listing:listings(listing_type, status)')
    .eq('id', transactionId)
    .single()
  if (txn?.listing?.listing_type === 'auction' && txn.listing.status === 'active' && stripeConfigured()) {
    after(() => closeAuction(txn.listing_id).catch((err) => console.error('cancelOrder: next bidder failed', txn.listing_id, err)))
  }
  return { ok: true }
}
