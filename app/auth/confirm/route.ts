// app/auth/confirm/route.ts
// Token-hash email links (works across devices, unlike the PKCE ?code= flow).
// Point the Supabase email templates here, e.g. for "Confirm signup":
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/dashboard
// and for "Reset password":
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password
import type { EmailOtpType } from '@supabase/supabase-js'
import { after, NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { safeNextPath } from '@/lib/auth/redirect'
import { sendWelcomeEmailOnce } from '@/lib/email/welcome'

const ALLOWED_TYPES: EmailOtpType[] = ['signup', 'email', 'recovery', 'invite', 'email_change', 'magiclink']

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = safeNextPath(searchParams.get('next'))

  if (tokenHash && type && ALLOWED_TYPES.includes(type)) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    if (!error) {
      // Email confirmed: welcome email, sent once.
      const userId = data.user?.id
      if (userId && type !== 'recovery') after(() => sendWelcomeEmailOnce(userId, origin))
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent('That link is invalid or has expired. Please request a new one.')}`
  )
}
