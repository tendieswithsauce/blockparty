// lib/stripe/connect.ts
// Stripe Connect (Express-style) accounts for sellers: Blockparty holds the
// buyer's payment, then transfers the seller's share to this account once the
// item is picked up. Server-only.
import type Stripe from 'stripe'
import { getStripe } from '@/lib/stripe/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { CurrentUser } from '@/lib/auth/current-user'

export type PayoutStatus = {
  accountId: string | null
  /** Seller finished onboarding and Stripe can send them money. */
  ready: boolean
  /** Started onboarding but Stripe still needs details. */
  needsDetails: boolean
}

/** A seller is ready once Stripe allows transfers to them and payouts to their bank. */
export function accountReady(account: Stripe.Account) {
  return account.payouts_enabled === true && account.capabilities?.transfers === 'active'
}

/** Returns the seller's connected account ID, creating the account if needed. */
export async function ensureConnectedAccount(user: CurrentUser): Promise<string> {
  const admin = createAdminClient()
  const { data: profile, error } = await admin
    .from('profiles')
    .select('stripe_account_id, email, full_name')
    .eq('id', user.id)
    .single()
  if (error || !profile) throw new Error('Profile not found')
  if (profile.stripe_account_id) return profile.stripe_account_id

  const account = await getStripe().accounts.create(
    {
      country: 'CA',
      email: profile.email ?? user.email,
      // Express: Stripe hosts onboarding and the seller's payout dashboard;
      // the platform (Blockparty) pays Stripe fees and covers losses.
      controller: {
        stripe_dashboard: { type: 'express' },
        fees: { payer: 'application' },
        losses: { payments: 'application' },
        requirement_collection: 'stripe',
      },
      capabilities: { transfers: { requested: true } },
      business_profile: {
        product_description: 'Selling personal items on Blockparty, a local Edmonton marketplace.',
      },
      metadata: { supabase_user_id: user.id },
    },
    { idempotencyKey: `connect-account-${user.id}` },
  )

  const { data: updated } = await admin
    .from('profiles')
    .update({ stripe_account_id: account.id })
    .eq('id', user.id)
    .is('stripe_account_id', null)
    .select('stripe_account_id')
    .maybeSingle()
  if (updated?.stripe_account_id) return updated.stripe_account_id

  const { data: again } = await admin.from('profiles').select('stripe_account_id').eq('id', user.id).single()
  return again?.stripe_account_id ?? account.id
}

/** Stripe-hosted onboarding (or update) link for the seller. */
export async function createOnboardingLink(accountId: string, origin: string) {
  const link = await getStripe().accountLinks.create({
    account: accountId,
    type: 'account_onboarding',
    refresh_url: `${origin}/payouts/refresh`,
    return_url: `${origin}/payouts/return`,
    collection_options: { fields: 'eventually_due' },
  })
  return link.url
}

/** Reads the account from Stripe and stores its status on the profile. */
export async function syncPayoutStatus(userId: string): Promise<PayoutStatus> {
  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('stripe_account_id, stripe_payouts_enabled, stripe_charges_enabled')
    .eq('id', userId)
    .single()
  const accountId = profile?.stripe_account_id ?? null
  if (!accountId) return { accountId: null, ready: false, needsDetails: false }

  const account = await getStripe().accounts.retrieve(accountId)
  const ready = accountReady(account)
  const charges = account.charges_enabled === true

  if (profile?.stripe_payouts_enabled !== ready || profile?.stripe_charges_enabled !== charges) {
    await admin
      .from('profiles')
      .update({ stripe_payouts_enabled: ready, stripe_charges_enabled: charges })
      .eq('id', userId)
  }

  return { accountId, ready, needsDetails: !ready }
}
