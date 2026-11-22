// app/purchases/actions.ts
// Buy Now: reserve the listing, then put a hold on the buyer's saved card for
// the price (a PaymentIntent with manual capture). The hold is captured at the
// in-person handoff (app/orders/actions.ts); nothing is charged yet.
// Also the auction winner's "confirm and pay" (and "pass"), within 24 hours
// of the auction ending.
'use server'

import Stripe from 'stripe'
import { after } from 'next/server'
import { getCurrentUser } from '@/lib/auth/current-user'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe, stripeConfigured } from '@/lib/stripe/server'
import { MIN_PLATFORM_FEE_CENTS, PLATFORM_FEE_BPS } from '@/lib/fees'
import { BUY_NOW_CANCEL_WINDOW_SECONDS, CANCEL_GRACE_SECONDS } from '@/lib/purchase-rules'
import { NoSavedCardError, createHold, markAuthorized } from '@/lib/payments/holds'
import { closeAuction } from '@/lib/payments/close-auction'
import type { HandoffMethod } from '@/lib/handoff'

export type BuyResult =
  | { status: 'authorized'; transactionId: number }
  | { status: 'requires_action'; transactionId: number; clientSecret: string }
  | { status: 'error'; error: string }

const GENERIC_ERROR = 'Something went wrong placing the hold on your card. You have not been charged.'

type Txn = { id: number; buyer_id: string; status: string; stripe_payment_intent_id: string | null }

const METHODS: HandoffMethod[] = ['meetup', 'pickup', 'delivery']

