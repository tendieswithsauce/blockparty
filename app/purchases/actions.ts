// app/purchases/actions.ts
// Buy Now: reserve the listing, then put a hold on the buyer's saved card for
// the price (a PaymentIntent with manual capture). The hold is captured at the
// in-person handoff (app/orders/actions.ts); nothing is charged yet.
'use server'

import Stripe from 'stripe'
import { getCurrentUser } from '@/lib/auth/current-user'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe, stripeConfigured } from '@/lib/stripe/server'
import { PLATFORM_FEE_BPS } from '@/lib/fees'
import { BUY_NOW_CANCEL_WINDOW_SECONDS, CANCEL_GRACE_SECONDS } from '@/lib/purchase-rules'
import { NoSavedCardError, createHold, markAuthorized } from '@/lib/payments/holds'

export type BuyResult =
  | { status: 'authorized'; transactionId: number }
  | { status: 'requires_action'; transactionId: number; clientSecret: string }
  | { status: 'error'; error: string }

const GENERIC_ERROR = 'Something went wrong placing the hold on your card. You have not been charged.'

type Txn = { id: number; buyer_id: string; status: string; stripe_payment_intent_id: string | null }

export async function buyNow(listingId: number): Promise<BuyResult> {
  if (!stripeConfigured()) return { status: 'error', error: 'Payments are not set up yet. Please try again later.' }
  const user = await getCurrentUser()
  if (!user) return { status: 'error', error: 'Please sign in to buy.' }
  if (!Number.isSafeInteger(listingId)) return { status: 'error', error: 'Listing not found.' }

  const admin = createAdminClient()
  const { data: txn, error: reserveError } = await admin.rpc('begin_purchase', {
    p_listing_id: listingId,
    p_buyer_id: user.id,
    p_fee_bps: PLATFORM_FEE_BPS,
  })
  if (reserveError || !txn) {
    // Our own messages from the database (P0001) are written for buyers.
    return { status: 'error', error: reserveError?.code === 'P0001' ? reserveError.message : GENERIC_ERROR }
  }

  const stripe = getStripe()
  try {
    // Retrying after a 3D Secure prompt was closed: reuse the same hold.
    if (txn.stripe_payment_intent_id) {
      const existing = await stripe.paymentIntents.retrieve(txn.stripe_payment_intent_id)
      return settle(txn, existing)
    }

    const intent = await createHold(txn, { offSession: false })
    return settle(txn, intent)
  } catch (err) {
    await admin.rpc('cancel_pending_purchase', { p_transaction_id: txn.id })
    if (err instanceof NoSavedCardError) return { status: 'error', error: err.message }
    if (err instanceof Stripe.errors.StripeCardError) {
      return { status: 'error', error: `${err.message} You have not been charged.` }
    }
    console.error('buyNow failed', err)
    return { status: 'error', error: GENERIC_ERROR }
  }
}

/** Called by the browser after the buyer finishes a 3D Secure check. */
export async function confirmPurchase(transactionId: number): Promise<BuyResult> {
  if (!stripeConfigured()) return { status: 'error', error: GENERIC_ERROR }
  const user = await getCurrentUser()
  if (!user) return { status: 'error', error: 'Please sign in to buy.' }

  const admin = createAdminClient()
  const { data: txn } = await admin
    .from('transactions')
    .select('id, buyer_id, status, stripe_payment_intent_id')
    .eq('id', transactionId)
    .eq('buyer_id', user.id)
    .maybeSingle()
  if (!txn?.stripe_payment_intent_id) return { status: 'error', error: GENERIC_ERROR }

  try {
    const intent = await getStripe().paymentIntents.retrieve(txn.stripe_payment_intent_id)
    return settle(txn, intent)
  } catch (err) {
    console.error('confirmPurchase failed', err)
    return { status: 'error', error: GENERIC_ERROR }
  }
}

/** Undo a Buy Now within the cancel window: put the item back up and release the hold. */
export async function cancelPurchase(transactionId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: 'Please sign in.' }

  const { data: paymentIntentId, error } = await createAdminClient().rpc('cancel_authorized_purchase', {
    p_transaction_id: transactionId,
    p_buyer_id: user.id,
    p_window_seconds: BUY_NOW_CANCEL_WINDOW_SECONDS + CANCEL_GRACE_SECONDS,
  })
  if (error) {
    return { ok: false, error: error.code === 'P0001' ? `${error.message}.` : 'Something went wrong. Please try again.' }
  }

  // The purchase is already cancelled on our side, so we will never capture
  // this hold; if releasing it fails, the bank drops it within 7 days anyway.
  if (paymentIntentId && stripeConfigured()) {
    await getStripe()
      .paymentIntents.cancel(paymentIntentId, { cancellation_reason: 'requested_by_customer' })
      .catch((err) => console.error('Releasing card hold failed', paymentIntentId, err))
  }
  return { ok: true }
}

/** Records the outcome of the card hold and tells the browser what to do next. */
async function settle(txn: Txn, intent: Stripe.PaymentIntent): Promise<BuyResult> {
  const admin = createAdminClient()

  if (txn.status === 'authorized') return { status: 'authorized', transactionId: txn.id }
  if (txn.status !== 'pending') {
    // The reservation expired and the item went to someone else: drop the hold.
    if (intent.status === 'requires_capture' || intent.status === 'requires_action') {
      await getStripe().paymentIntents.cancel(intent.id).catch(() => {})
    }
    return { status: 'error', error: 'Your reservation expired and the item is no longer available. You have not been charged.' }
  }

  if (intent.status === 'requires_capture') {
    await markAuthorized(txn.id)
    return { status: 'authorized', transactionId: txn.id }
  }

  if (intent.status === 'requires_action' && intent.client_secret) {
    return { status: 'requires_action', transactionId: txn.id, clientSecret: intent.client_secret }
  }

  // Declined or failed 3D Secure: release the listing.
  if (intent.status !== 'canceled') await getStripe().paymentIntents.cancel(intent.id).catch(() => {})
  await admin.rpc('cancel_pending_purchase', { p_transaction_id: txn.id })
  // Card errors carry a buyer-friendly message ("Your card was declined.");
  // others (e.g. a failed 3D Secure check) are written for developers.
  const lastError = intent.last_payment_error
  const reason =
    lastError?.type === 'card_error' && lastError.code !== 'payment_intent_authentication_failure' && lastError.message
      ? lastError.message
      : "Your bank couldn't verify this purchase."
  return { status: 'error', error: `${reason} You have not been charged.` }
}
