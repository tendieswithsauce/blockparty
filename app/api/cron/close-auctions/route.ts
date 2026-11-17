// app/api/cron/close-auctions/route.ts
// Called every minute by Supabase pg_cron (only when there's work). Closes
// ended auctions by holding the winner's card for their bid, moving on to the
// next-highest bidder if a card fails; releases Buy Now reservations whose
// 3D Secure check was abandoned; and cancels orders whose meetup deadline
// passed without a handoff (the buyer's hold is released, nobody is charged).
// Finally, emails any queued notifications (public.notifications).
// Protected by CRON_SECRET (same value as cron_secret in Supabase Vault).
import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import Stripe from 'stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe, stripeConfigured } from '@/lib/stripe/server'
import { MIN_PLATFORM_FEE_CENTS, PLATFORM_FEE_BPS } from '@/lib/fees'
import { NoSavedCardError, createHold, markAuthorized } from '@/lib/payments/holds'
import { sendNotificationEmails } from '@/lib/notifications/send-emails'
import { siteUrl } from '@/lib/site-url'

const MAX_AUCTIONS_PER_RUN = 10
// Bidders to try per auction in one run before leaving it for the next run.
const MAX_ATTEMPTS = 10

type Outcome =
  | { listingId: number; result: 'won'; transactionId: number; bidderTries: number }
  | { listingId: number; result: 'no_winner' | 'already_closed' }
  | { listingId: number; result: 'error'; message: string }

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const header = req.headers.get('authorization') ?? ''
  if (!secret) return false
  const a = Buffer.from(header)
  const b = Buffer.from(`Bearer ${secret}`)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: 'CRON_SECRET is not set' }, { status: 500 })
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!stripeConfigured()) return NextResponse.json({ error: 'Stripe is not configured' }, { status: 500 })

  const admin = createAdminClient()
  const stripe = getStripe()

  // 1. Buy Now reservations abandoned mid 3D Secure: put the items back up.
  const { data: stale } = await admin.rpc('release_stale_purchases')
  for (const s of stale ?? []) {
    if (s.payment_intent_id) await stripe.paymentIntents.cancel(s.payment_intent_id).catch(() => {})
  }

  // 2. Orders whose meetup deadline passed without a handoff: release the hold.
  const { data: expired } = await admin.rpc('expired_orders')
  for (const transactionId of expired ?? []) {
    const { data: paymentIntentId } = await admin.rpc('cancel_order', {
      p_transaction_id: transactionId,
      p_user_id: null,
      p_reason: 'no_meetup',
    })
    if (paymentIntentId) await stripe.paymentIntents.cancel(paymentIntentId).catch(() => {})
  }

  // 3. Auctions that have ended, plus any whose closing was interrupted.
  const [{ data: ended }, { data: interrupted }] = await Promise.all([
    admin
      .from('listings')
      .select('id')
      .eq('listing_type', 'auction')
      .eq('status', 'active')
      .lte('ends_at', new Date().toISOString())
      .order('ends_at')
      .limit(MAX_AUCTIONS_PER_RUN),
    admin
      .from('transactions')
      .select('listing_id, listings!inner(listing_type)')
      .eq('status', 'pending')
      .eq('listings.listing_type', 'auction')
      .limit(MAX_AUCTIONS_PER_RUN),
  ])
  const listingIds = [...new Set([...(ended ?? []).map((l) => l.id), ...(interrupted ?? []).map((t) => t.listing_id)])]

  const outcomes: Outcome[] = []
  for (const id of listingIds.slice(0, MAX_AUCTIONS_PER_RUN)) {
    outcomes.push(await closeAuction(id))
  }

  // 4. Emails for notifications, including the ones the steps above just created.
  const emails = await sendNotificationEmails(await siteUrl())

  return NextResponse.json({ released: stale?.length ?? 0, expired: expired?.length ?? 0, auctions: outcomes, emails })
}

async function closeAuction(listingId: number): Promise<Outcome> {
  const admin = createAdminClient()
  const stripe = getStripe()

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { data: txn, error } = await admin.rpc('close_auction', {
      p_listing_id: listingId,
      p_fee_bps: PLATFORM_FEE_BPS,
      p_min_fee_cents: MIN_PLATFORM_FEE_CENTS,
    })
    if (error) return { listingId, result: 'error', message: error.message }
    if (!txn?.id) return { listingId, result: 'no_winner' }
    if (txn.status !== 'pending') return { listingId, result: 'already_closed' }

    let intent: Stripe.PaymentIntent | null = null
    try {
      intent = txn.stripe_payment_intent_id
        ? await stripe.paymentIntents.retrieve(txn.stripe_payment_intent_id)
        : await createHold(txn, { offSession: true })
      if (intent.status === 'requires_capture') {
        await markAuthorized(txn.id)
        return { listingId, result: 'won', transactionId: txn.id, bidderTries: attempt }
      }
    } catch (err) {
      const cardProblem = err instanceof Stripe.errors.StripeCardError || err instanceof NoSavedCardError
      if (!cardProblem) {
        // Stripe or network trouble: leave the transaction pending and retry
        // on a later run rather than skipping a winner who did nothing wrong.
        console.error('close-auctions: hold failed', listingId, err)
        return { listingId, result: 'error', message: err instanceof Error ? err.message : 'unknown error' }
      }
      if (err instanceof Stripe.errors.StripeCardError) intent = err.payment_intent ?? null
    }

    // This bidder's card was declined or needs authentication they can't
    // give right now: release it and offer the item to the next bidder.
    if (intent && intent.status !== 'canceled') {
      await stripe.paymentIntents.cancel(intent.id).catch(() => {})
    }
    await admin.rpc('cancel_pending_purchase', { p_transaction_id: txn.id })
  }
  return { listingId, result: 'error', message: 'Too many failed cards; will retry' }
}
