// lib/payments/holds.ts
// Card holds: a PaymentIntent with manual capture on the buyer's saved card.
// Every hold is placed with the buyer on the page (Buy Now, confirming an
// auction win, making or accepting an offer), so 3D Secure is always asked
// for. Server-only.
import 'server-only'
import type Stripe from 'stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe } from '@/lib/stripe/server'

export type HoldTxn = {
  id: number
  listing_id: number
  buyer_id: string
  seller_id: string
  amount_cents: number
}

export class NoSavedCardError extends Error {
  constructor() {
    super('Add a payment method before buying.')
  }
}

/**
 * Places a hold on the buyer's saved card. We always ask the bank for 3D
 * Secure: most Canadian banks approve it silently and only sometimes show
 * the buyer a check, and once it's done a "that wasn't me" chargeback is
 * the bank's loss, not ours. Throws Stripe errors (StripeCardError for
 * declines) and NoSavedCardError.
 */
export async function placeCardHold({
  buyerId,
  amountCents,
  description,
  metadata,
  transferGroup,
  idempotencyKey,
}: {
  buyerId: string
  amountCents: number
  description: string
  metadata: Record<string, string>
  transferGroup?: string
  idempotencyKey: string
}): Promise<Stripe.PaymentIntent> {
  const { data: profile } = await createAdminClient()
    .from('profiles')
    .select('stripe_customer_id, stripe_payment_method_id')
    .eq('id', buyerId)
    .single()
  if (!profile?.stripe_customer_id || !profile.stripe_payment_method_id) throw new NoSavedCardError()

  return getStripe().paymentIntents.create(
    {
      amount: amountCents,
      currency: 'cad',
      customer: profile.stripe_customer_id,
      payment_method: profile.stripe_payment_method_id,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      capture_method: 'manual',
      confirm: true,
      payment_method_options: { card: { request_three_d_secure: 'any' as const } },
      description,
      ...(transferGroup ? { transfer_group: transferGroup } : {}),
      metadata,
    },
    { idempotencyKey },
  )
}

/**
 * Places the hold for an order and records the PaymentIntent on it.
 * idempotencyKey defaults to one hold per order (Buy Now); an auction win
 * can be retried with another card, so it passes its own.
 */
export async function createHold(txn: HoldTxn, { idempotencyKey }: { idempotencyKey?: string } = {}) {
  const admin = createAdminClient()
  const { data: listing } = await admin.from('listings').select('title').eq('id', txn.listing_id).single()
  const intent = await placeCardHold({
    buyerId: txn.buyer_id,
    amountCents: txn.amount_cents,
    description: `Blockparty order #${txn.id}: ${listing?.title ?? 'item'}`,
    transferGroup: `txn_${txn.id}`,
    metadata: {
      transaction_id: String(txn.id),
      listing_id: String(txn.listing_id),
      buyer_id: txn.buyer_id,
      seller_id: txn.seller_id,
    },
    idempotencyKey: idempotencyKey ?? `purchase-${txn.id}`,
  })
  await admin.from('transactions').update({ stripe_payment_intent_id: intent.id }).eq('id', txn.id)
  return intent
}

/** The hold went through: mark the transaction authorized. False if it was no longer pending. */
export async function markAuthorized(transactionId: number) {
  const { data } = await createAdminClient()
    .from('transactions')
    .update({ status: 'authorized', authorized_at: new Date().toISOString() })
    .eq('id', transactionId)
    .eq('status', 'pending')
    .select('id')
  return (data?.length ?? 0) > 0
}
