// app/payouts/actions.ts
// Seller payout setup (Stripe Connect onboarding) as Server Actions.
'use server'

import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/current-user'
import { siteUrl } from '@/lib/site-url'
import { getStripe, stripeConfigured } from '@/lib/stripe/server'
import { createOnboardingLink, ensureConnectedAccount, syncPayoutStatus, type PayoutStatus } from '@/lib/stripe/connect'
import { createAdminClient } from '@/lib/supabase/admin'

export type PayoutActionState = { error?: string }

/** Current payout status, refreshed from Stripe. */
export async function getPayoutStatus(): Promise<PayoutStatus | null> {
  const user = await getCurrentUser()
  if (!user || !stripeConfigured()) return null
  try {
    return await syncPayoutStatus(user.id)
  } catch (err) {
    console.error('getPayoutStatus failed', err)
    return null
  }
}

/** Sends the seller to Stripe's hosted onboarding to add their bank details. */
export async function startPayoutOnboarding(_prev: PayoutActionState): Promise<PayoutActionState> {
  const user = await getCurrentUser()
  if (!user) redirect('/login?next=/dashboard')
  if (!stripeConfigured()) return { error: 'Payouts are not set up yet. Please try again later.' }

  let url: string
  try {
    const accountId = await ensureConnectedAccount(user)
    url = await createOnboardingLink(accountId, await siteUrl())
  } catch (err) {
    console.error('startPayoutOnboarding failed', err)
    return { error: 'Could not open payout setup. Please try again.' }
  }
  redirect(url)
}

/** Opens the seller's Stripe Express dashboard (payout history, bank details). */
export async function openPayoutDashboard(_prev: PayoutActionState): Promise<PayoutActionState> {
  const user = await getCurrentUser()
  if (!user) redirect('/login?next=/dashboard')
  if (!stripeConfigured()) return { error: 'Payouts are not set up yet.' }

  let url: string
  try {
    const { data: profile } = await createAdminClient()
      .from('profiles')
      .select('stripe_account_id')
      .eq('id', user.id)
      .single()
    if (!profile?.stripe_account_id) return { error: 'Set up payouts first.' }
    url = (await getStripe().accounts.createLoginLink(profile.stripe_account_id)).url
  } catch (err) {
    console.error('openPayoutDashboard failed', err)
    return { error: 'Could not open your payout dashboard. Please try again.' }
  }
  redirect(url)
}
