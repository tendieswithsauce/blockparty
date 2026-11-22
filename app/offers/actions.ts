// app/offers/actions.ts
// Offers on set-price listings. The card hold is placed when the buyer makes
// the offer (3D Secure, like Buy Now), so the seller only ever sees real
// offers. The database (begin_offer, respond_to_offer, accept_counter...)
// keeps the state and sends the notifications; this file moves the money.
'use server'

import Stripe from 'stripe'
import { getCurrentUser } from '@/lib/auth/current-user'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe, stripeConfigured } from '@/lib/stripe/server'
import { MIN_PLATFORM_FEE_CENTS, PLATFORM_FEE_BPS } from '@/lib/fees'
import { NoSavedCardError, placeCardHold } from '@/lib/payments/holds'
import type { HandoffMethod } from '@/lib/handoff'

export type OfferResult =
  | { status: 'open'; offerId: number }
  | { status: 'auto_declined'; offerId: number }
  | { status: 'accepted'; transactionId: number }
  | { status: 'requires_action'; offerId: number; clientSecret: string }
  | { status: 'error'; error: string }

type Simple = { ok: true } | { ok: false; error: string }

const GENERIC_ERROR = 'Something went wrong placing the hold on your card. You have not been charged.'
const METHODS: HandoffMethod[] = ['meetup', 'pickup', 'delivery']

function dbError(error: { code?: string; message: string } | null, fallback = 'Something went wrong. Please try again.') {
  return error?.code === 'P0001' ? error.message : fallback
}

/** Card holds we no longer need: the bank drops them within 7 days anyway. */
async function release(paymentIntentIds: (string | null | undefined)[]) {
  if (!stripeConfigured()) return
  const stripe = getStripe()
  await Promise.all(
    [...new Set(paymentIntentIds.filter((id): id is string => Boolean(id)))].map((id) =>
      stripe.paymentIntents.cancel(id).catch((err) => console.warn('releasing offer hold failed', id, err)),
    ),
  )
}

function holdErrorMessage(intent: Stripe.PaymentIntent) {
  const lastError = intent.last_payment_error
  const reason =
    lastError?.type === 'card_error' && lastError.code !== 'payment_intent_authentication_failure' && lastError.message
      ? lastError.message
      : "Your bank couldn't verify this payment."
  return `${reason} You have not been charged.`
}

// ---------------------------------------------------------------------------
// Buyer: make an offer
// ---------------------------------------------------------------------------

export async function makeOffer(listingId: number, amountCents: number, handoff: HandoffMethod): Promise<OfferResult> {
  if (!stripeConfigured()) return { status: 'error', error: 'Payments are not set up yet. Please try again later.' }
  const user = await getCurrentUser()
  if (!user) return { status: 'error', error: 'Please sign in to make an offer.' }
  if (!Number.isSafeInteger(listingId) || !Number.isSafeInteger(amountCents)) return { status: 'error', error: 'Enter a valid amount.' }
  if (!METHODS.includes(handoff)) return { status: 'error', error: "Choose how you'll get the item." }

  const admin = createAdminClient()
  const { data: offer, error } = await admin.rpc('begin_offer', {
    p_listing_id: listingId,
    p_buyer_id: user.id,
    p_amount_cents: amountCents,
    p_handoff: handoff,
  })
  if (error || !offer) return { status: 'error', error: dbError(error, GENERIC_ERROR) }
  if (offer.status === 'auto_declined') return { status: 'auto_declined', offerId: offer.id }

  const { data: listing } = await admin.from('listings').select('title').eq('id', listingId).single()
  try {
    const intent = await placeCardHold({
      buyerId: user.id,
      amountCents: offer.amount_cents + offer.delivery_fee_cents,
      description: `Blockparty offer #${offer.id}: ${listing?.title ?? 'item'}`,
      metadata: { offer_id: String(offer.id), listing_id: String(listingId), buyer_id: user.id, seller_id: offer.seller_id },
      idempotencyKey: `offer-${offer.id}`,
    })
    await admin.from('offers').update({ stripe_payment_intent_id: intent.id }).eq('id', offer.id)
    return settleOffer(offer.id, intent)
  } catch (err) {
    await admin.rpc('offer_hold_failed', { p_offer_id: offer.id })
    if (err instanceof NoSavedCardError) return { status: 'error', error: err.message }
    if (err instanceof Stripe.errors.StripeCardError) return { status: 'error', error: `${err.message} You have not been charged.` }
    console.error('makeOffer failed', err)
    return { status: 'error', error: GENERIC_ERROR }
  }
}

