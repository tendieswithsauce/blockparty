// lib/notifications/send-emails.ts
// Emails queued notifications (public.notifications rows with
// email_status = 'pending'). Called by the per-minute cron route. Server-only.
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/send'
import { notificationEmail } from '@/lib/email/templates'

const BATCH = 25
const MAX_ATTEMPTS = 5

export async function sendNotificationEmails(siteUrl: string) {
  // Without Resend configured, leave the queue alone (nothing is lost).
  if (!process.env.RESEND_API_KEY) return { sent: 0, failed: 0, skipped: 'RESEND_API_KEY not set' }

  const admin = createAdminClient()
  const { data: batch, error } = await admin.rpc('claim_notification_emails', { p_limit: BATCH })
  if (error) {
    console.error('notification emails: claim failed', error)
    return { sent: 0, failed: 0 }
  }

  let sent = 0
  let failed = 0
  for (const n of batch ?? []) {
    const ok =
      !!n.email &&
      (await sendEmail({
        to: n.email,
        ...notificationEmail({ kind: n.kind, title: n.title, body: n.body, link: n.link, siteUrl }),
        idempotencyKey: `notification-${n.id}`,
      }))
    if (ok) {
      sent++
      await admin.from('notifications').update({ email_status: 'sent', emailed_at: new Date().toISOString() }).eq('id', n.id)
    } else {
      failed++
      // No address: give up. Otherwise retry on a later run, up to MAX_ATTEMPTS.
      const { data: row } = await admin.from('notifications').select('email_attempts').eq('id', n.id).single()
      const giveUp = !n.email || (row?.email_attempts ?? MAX_ATTEMPTS) >= MAX_ATTEMPTS
      await admin
        .from('notifications')
        .update({ email_status: giveUp ? 'failed' : 'pending' })
        .eq('id', n.id)
    }
  }
  return { sent, failed }
}