export async function buyNow(listingId: number, handoff: HandoffMethod = 'meetup'): Promise<BuyResult> {
  if (!stripeConfigured()) return { status: 'error', error: 'Payments are not set up yet. Please try again later.' }
  const user = await getCurrentUser()
  if (!user) return { status: 'error', error: 'Please sign in to buy.' }
  if (!Number.isSafeInteger(listingId)) return { status: 'error', error: 'Listing not found.' }
  if (!METHODS.includes(handoff)) return { status: 'error', error: "Choose how you'll get the item." }

  const admin = createAdminClient()
  const { data: txn, error: reserveError } = await admin.rpc('begin_purchase', {
    p_listing_id: listingId,
    p_buyer_id: user.id,
    p_fee_bps: PLATFORM_FEE_BPS,
    p_min_fee_cents: MIN_PLATFORM_FEE_CENTS,
    p_handoff: handoff,
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

    const intent = await createHold(txn)
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
    return { status: 'error', error: 'Your time to buy ran out and the item is no longer available. You have not been charged.' }
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

// ---------------------------------------------------------------------------
// Auction wins: the winner confirms and pays within 24 hours.
// ---------------------------------------------------------------------------

type WinTxn = Txn & { listing_id: number; seller_id: string; amount_cents: number; confirm_by: string | null }

async function loadWin(transactionId: number, userId: string) {
  if (!Number.isSafeInteger(transactionId)) return null
  const { data } = await createAdminClient()
    .from('transactions')
    .select('id, listing_id, buyer_id, seller_id, amount_cents, status, stripe_payment_intent_id, confirm_by')
    .eq('id', transactionId)
    .eq('buyer_id', userId)
    .maybeSingle()
  return data as WinTxn | null
}

/**
 * The winner confirms: hold their bid on their saved card (with 3D Secure).
 * If the card is declined they can add another card and try again until the
 * 24 hours run out.
 */
export async function confirmAuctionWin(transactionId: number): Promise<BuyResult> {
  if (!stripeConfigured()) return { status: 'error', error: 'Payments are not set up yet. Please try again later.' }
  const user = await getCurrentUser()
  if (!user) return { status: 'error', error: 'Please sign in.' }
  const txn = await loadWin(transactionId, user.id)
  if (!txn?.confirm_by) return { status: 'error', error: 'Order not found.' }
  if (txn.status === 'authorized') return { status: 'authorized', transactionId: txn.id }
  if (txn.status !== 'pending') return { status: 'error', error: 'Your time to confirm ran out, so this went to the next bidder.' }

  const stripe = getStripe()
  try {
    // A 3D Secure check that was closed partway: pick it up again.
    if (txn.stripe_payment_intent_id) {
      const existing = await stripe.paymentIntents.retrieve(txn.stripe_payment_intent_id)
      if (existing.status === 'requires_capture' || existing.status === 'requires_action') return settleWin(txn, existing)
      if (existing.status !== 'canceled') await stripe.paymentIntents.cancel(existing.id).catch(() => {})
    }
    // Retries with another card get a new key; a double click within 30s doesn't.
    const intent = await createHold(txn, { idempotencyKey: `win-${txn.id}-${Math.floor(Date.now() / 30_000)}` })
    return settleWin(txn, intent)
  } catch (err) {
    if (err instanceof NoSavedCardError) return { status: 'error', error: err.message }
    if (err instanceof Stripe.errors.StripeCardError) {
      await clearWinHold(txn.id)
      return { status: 'error', error: `${err.message} Try another card. You have not been charged.` }
    }
    console.error('confirmAuctionWin failed', err)
    return { status: 'error', error: GENERIC_ERROR }
  }
}

/** Called by the browser after the winner finishes a 3D Secure check. */
export async function finishAuctionWin(transactionId: number): Promise<BuyResult> {
  if (!stripeConfigured()) return { status: 'error', error: GENERIC_ERROR }
  const user = await getCurrentUser()
  if (!user) return { status: 'error', error: 'Please sign in.' }
  const txn = await loadWin(transactionId, user.id)
  if (!txn?.stripe_payment_intent_id) return { status: 'error', error: GENERIC_ERROR }
  try {
    return settleWin(txn, await getStripe().paymentIntents.retrieve(txn.stripe_payment_intent_id))
  } catch (err) {
    console.error('finishAuctionWin failed', err)
    return { status: 'error', error: GENERIC_ERROR }
  }
}

/** The winner doesn't want it after all: it goes to the next bidder. Counts as a cancellation. */
export async function declineAuctionWin(transactionId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: 'Please sign in.' }
  const admin = createAdminClient()
  const { data: paymentIntentId, error } = await admin.rpc('cancel_auction_win', {
    p_transaction_id: transactionId,
    p_buyer_id: user.id,
    p_reason: 'win_declined',
  })
  if (error) {
    return { ok: false, error: error.code === 'P0001' ? `${error.message}.` : 'Something went wrong. Please try again.' }
  }
  if (paymentIntentId && stripeConfigured()) await getStripe().paymentIntents.cancel(paymentIntentId).catch(() => {})
  const { data: txn } = await admin.from('transactions').select('listing_id').eq('id', transactionId).single()
  if (txn) {
    after(() => closeAuction(txn.listing_id).catch((err) => console.error('declineAuctionWin: next bidder failed', txn.listing_id, err)))
  }
  return { ok: true }
}

async function clearWinHold(transactionId: number) {
  await createAdminClient()
    .from('transactions')
    .update({ stripe_payment_intent_id: null })
    .eq('id', transactionId)
    .eq('status', 'pending')
}

async function settleWin(txn: WinTxn, intent: Stripe.PaymentIntent): Promise<BuyResult> {
  if (txn.status === 'authorized') return { status: 'authorized', transactionId: txn.id }
  if (intent.status === 'requires_capture') {
    if (await markAuthorized(txn.id)) return { status: 'authorized', transactionId: txn.id }
    // The 24 hours ran out while they were paying.
    await getStripe().paymentIntents.cancel(intent.id).catch(() => {})
    return { status: 'error', error: 'Your time to confirm ran out, so this went to the next bidder. You have not been charged.' }
  }
  if (intent.status === 'requires_action' && intent.client_secret) {
    return { status: 'requires_action', transactionId: txn.id, clientSecret: intent.client_secret }
  }
  // Declined or failed 3D Secure: keep the win so they can try another card.
  if (intent.status !== 'canceled') await getStripe().paymentIntents.cancel(intent.id).catch(() => {})
  await clearWinHold(txn.id)
  const lastError = intent.last_payment_error
  const reason =
    lastError?.type === 'card_error' && lastError.code !== 'payment_intent_authentication_failure' && lastError.message
      ? lastError.message
      : "Your bank couldn't verify this payment."
  return { status: 'error', error: `${reason} Try again or use another card. You have not been charged.` }
}