/** Called by the browser after the buyer finishes a 3D Secure check on an offer. */
export async function finishOffer(offerId: number): Promise<OfferResult> {
  if (!stripeConfigured()) return { status: 'error', error: GENERIC_ERROR }
  const user = await getCurrentUser()
  if (!user) return { status: 'error', error: 'Please sign in.' }
  const { data: offer } = await createAdminClient()
    .from('offers')
    .select('id, stripe_payment_intent_id')
    .eq('id', offerId)
    .eq('buyer_id', user.id)
    .maybeSingle()
  if (!offer?.stripe_payment_intent_id) return { status: 'error', error: GENERIC_ERROR }
  try {
    return settleOffer(offer.id, await getStripe().paymentIntents.retrieve(offer.stripe_payment_intent_id))
  } catch (err) {
    console.error('finishOffer failed', err)
    return { status: 'error', error: GENERIC_ERROR }
  }
}

async function settleOffer(offerId: number, intent: Stripe.PaymentIntent): Promise<OfferResult> {
  const admin = createAdminClient()
  if (intent.status === 'requires_capture') {
    const { data: live } = await admin.rpc('offer_hold_placed', { p_offer_id: offerId, p_payment_intent_id: intent.id })
    if (live) return { status: 'open', offerId }
    await release([intent.id])
    const { data: offer } = await admin.from('offers').select('status').eq('id', offerId).single()
    if (offer?.status === 'open') return { status: 'open', offerId }
    return { status: 'error', error: 'This item is no longer available. You have not been charged.' }
  }
  if (intent.status === 'requires_action' && intent.client_secret) {
    return { status: 'requires_action', offerId, clientSecret: intent.client_secret }
  }
  await release([intent.id])
  await admin.rpc('offer_hold_failed', { p_offer_id: offerId })
  return { status: 'error', error: holdErrorMessage(intent) }
}

export async function withdrawOffer(offerId: number): Promise<Simple> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: 'Please sign in.' }
  const { data: pi, error } = await createAdminClient().rpc('withdraw_offer', { p_offer_id: offerId, p_buyer_id: user.id })
  if (error) return { ok: false, error: dbError(error) }
  await release([pi])
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Seller: accept, meet in the middle, decline
// ---------------------------------------------------------------------------

export async function respondToOffer(
  offerId: number,
  action: 'accept' | 'counter' | 'decline',
): Promise<{ ok: true; transactionId: number | null } | { ok: false; error: string }> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: 'Please sign in.' }
  if (!['accept', 'counter', 'decline'].includes(action)) return { ok: false, error: 'Invalid request.' }

  const { data, error } = await createAdminClient().rpc('respond_to_offer', {
    p_offer_id: offerId,
    p_seller_id: user.id,
    p_action: action,
    p_fee_bps: PLATFORM_FEE_BPS,
    p_min_fee_cents: MIN_PLATFORM_FEE_CENTS,
  })
  if (error) return { ok: false, error: dbError(error) }
  const result = (data ?? {}) as { transaction_id?: number | null; release?: (string | null)[] }
  await release(result.release ?? [])
  return { ok: true, transactionId: result.transaction_id ?? null }
}

// ---------------------------------------------------------------------------
// Buyer: answer a meet-in-the-middle
// ---------------------------------------------------------------------------

