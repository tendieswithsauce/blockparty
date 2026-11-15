// app/orders/actions.ts
// The handoff and cancelling. Scheduling (spot and times) happens through
// database functions the buyer and seller call directly; these steps also
// move money, so they run on the server.
'use server'

import { getCurrentUser } from '@/lib/auth/current-user'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe, stripeConfigured } from '@/lib/stripe/server'
import { CANCEL_REASONS } from '@/lib/orders'

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

/**
 * The seller enters the buyer's handoff code at the meetup. On a match the
 * buyer's card is charged and the seller is paid (price minus the fee).
 */
export async function completeHandoff(
  transactionId: number,
  code: string,
): Promise<Result<{ payoutCents: number; payoutPending: boolean }>> {
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

  // 2. Pay the seller. The buyer has paid either way, so if this fails the
  //    sale still completes and the payout is retried (see payoutPending).
  let transferId: string | null = null
  const { data: seller } = await admin.from('profiles').select('stripe_account_id').eq('id', txn.seller_id).single()
  if (seller?.stripe_account_id) {
    try {
      const transfer = await stripe.transfers.create(
        {
          amount: payoutCents,
          currency: 'cad',
          destination: seller.stripe_account_id,
          transfer_group: `txn_${txn.id}`,
          ...(chargeId ? { source_transaction: chargeId } : {}),
          description: `Blockparty order #${txn.id}`,
          metadata: { transaction_id: String(txn.id), listing_id: String(txn.listing_id) },
        },
        { idempotencyKey: `transfer-${txn.id}` },
      )
      transferId = transfer.id
    } catch (err) {
      console.error('completeHandoff: transfer failed', txn.id, err)
    }
  }

  await admin.rpc('complete_order', { p_transaction_id: txn.id, p_transfer_id: transferId })
  return { ok: true, payoutCents, payoutPending: transferId === null }
}

/** Either party cancels before the handoff. The buyer's hold is released. */
export async function cancelOrder(transactionId: number, reason: string): Promise<Result> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: 'Please sign in.' }
  if (!(reason in CANCEL_REASONS.buyer) && !(reason in CANCEL_REASONS.seller)) {
    return { ok: false, error: 'Choose a reason.' }
  }

  const { data: paymentIntentId, error } = await createAdminClient().rpc('cancel_order', {
    p_transaction_id: transactionId,
    p_user_id: user.id,
    p_reason: reason,
  })
  if (error) {
    return { ok: false, error: error.code === 'P0001' ? `${error.message}.` : 'Something went wrong. Please try again.' }
  }
  if (paymentIntentId && stripeConfigured()) {
    await getStripe()
      .paymentIntents.cancel(paymentIntentId)
      .catch((err) => console.error('cancelOrder: releasing hold failed', paymentIntentId, err))
  }
  return { ok: true }
}
