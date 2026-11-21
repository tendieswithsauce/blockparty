// app/api/cron/close-auctions/route.ts
// Called every minute by Supabase pg_cron (only when there's work). Closes
// ended auctions by holding the winner's card for their bid, moving on to the
// next-highest bidder if a card fails; releases Buy Now reservations whose
// 3D Secure check was abandoned; and cancels orders whose meetup deadline
// passed without a handoff (the buyer's hold is released, nobody is charged).
// Also runs the automatic check on listings that missed it, and finally
// emails any queued notifications (public.notifications) and emergency
// contact alerts (public.safety_alerts). Also retries seller payouts that
// failed at the handoff.
// Protected by CRON_SECRET (same value as cron_secret in Supabase Vault).
import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe, stripeConfigured } from '@/lib/stripe/server'
import { closeAuction, type CloseAuctionOutcome } from '@/lib/payments/close-auction'
import { sendNotificationEmails } from '@/lib/notifications/send-emails'
import { sendSafetyAlerts } from '@/lib/notifications/send-safety-alerts'
import { checkPendingListings } from '@/lib/moderation/check-listing'
import { retryPendingPayouts } from '@/lib/payments/payouts'
import { siteUrl } from '@/lib/site-url'

const MAX_AUCTIONS_PER_RUN = 10

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

  const outcomes: CloseAuctionOutcome[] = []
  for (const id of listingIds.slice(0, MAX_AUCTIONS_PER_RUN)) {
    outcomes.push(await closeAuction(id))
  }

  // 4. Seller payouts that failed at the handoff.
  const payouts = await retryPendingPayouts()

  // 5. Listings still waiting for their automatic check.
  const moderation = await checkPendingListings()

  // 6. Emails for notifications, including the ones the steps above just created.
  const emails = await sendNotificationEmails(await siteUrl())

  // 7. Emergency contact emails (meetup agreed / done / cancelled).
  const safety = await sendSafetyAlerts()

  return NextResponse.json({ released: stale?.length ?? 0, expired: expired?.length ?? 0, auctions: outcomes, payouts, moderation, emails, safety })
}