/** Holds the middle price (3D Secure) and, once it's held, the item is theirs. */
export async function acceptCounter(offerId: number): Promise<OfferResult> {
  if (!stripeConfigured()) return { status: 'error', error: 'Payments are not set up yet. Please try again later.' }
  const user = await getCurrentUser()
  if (!user) return { status: 'error', error: 'Please sign in.' }

  const admin = createAdminClient()
  const { data: offer, error } = await admin.rpc('begin_counter_accept', { p_offer_id: offerId, p_buyer_id: user.id })
  if (error || !offer?.counter_cents) return { status: 'error', error: dbError(error, GENERIC_ERROR) }

  const stripe = getStripe()
  try {
    if (offer.counter_payment_intent_id) {
      const existing = await stripe.paymentIntents.retrieve(offer.counter_payment_intent_id)
      if (existing.status === 'requires_capture' || existing.status === 'requires_action') return settleCounter(offerId, user.id, existing)
      if (existing.status !== 'canceled') await release([existing.id])
    }
    const { data: listing } = await admin.from('listings').select('title').eq('id', offer.listing_id).single()
    const intent = await placeCardHold({
      buyerId: user.id,
      amountCents: offer.counter_cents + offer.delivery_fee_cents,
      description: `Blockparty offer #${offer.id}: ${listing?.title ?? 'item'}`,
      metadata: { offer_id: String(offer.id), listing_id: String(offer.listing_id), buyer_id: user.id, seller_id: offer.seller_id },
      idempotencyKey: `counter-${offer.id}-${Math.floor(Date.now() / 30_000)}`,
    })
    await admin.from('offers').update({ counter_payment_intent_id: intent.id }).eq('id', offer.id)
    return settleCounter(offerId, user.id, intent)
  } catch (err) {
    if (err instanceof NoSavedCardError) return { status: 'error', error: err.message }
    if (err instanceof Stripe.errors.StripeCardError) return { status: 'error', error: `${err.message} You have not been charged.` }
    console.error('acceptCounter failed', err)
    return { status: 'error', error: GENERIC_ERROR }
  }
}

/** Called by the browser after a 3D Secure check on the middle price. */
export async function finishCounter(offerId: number): Promise<OfferResult> {
  if (!stripeConfigured()) return { status: 'error', error: GENERIC_ERROR }
  const user = await getCurrentUser()
  if (!user) return { status: 'error', error: 'Please sign in.' }
  const { data: offer } = await createAdminClient()
    .from('offers')
    .select('id, counter_payment_intent_id')
    .eq('id', offerId)
    .eq('buyer_id', user.id)
    .maybeSingle()
  if (!offer?.counter_payment_intent_id) return { status: 'error', error: GENERIC_ERROR }
  try {
    return settleCounter(offer.id, user.id, await getStripe().paymentIntents.retrieve(offer.counter_payment_intent_id))
  } catch (err) {
    console.error('finishCounter failed', err)
    return { status: 'error', error: GENERIC_ERROR }
  }
}

async function settleCounter(offerId: number, buyerId: string, intent: Stripe.PaymentIntent): Promise<OfferResult> {
  const admin = createAdminClient()
  if (intent.status === 'requires_capture') {
    const { data, error } = await admin.rpc('accept_counter', {
      p_offer_id: offerId,
      p_buyer_id: buyerId,
      p_payment_intent_id: intent.id,
      p_fee_bps: PLATFORM_FEE_BPS,
      p_min_fee_cents: MIN_PLATFORM_FEE_CENTS,
    })
    if (error) {
      await release([intent.id])
      await admin.from('offers').update({ counter_payment_intent_id: null }).eq('id', offerId)
      return { status: 'error', error: error.code === 'P0001' ? `${error.message}. You have not been charged.` : GENERIC_ERROR }
    }
    const result = (data ?? {}) as { transaction_id?: number; release?: (string | null)[] }
    await release(result.release ?? [])
    return { status: 'accepted', transactionId: result.transaction_id as number }
  }
  if (intent.status === 'requires_action' && intent.client_secret) {
    return { status: 'requires_action', offerId, clientSecret: intent.client_secret }
  }
  await release([intent.id])
  await admin.from('offers').update({ counter_payment_intent_id: null }).eq('id', offerId)
  return { status: 'error', error: holdErrorMessage(intent) }
}

export async function declineCounter(offerId: number): Promise<Simple> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: 'Please sign in.' }
  const { data: pis, error } = await createAdminClient().rpc('decline_counter', { p_offer_id: offerId, p_buyer_id: user.id })
  if (error) return { ok: false, error: dbError(error) }
  await release(pis ?? [])
  return { ok: true }
}
