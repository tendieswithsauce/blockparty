// lib/payments/payouts.ts
// Paying the seller: a Stripe transfer of the price minus the fee to their
// connected account, after the buyer's hold is captured at the handoff.
// Used by completeHandoff, and by the cron route to retry payouts that failed
// (Stripe or network trouble). The idempotency key makes a retry safe: Stripe
// returns the original transfer instead of paying twice. Server-only.
import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe } from '@/lib/stripe/server'

type PayoutTxn = {
  id: number
  listing_id: number
  seller_id: string
  amount_cents: number
  platform_fee_cents: number
  stripe_payment_intent_id: string | null
}

/** Sends the payout; returns the transfer id, or null if it couldn't be sent. */
export async function payoutSeller(txn: PayoutTxn, chargeId?: string | null): Promise<string | null> {
  const admin = createAdminClient()
  const stripe = getStripe()
  const { data: seller } = await admin.from('profiles').select('stripe_account_id').eq('id', txn.seller_id).single()
  if (!seller?.stripe_account_id) return null

  try {
    let source = chargeId ?? null
    if (!source && txn.stripe_payment_intent_id) {
      const intent = await stripe.paymentIntents.retrieve(txn.stripe_payment_intent_id)
      source = typeof intent.latest_charge === 'string' ? intent.latest_charge : (intent.latest_charge?.id ?? null)
    }
    const transfer = await stripe.transfers.create(
      {
        amount: txn.amount_cents - txn.platform_fee_cents,
        currency: 'cad',
        destination: seller.stripe_account_id,
        transfer_group: `txn_${txn.id}`,
        ...(source ? { source_transaction: source } : {}),
        description: `Blockparty order #${txn.id}`,
        metadata: { transaction_id: String(txn.id), listing_id: String(txn.listing_id) },
      },
      { idempotencyKey: `transfer-${txn.id}` },
    )
    return transfer.id
  } catch (err) {
    console.error('payout failed', txn.id, err)
    return null
  }
}

const MAX_PAYOUT_ATTEMPTS = 5

/**
 * Completed orders whose payout didn't go through: try again (up to 5 times,
 * then it's left for an admin). Skips orders completed in the last 2 minutes,
 * which the handoff itself may still be paying.
 */
export async function retryPendingPayouts(limit = 10) {
  const admin = createAdminClient()
  const { data } = await admin
    .from('transactions')
    .select('id, listing_id, seller_id, amount_cents, platform_fee_cents, stripe_payment_intent_id, payout_attempts')
    .eq('status', 'completed')
    .is('stripe_transfer_id', null)
    .not('stripe_payment_intent_id', 'is', null)
    .lt('payout_attempts', MAX_PAYOUT_ATTEMPTS)
    .lt('picked_up_at', new Date(Date.now() - 2 * 60_000).toISOString())
    .order('picked_up_at')
    .limit(limit)

  let paid = 0
  let failed = 0
  for (const txn of data ?? []) {
    const transferId = await payoutSeller(txn)
    if (transferId) {
      paid++
      await admin.from('transactions').update({ stripe_transfer_id: transferId }).eq('id', txn.id).is('stripe_transfer_id', null)
    } else {
      failed++
      await admin.from('transactions').update({ payout_attempts: txn.payout_attempts + 1 }).eq('id', txn.id)
    }
  }
  return { paid, failed }
}
