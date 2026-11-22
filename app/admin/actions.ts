// app/admin/actions.ts
// Admin steps that also touch storage, sign-in or Stripe. A database function
// checks is_admin() as the signed-in user first; only then does the service
// role (or Stripe) do the rest: removing photos (members can only delete
// files in their own folder), banning sign-in, refunds and payout reversals.
'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe } from '@/lib/stripe/server'

type Result = { ok: true; photosRemoved: number } | { ok: false; error: string }

// Same shape as profiles/listing photo paths: "<user uuid>/<file name>".
const PHOTO_PATH = /^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,120}$/

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Supabase has no "forever"; 100 years will do.
const BAN_FOREVER = '876000h'

type SimpleResult = { ok: true; warning?: string } | { ok: false; error: string }

/**
 * Suspend a member: the database records it (admin-checked), which hides
 * their listings and blocks listing, bidding and buying straight away; then
 * their sign-in is banned, so they can't start a new session.
 */
export async function suspendUser(userId: string, reason: string): Promise<SimpleResult> {
  if (!UUID.test(userId)) return { ok: false, error: 'Unknown member.' }
  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_suspend_user', { p_user_id: userId, p_reason: reason })
  // Already suspended: carry on and re-apply the sign-in block (a retry after a failed ban).
  const retry = error?.code === 'P0001' && error.message.includes('already suspended')
  if (error && !retry) return { ok: false, error: error.code === 'P0001' ? `${error.message}.` : 'Could not suspend them.' }

  const { error: banError } = await createAdminClient().auth.admin.updateUserById(userId, { ban_duration: BAN_FOREVER })
  if (banError) {
    console.error('suspendUser: ban failed', userId, banError.message)
    return {
      ok: true,
      warning: "Suspended, but blocking their sign-in failed. They still can't list, bid or buy. Try suspending again later.",
    }
  }
  return { ok: true }
}

export async function unsuspendUser(userId: string): Promise<SimpleResult> {
  if (!UUID.test(userId)) return { ok: false, error: 'Unknown member.' }
  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_unsuspend_user', { p_user_id: userId })
  if (error) return { ok: false, error: error.code === 'P0001' ? `${error.message}.` : 'Could not unsuspend them.' }

  const { error: banError } = await createAdminClient().auth.admin.updateUserById(userId, { ban_duration: 'none' })
  if (banError) {
    console.error('unsuspendUser: unban failed', userId, banError.message)
    return { ok: true, warning: "Unsuspended, but lifting the sign-in block failed. Try again in a moment." }
  }
  return { ok: true }
}

export async function deleteListing(listingId: number, reason: string): Promise<Result> {
  if (!Number.isSafeInteger(listingId) || listingId <= 0) return { ok: false, error: 'Unknown listing.' }
  const supabase = await createClient()
  const { data: orphaned, error } = await supabase.rpc('admin_delete_listing', {
    p_listing_id: listingId,
    p_reason: reason,
  })
  if (error) return { ok: false, error: error.code === 'P0001' ? `${error.message}.` : 'Could not delete it.' }

  const paths = (orphaned ?? []).filter((p) => PHOTO_PATH.test(p))
  if (paths.length > 0) {
    const { error: storageError } = await createAdminClient().storage.from('listing-photos').remove(paths)
    // The listing is gone either way; leftover files are only clutter.
    if (storageError) console.error('deleteListing: removing photos failed', listingId, storageError.message)
  }
  return { ok: true, photosRemoved: paths.length }
}

// ── Payments: refunds and taking payouts back ───────────────────────────────

type MoneyResult = { ok: true; message: string } | { ok: false; error: string }

/** The order as an admin sees it; null if not found or not an admin. */
async function adminOrder(transactionId: number) {
  if (!Number.isSafeInteger(transactionId) || transactionId <= 0) return null
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('admin_payment_orders', { p_transaction_id: transactionId })
  if (error) return null
  return data?.[0] ?? null
}

function cleanNote(note: string) {
  return note.trim().replace(/\s+/g, ' ').slice(0, 500)
}

/**
 * Refund the buyer part or all of a completed order. Before the payout, the
 * seller's payout shrinks by the refund (none if it's all refunded). After
 * it, takeBackFromSeller also reverses that much of the seller's payout.
 * Stripe keeps its processing fee either way.
 */
