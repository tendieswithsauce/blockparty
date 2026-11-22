// app/api/stripe/webhook/route.ts
// Stripe tells us about things that happen to a payment after the fact:
//   charge.dispute.created / updated / closed: a chargeback (or a bank's
//     inquiry). The order records it, an unpaid payout is held, admins are told.
//   radar.early_fraud_warning.created: the card's bank says the payment is
//     likely fraud, usually days before a chargeback. Not handed over yet:
//     the order is cancelled and the hold released. Otherwise the payout is held.
//   charge.refunded: a refund (ours, or one made in Stripe's dashboard).
// The database functions do the work (stripe_record_dispute,
// stripe_record_fraud_warning, record_refund; migration 20261122000000) and
// are safe to repeat. Stripe signs each request with STRIPE_WEBHOOK_SECRET;
// anything else is refused. Reachable without the site password (proxy.ts).
import { NextResponse, type NextRequest } from 'next/server'
import type Stripe from 'stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe, stripeConfigured } from '@/lib/stripe/server'

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null
  return typeof value === 'string' ? value : value.id
}

/** Handles one event; returns the order it was about (null if none of ours). */
async function handle(event: Stripe.Event): Promise<number | null> {
  const admin = createAdminClient()
  const stripe = getStripe()

  switch (event.type) {
    case 'charge.dispute.created':
    case 'charge.dispute.updated':
    case 'charge.dispute.closed': {
      const dispute = event.data.object
      let paymentIntent = idOf(dispute.payment_intent)
      if (!paymentIntent) {
        const charge = await stripe.charges.retrieve(idOf(dispute.charge)!)
        paymentIntent = idOf(charge.payment_intent)
      }
      if (!paymentIntent) return null
      const { data, error } = await admin.rpc('stripe_record_dispute', {
        p_payment_intent: paymentIntent,
        p_dispute_id: dispute.id,
        p_status: dispute.status,
        p_reason: dispute.reason ?? null,
        p_amount_cents: dispute.amount,
      })
      if (error) throw error
      return data ?? null
    }

    case 'radar.early_fraud_warning.created': {
      const warning = event.data.object
      let paymentIntent = idOf(warning.payment_intent)
      if (!paymentIntent) {
        const charge = await stripe.charges.retrieve(idOf(warning.charge)!)
        paymentIntent = idOf(charge.payment_intent)
      }
      if (!paymentIntent) return null
      const { data, error } = await admin.rpc('stripe_record_fraud_warning', {
        p_payment_intent: paymentIntent,
        p_fraud_type: warning.fraud_type ?? null,
      })
      if (error) throw error
      const row = data?.[0]
      if (row?.canceled) {
        // The order was cancelled before the handoff: release the card hold.
        await stripe.paymentIntents
          .cancel(paymentIntent, { cancellation_reason: 'fraudulent' })
          .catch((err) => console.error('webhook: releasing flagged hold failed', paymentIntent, err))
      }
      return row?.transaction_id ?? null
    }

    case 'charge.refunded': {
      const charge = event.data.object
      const paymentIntent = idOf(charge.payment_intent)
      if (!paymentIntent) return null
      const { data, error } = await admin.rpc('record_refund', {
        p_payment_intent: paymentIntent,
        p_refunded_cents: charge.amount_refunded,
      })
      if (error) throw error
      return data ?? null
    }

    default:
      return null
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret || !stripeConfigured()) {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  }
  const signature = req.headers.get('stripe-signature')
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  // The signature covers the exact bytes Stripe sent, so read the raw body.
  const body = await req.text()
  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(body, signature, secret)
  } catch {
    return NextResponse.json({ error: 'Bad signature' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: seen } = await admin.from('stripe_events').select('id').eq('id', event.id).maybeSingle()
  if (seen) return NextResponse.json({ received: true, duplicate: true })

  // Stripe's dashboard lists these as "v1.charge.dispute.created" and so on;
  // the payload normally carries the plain name, but accept either.
  const normalized = { ...event, type: event.type.replace(/^v1\./, '') } as Stripe.Event

  let transactionId: number | null
  try {
    transactionId = await handle(normalized)
  } catch (err) {
    // A 500 makes Stripe try again later (for up to 3 days).
    const message = err instanceof Error ? err.message : JSON.stringify(err)
    console.error(
      JSON.stringify({
        tag: 'blockparty-error',
        source: 'stripe-webhook',
        message: `${event.type} ${event.id}: ${message}`.slice(0, 500),
      }),
    )
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }

  await admin.from('stripe_events').upsert(
    { id: event.id, type: event.type, transaction_id: transactionId },
    { onConflict: 'id', ignoreDuplicates: true },
  )
  return NextResponse.json({ received: true })
}
