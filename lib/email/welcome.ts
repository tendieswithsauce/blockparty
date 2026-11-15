// lib/email/welcome.ts
// Sends the welcome email once, right after a user confirms their email.
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/send'
import { welcomeEmail } from '@/lib/email/templates'

export async function sendWelcomeEmailOnce(userId: string, siteUrl: string) {
  const admin = createAdminClient()

  // Claim it atomically so two confirm clicks can't both send.
  const { data: profile } = await admin
    .from('profiles')
    .update({ welcome_email_sent_at: new Date().toISOString() })
    .eq('id', userId)
    .is('welcome_email_sent_at', null)
    .select('email, full_name')
    .maybeSingle()
  if (!profile?.email) return

  const email = welcomeEmail({ firstName: profile.full_name?.split(' ')[0] ?? null, siteUrl })
  const sent = await sendEmail({ to: profile.email, ...email, idempotencyKey: `welcome-${userId}` })

  // Let a later confirmation retry if Resend failed.
  if (!sent) await admin.from('profiles').update({ welcome_email_sent_at: null }).eq('id', userId)
}