export async function refundOrder(
  transactionId: number,
  amountCents: number,
  note: string,
  takeBackFromSeller: boolean,
): Promise<MoneyResult> {
  const order = await adminOrder(transactionId)
  if (!order) return { ok: false, error: 'Order not found.' }
  if (order.status !== 'completed') return { ok: false, error: 'Only completed orders can be refunded. Cancel open orders instead.' }
  if (!order.stripe_payment_intent_id) return { ok: false, error: 'This order has no card payment.' }
  if (order.dispute_status && !['won', 'lost', 'warning_closed'].includes(order.dispute_status)) {
    return { ok: false, error: "This payment has an open chargeback, so it can't be refunded. Respond to it in Stripe instead." }
  }
  const refundable = order.amount_cents - order.refunded_cents
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > refundable) {
    return { ok: false, error: `Enter an amount up to ${(refundable / 100).toFixed(2)}.` }
  }
  const reason = cleanNote(note)
  if (reason.length < 5) return { ok: false, error: 'Add a short reason (the seller sees it).' }

  const stripe = getStripe()
  const admin = createAdminClient()
  try {
    await stripe.refunds.create(
      {
        payment_intent: order.stripe_payment_intent_id,
        amount: amountCents,
        reason: 'requested_by_customer',
        metadata: { transaction_id: String(order.id) },
      },
      // Same order, same total so far, same amount: one refund even if retried.
      { idempotencyKey: `refund-${order.id}-${order.refunded_cents}-${amountCents}` },
    )
  } catch (err) {
    console.error('refundOrder: refund failed', order.id, err)
    return { ok: false, error: err instanceof Error ? err.message : 'Stripe refused the refund.' }
  }

  // Record Stripe's running total, so this and the webhook agree.
  const intent = await stripe.paymentIntents.retrieve(order.stripe_payment_intent_id, { expand: ['latest_charge'] })
  const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null
  const total = charge?.amount_refunded ?? order.refunded_cents + amountCents
  const { error } = await admin.rpc('record_refund', {
    p_payment_intent: order.stripe_payment_intent_id,
    p_refunded_cents: total,
    p_note: reason,
  })
  if (error) console.error('refundOrder: record_refund failed', order.id, error)

  let message = `Refunded ${(amountCents / 100).toFixed(2)} to the buyer.`
  if (order.paid_out_at && takeBackFromSeller) {
    const taken = await reverse(order, amountCents, reason)
    message += taken.ok ? ` ${taken.message}` : ` But taking it back from the seller failed: ${taken.error}`
  } else if (!order.paid_out_at) {
    message += ' The seller’s payout was reduced to match.'
  }
  return { ok: true, message }
}

/** Take back part or all of a payout that was already sent (e.g. after a lost chargeback). */
export async function reversePayout(transactionId: number, amountCents: number, note: string): Promise<MoneyResult> {
  const order = await adminOrder(transactionId)
  if (!order) return { ok: false, error: 'Order not found.' }
  const reason = cleanNote(note)
  if (reason.length < 5) return { ok: false, error: 'Add a short reason (the seller sees it).' }
  return reverse(order, amountCents, reason)
}

async function reverse(
  order: { id: number; stripe_transfer_id: string | null; payout_cents: number | null; transfer_reversed_cents: number },
  amountCents: number,
  reason: string,
): Promise<MoneyResult> {
  if (!order.stripe_transfer_id) return { ok: false, error: "The seller hasn't been paid for this order." }
  const left = (order.payout_cents ?? 0) - order.transfer_reversed_cents
  const amount = Math.min(amountCents, left)
  if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, error: 'There’s nothing left of this payout to take back.' }

  const stripe = getStripe()
  try {
    await stripe.transfers.createReversal(
      order.stripe_transfer_id,
      { amount, metadata: { transaction_id: String(order.id) } },
      { idempotencyKey: `reversal-${order.id}-${order.transfer_reversed_cents}-${amount}` },
    )
  } catch (err) {
    console.error('reversePayout failed', order.id, err)
    return { ok: false, error: err instanceof Error ? err.message : 'Stripe refused.' }
  }
  const transfer = await stripe.transfers.retrieve(order.stripe_transfer_id)
  const { error } = await createAdminClient().rpc('record_transfer_reversal', {
    p_transaction_id: order.id,
    p_reversed_cents: transfer.amount_reversed,
    p_note: reason,
  })
  if (error) console.error('reversePayout: record failed', order.id, error)
  return { ok: true, message: `Took ${(amount / 100).toFixed(2)} back from the seller.` }
}
