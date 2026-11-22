// lib/payments/payouts.ts
// Paying the seller: a Stripe transfer of their share (the price minus the
// fee, minus any refund given before the payout) to their connected account,
// once the payout is due. New sellers are paid some days after the handoff
// (seller_payout_delay in the database); others straight away. Payouts on
// hold (a chargeback, a fraud warning, a full refund, an admin) wait.
// Used by completeHandoff, and by the cron route for payouts that come due
// later or failed (Stripe or network trouble). The idempotency key makes a
// retry safe: Stripe returns the original transfer instead of paying twice.
// Server-only.
import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe } from '@/lib/stripe/server'

type PayoutTxn = {
  id: number
  listing_id: number
  seller_id: string
  payout_cents: number
  stripe_payment_intent_id: string | null
}

/** Sends the payout and records it; returns the transfer id, or null if it couldn't be sent. */
export async function payoutSeller(txn: PayoutTxn, chargeId?: string | null): Promise<string | null> {
  const admin = createAdminClient()
  const stripe = getStripe()
  const { data: seller } = await admin.from('profiles').select('stripe_account_id').eq('id', txn.seller_id).single()
  if (!seller?.stripe_account_id || txn.payout_cents <= 0) return null

  let transferId: string
  try {
    let source = chargeId ?? null
    if (!source && txn.stripe_payment_intent_id) {
      const intent = await stripe.paymentIntents.retrieve(txn.stripe_payment_intent_id)
      source = typeof intent.latest_charge === 'string' ? intent.latest_charge : (intent.latest_charge?.id ?? null)
    }
    const transfer = await stripe.transfers.create(
      {
        amount: txn.payout_cents,
        currency: 'cad',
        destination: seller.stripe_account_id,
        transfer_group: `txn_${txn.id}`,
        ...(source ? { source_transaction: source } : {}),
        description: `Blockparty order #${txn.id}`,
        metadata: { transaction_id: String(txn.id), listing_id: String(txn.listing_id) },
      },
      // The amount is in the key: a payout that shrank after a refund is a
      // different request, not a conflicting retry.
      { idempotencyKey: `transfer-${txn.id}-${txn.payout_cents}` },
    )
    transferId = transfer.id
  } catch (err) {
    console.error('payout failed', txn.id, err)
    return null
  }

  const { error } = await admin.rpc('record_payout', {
    p_transaction_id: txn.id,
    p_transfer_id: transferId,
    p_payout_cents: txn.payout_cents,
  })
  // The money has gone; a failed write is retried by the cron and Stripe
  // returns the same transfer (same idempotency key).
  if (error) console.error('record_payout failed', txn.id, transferId, error)
  return transferId
}

/**
 * Payouts that are due: delayed ones whose day has come, and ones that
 * failed before (up to 5 tries, then they're left for an admin).
 */
export async function retryPendingPayouts(limit = 10) {
  const admin = createAdminClient()
  const { data } = await admin.rpc('payouts_due', { p_limit: limit })

  let paid = 0
  let failed = 0
  for (const txn of data ?? []) {
    const transferId = await payoutSeller(txn)
    if (transferId) {
      paid++
    } else {
      failed++
      await admin.from('transactions').update({ payout_attempts: txn.payout_attempts + 1 }).eq('id', txn.id)
    }
  }
  return { paid, failed }
}
