// lib/auth/onboarding.ts
// Where to send someone right after they sign in: the welcome step (/welcome)
// if their area or phone is missing (e.g. a Google sign-up), or, on their very
// first sign-in, if they haven't added a payment method yet.
import { createAdminClient } from '@/lib/supabase/admin'

export async function afterSignIn(userId: string, next: string, { firstTime = false } = {}): Promise<string> {
  const { data: p } = await createAdminClient()
    .from('profiles')
    .select('phone, area_id, stripe_payment_method_id, welcome_email_sent_at')
    .eq('id', userId)
    .maybeSingle()
  if (!p) return next
  const missingRequired = !p.phone || !p.area_id
  const firstVisitWithoutCard = firstTime && !p.welcome_email_sent_at && !p.stripe_payment_method_id
  if (missingRequired || firstVisitWithoutCard) return `/welcome?next=${encodeURIComponent(next)}`
  return next
}
