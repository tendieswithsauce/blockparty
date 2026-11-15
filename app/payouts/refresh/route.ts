// app/payouts/refresh/route.ts
// Stripe sends the seller here when an onboarding link expired or was reused:
// make a fresh link and send them straight back.
import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/auth/current-user'
import { createOnboardingLink, ensureConnectedAccount } from '@/lib/stripe/connect'

export async function GET(request: NextRequest) {
  const { origin } = request.nextUrl
  const user = await getCurrentUser()
  if (!user) return NextResponse.redirect(`${origin}/login?next=/dashboard`)

  try {
    const accountId = await ensureConnectedAccount(user)
    return NextResponse.redirect(await createOnboardingLink(accountId, origin))
  } catch (err) {
    console.error('payout refresh failed', err)
    return NextResponse.redirect(`${origin}/dashboard?payouts=error`)
  }
}
