// lib/stripe/connect.ts
// Stripe connected accounts for sellers (Accounts v2, "recipient" configuration).
// Blockparty charges the buyer and holds the money, then transfers the
// seller's share to this account once the item is picked up (separate charges
// and transfers). Blockparty is the fees and losses collector, which needs the
// loss-liability acknowledgement in Stripe > Settings > Connect > Platform profile.
// Server-only.
import 'server-only'
import type Stripe from 'stripe'
import { getStripe } from '@/lib/stripe/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { CurrentUser } from '@/lib/auth/current-user'

type V2Account = Stripe.V2.Core.Account

export type PayoutStatus = {
  accountId: string | null
  /** Seller finished onboarding: Stripe accepts transfers to them and pays out to their bank. */
  ready: boolean
  /** Stripe is waiting on the seller for details (finish onboarding). */
  needsDetails: boolean
  /**
   * The seller has given everything; Stripe is still checking it. This takes
   * a few seconds to a couple of minutes after onboarding, so don't send
   * them back to the form.
   */
  verifying: boolean
}

function recipientBalance(account: V2Account) {
  return account.configuration?.recipient?.capabilities?.stripe_balance
}

/** A seller is ready once Stripe allows transfers to them and payouts to their bank. */
export function accountReady(account: V2Account) {
  const balance = recipientBalance(account)
  return balance?.stripe_transfers?.status === 'active' && balance?.payouts?.status === 'active'
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

  const account = await getStripe().v2.core.accounts.create(
    {
      contact_email: profile.email ?? user.email,
      display_name: profile.full_name ?? undefined,
      // Express: Stripe hosts onboarding and the seller's payout dashboard.
      dashboard: 'express',
      identity: { country: 'ca', entity_type: 'individual' },
      defaults: {
        currency: 'cad',
        responsibilities: { fees_collector: 'application', losses_collector: 'application' },
        // Prefilled so sellers aren't asked for a website or product description
        // in onboarding: they sell personal items through Blockparty.
        profile: {
          business_url: 'https://blockpartymarketplace.com',
          product_description:
            'Individual selling personal, second-hand items to neighbours through Blockparty, a local marketplace in Canada. Buyers pay Blockparty and the seller is paid when the buyer accepts the item at an in-person meetup. Items are $1,000 or less.',
        },
      },
      configuration: {
        recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
      },
      metadata: { supabase_user_id: user.id },
    },
    // Guards against double clicks only: Stripe replays a key's first response
    // (errors included) for 24h, so a fixed key would make a failure stick.
    { idempotencyKey: `connect-account-${user.id}-${Math.floor(Date.now() / 60_000)}` },
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

/** Stripe-hosted onboarding link for the seller. */
export async function createOnboardingLink(accountId: string, origin: string) {
  const link = await getStripe().v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: 'account_onboarding',
      account_onboarding: {
        refresh_url: `${origin}/payouts/refresh`,
        return_url: `${origin}/payouts/return`,
        collection_options: { fields: 'eventually_due' },
      },
    },
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
  if (!accountId) return { accountId: null, ready: false, needsDetails: false, verifying: false }

  const account = await getStripe().v2.core.accounts.retrieve(accountId, {
    include: ['configuration.recipient', 'requirements'],
  })
  const ready = accountReady(account)
  // Sellers only receive transfers; card charges happen on Blockparty's account.
  const transfers = recipientBalance(account)?.stripe_transfers?.status === 'active'

  if (profile?.stripe_payouts_enabled !== ready || profile?.stripe_charges_enabled !== transfers) {
    await admin
      .from('profiles')
      .update({ stripe_payouts_enabled: ready, stripe_charges_enabled: transfers })
      .eq('id', userId)
  }

  // Anything Stripe needs from the seller themselves means back to the form;
  // otherwise a not-yet-active account is Stripe still verifying.
  const sellerOwesDetails = (account.requirements?.entries ?? []).some((e) => e.awaiting_action_from === 'user')
  const capabilities = [recipientBalance(account)?.stripe_transfers?.status, recipientBalance(account)?.payouts?.status]
  const verifying = !ready && !sellerOwesDetails && capabilities.some((c) => c === 'pending' || c === 'active')

  return { accountId, ready, needsDetails: !ready && !verifying, verifying }
}
