// lib/payments/holds.ts
// Card holds: a PaymentIntent with manual capture on the buyer's saved card.
// Used by Buy Now (buyer present) and by auction closing (buyer not present).
// Server-only.
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
 * Places the hold and records the PaymentIntent on the transaction.
 * offSession: the buyer isn't on the page (auction win), so the bank can't
 * ask them for 3D Secure; Stripe fails with authentication_required instead.
 * Throws Stripe errors (e.g. StripeCardError for declines).
 */
export async function createHold(txn: HoldTxn, { offSession }: { offSession: boolean }): Promise<Stripe.PaymentIntent> {
  const admin = createAdminClient()
  const [{ data: profile }, { data: listing }] = await Promise.all([
    admin.from('profiles').select('stripe_customer_id, stripe_payment_method_id').eq('id', txn.buyer_id).single(),
    admin.from('listings').select('title').eq('id', txn.listing_id).single(),
  ])
  if (!profile?.stripe_customer_id || !profile.stripe_payment_method_id) throw new NoSavedCardError()

  const intent = await getStripe().paymentIntents.create(
    {
      amount: txn.amount_cents,
      currency: 'cad',
      customer: profile.stripe_customer_id,
      payment_method: profile.stripe_payment_method_id,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      capture_method: 'manual',
      confirm: true,
      ...(offSession ? { off_session: true } : {}),
      description: `Blockparty order #${txn.id}: ${listing?.title ?? 'item'}`,
      transfer_group: `txn_${txn.id}`,
      metadata: {
        transaction_id: String(txn.id),
        listing_id: String(txn.listing_id),
        buyer_id: txn.buyer_id,
        seller_id: txn.seller_id,
      },
    },
    // One hold per transaction, even if the request is retried.
    { idempotencyKey: `purchase-${txn.id}` },
  )
  await admin.from('transactions').update({ stripe_payment_intent_id: intent.id }).eq('id', txn.id)
  return intent
}

/** The hold went through: mark the transaction authorized. */
export async function markAuthorized(transactionId: number) {
  await createAdminClient()
    .from('transactions')
    .update({ status: 'authorized', authorized_at: new Date().toISOString() })
    .eq('id', transactionId)
    .eq('status', 'pending')
}
