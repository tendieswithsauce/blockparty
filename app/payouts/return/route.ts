// app/payouts/return/route.ts
// Stripe sends the seller here after onboarding. Returning doesn't mean they
// finished, so re-read the account from Stripe before showing the dashboard.
import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/auth/current-user'
import { syncPayoutStatus } from '@/lib/stripe/connect'

export async function GET(request: NextRequest) {
  const { origin } = request.nextUrl
  const user = await getCurrentUser()
  if (!user) return NextResponse.redirect(`${origin}/login?next=/dashboard`)

  let result = 'pending'
  try {
    const status = await syncPayoutStatus(user.id)
    result = status.ready ? 'ready' : 'pending'
  } catch (err) {
    console.error('payout return sync failed', err)
  }
  return NextResponse.redirect(`${origin}/dashboard?payouts=${result}`)
}
