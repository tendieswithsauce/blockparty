// app/profile/payment-actions.ts
// Server Actions for saving a buyer's card with a Stripe SetupIntent.
// The card itself never touches our server: the browser sends it straight to
// Stripe, and we only store the resulting customer / payment method IDs.
'use server'

import type Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe, stripeConfigured } from '@/lib/stripe/server'

export type SavedCard = {
  brand: string
  last4: string
  expMonth: number
  expYear: number
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

const NOT_CONFIGURED = 'Payments are not set up yet. Please try again later.'

async function currentUser() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims
  if (!claims?.sub) return null
  return { id: claims.sub as string, email: (claims.email as string | undefined) ?? undefined }
}

function cardSummary(pm: Stripe.PaymentMethod | null): SavedCard | null {
  if (!pm?.card) return null
  return {
    brand: pm.card.brand,
    last4: pm.card.last4,
    expMonth: pm.card.exp_month,
    expYear: pm.card.exp_year,
  }
}

/** Returns the stripe customer ID for the user, creating the customer if needed. */
async function ensureCustomer(user: { id: string; email?: string }) {
  const admin = createAdminClient()
  const { data: profile, error } = await admin
    .from('profiles')
    .select('stripe_customer_id, full_name, email')
    .eq('id', user.id)
    .single()
  if (error || !profile) throw new Error('Profile not found')

  if (profile.stripe_customer_id) return profile.stripe_customer_id

  const customer = await getStripe().customers.create(
    {
      email: profile.email ?? user.email,
      name: profile.full_name ?? undefined,
      metadata: { supabase_user_id: user.id },
    },
    // Two quick clicks within 24h reuse the same customer instead of making two.
    { idempotencyKey: `customer-${user.id}` },
  )

  // Only set it if nobody else did in the meantime.
  const { data: updated } = await admin
    .from('profiles')
    .update({ stripe_customer_id: customer.id })
    .eq('id', user.id)
    .is('stripe_customer_id', null)
    .select('stripe_customer_id')
    .maybeSingle()

  if (updated?.stripe_customer_id) return updated.stripe_customer_id

  const { data: again } = await admin
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single()
  return again?.stripe_customer_id ?? customer.id
}

/** The card currently on file, if any. */
export async function getSavedCard(): Promise<Result<SavedCard | null>> {
  const user = await currentUser()
  if (!user) return { ok: false, error: 'Please sign in again.' }
  if (!stripeConfigured()) return { ok: true, data: null }

  try {
    const { data: profile } = await createAdminClient()
      .from('profiles')
      .select('stripe_payment_method_id')
      .eq('id', user.id)
      .single()
    if (!profile?.stripe_payment_method_id) return { ok: true, data: null }

    const pm = await getStripe().paymentMethods.retrieve(profile.stripe_payment_method_id)
    return { ok: true, data: cardSummary(pm) }
  } catch (err) {
    console.error('getSavedCard failed', err)
    return { ok: false, error: 'Could not load your saved card.' }
  }
}

/** Starts saving a card: returns the SetupIntent client secret for the Payment Element. */
export async function createSetupIntent(): Promise<Result<{ clientSecret: string }>> {
  const user = await currentUser()
  if (!user) return { ok: false, error: 'Please sign in again.' }
  if (!stripeConfigured()) return { ok: false, error: NOT_CONFIGURED }

  try {
    const customer = await ensureCustomer(user)
    const intent = await getStripe().setupIntents.create({
      customer,
      // Which methods show is set in the Stripe Dashboard (Settings > Payment
      // methods). Escrow uses manual-capture PaymentIntents, so keep it to cards;
      // STRIPE_PAYMENT_METHOD_CONFIGURATION can point at a cards-only config.
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      ...(process.env.STRIPE_PAYMENT_METHOD_CONFIGURATION
        ? { payment_method_configuration: process.env.STRIPE_PAYMENT_METHOD_CONFIGURATION }
        : {}),
      // Lets us charge auction winners / Buy Now later without them present.
      usage: 'off_session',
      metadata: { supabase_user_id: user.id },
    })
    if (!intent.client_secret) throw new Error('SetupIntent has no client_secret')
    return { ok: true, data: { clientSecret: intent.client_secret } }
  } catch (err) {
    console.error('createSetupIntent failed', err)
    return { ok: false, error: 'Could not start saving your card. Please try again.' }
  }
}

/** Finishes saving a card after stripe.confirmSetup succeeds in the browser. */
export async function completeSetupIntent(setupIntentId: string): Promise<Result<SavedCard>> {
  const user = await currentUser()
  if (!user) return { ok: false, error: 'Please sign in again.' }
  if (!stripeConfigured()) return { ok: false, error: NOT_CONFIGURED }
  if (typeof setupIntentId !== 'string' || !setupIntentId.startsWith('seti_')) {
    return { ok: false, error: 'Invalid request.' }
  }

  try {
    const admin = createAdminClient()
    const { data: profile } = await admin
      .from('profiles')
      .select('stripe_customer_id, stripe_payment_method_id')
      .eq('id', user.id)
      .single()
    if (!profile?.stripe_customer_id) return { ok: false, error: 'Invalid request.' }

    const stripe = getStripe()
    const intent = await stripe.setupIntents.retrieve(setupIntentId, { expand: ['payment_method'] })

    // Never trust the browser: the intent must belong to this user's customer.
    const intentCustomer = typeof intent.customer === 'string' ? intent.customer : intent.customer?.id
    if (intentCustomer !== profile.stripe_customer_id) return { ok: false, error: 'Invalid request.' }
    if (intent.status !== 'succeeded') {
      return { ok: false, error: 'Your card was not confirmed. Please try again.' }
    }

    const pm = intent.payment_method as Stripe.PaymentMethod | null
    if (!pm) return { ok: false, error: 'No card was attached. Please try again.' }

    const card = cardSummary(pm)
    if (!card) {
      await stripe.paymentMethods.detach(pm.id).catch(() => {})
      return { ok: false, error: 'Only credit and debit cards are supported right now.' }
    }

    await stripe.customers.update(profile.stripe_customer_id, {
      invoice_settings: { default_payment_method: pm.id },
    })

    const { error } = await admin
      .from('profiles')
      .update({ stripe_payment_method_id: pm.id })
      .eq('id', user.id)
    if (error) throw error

    // Replacing a card: remove the old one from the customer.
    const old = profile.stripe_payment_method_id
    if (old && old !== pm.id) {
      await stripe.paymentMethods.detach(old).catch((err) => console.warn('detach old card failed', err))
    }

    return { ok: true, data: card }
  } catch (err) {
    console.error('completeSetupIntent failed', err)
    return { ok: false, error: 'Could not save your card. Please try again.' }
  }
}
