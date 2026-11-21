// app/auth/callback/route.ts
// Landing point for Google OAuth, email confirmation and password-reset links
// (PKCE flow: Supabase redirects here with ?code=...).
import { after, NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { safeNextPath } from '@/lib/auth/redirect'
import { sendWelcomeEmailOnce } from '@/lib/email/welcome'
import { afterSignIn } from '@/lib/auth/onboarding'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const next = safeNextPath(searchParams.get('next'))

  // Provider or Supabase reported a problem (e.g. user cancelled Google consent,
  // or the link expired).
  const providerError = searchParams.get('error_description') ?? searchParams.get('error')
  if (providerError) {
    return NextResponse.redirect(loginWithError(origin, providerError))
  }

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // First confirmed sign-in (email link or Google): welcome email, sent once.
      const userId = data.user?.id
      if (!userId) return NextResponse.redirect(`${origin}${next}`)
      // Password-reset links land here too: send those straight on.
      const target = next.startsWith('/reset-password') ? next : await afterSignIn(userId, next, { firstTime: true })
      after(() => sendWelcomeEmailOnce(userId, origin))
      return NextResponse.redirect(`${origin}${target}`)
    }
  }

  return NextResponse.redirect(
    loginWithError(
      origin,
      'That link is invalid or has expired. If you opened it on a different device or browser, try again from the one you signed up on.'
    )
  )
}

function loginWithError(origin: string, message: string) {
  return `${origin}/login?error=${encodeURIComponent(message)}`
}
