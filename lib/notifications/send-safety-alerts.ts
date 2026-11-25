// lib/notifications/send-safety-alerts.ts
// Emails trusted contacts (public.safety_alerts): the request to agree (queued
// when a member adds one), and, once they've agreed, meetup times and places
// (queued by a database trigger when a meetup time is agreed, and when it's
// done or cancelled). Called by the per-minute cron route. Server-only.
import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/send'
import { safetyAlertEmail } from '@/lib/email/templates'

const BATCH = 25
const MAX_ATTEMPTS = 5

/** requestSiteUrl: as for sendNotificationEmails (the database setting wins). */
export async function sendSafetyAlerts(requestSiteUrl: string) {
  if (!process.env.RESEND_API_KEY) return { sent: 0, failed: 0, skipped: 'RESEND_API_KEY not set' }

  const admin = createAdminClient()
  const { data: settings } = await admin.from('marketplace_settings').select('email_site_url').maybeSingle()
  const siteUrl = settings?.email_site_url ?? requestSiteUrl
  const { data: batch, error } = await admin.rpc('claim_safety_alerts', { p_limit: BATCH })
  if (error) {
    console.error('safety alerts: claim failed', error)
    return { sent: 0, failed: 0 }
  }

  let sent = 0
  let failed = 0
  for (const a of batch ?? []) {
    const ok = await sendEmail({
      to: a.to_email,
      ...safetyAlertEmail({
        kind: a.kind,
        subject: a.subject,
        body: a.body,
        toName: a.to_name,
        link: a.link,
        ctaLabel: a.cta_label,
        siteUrl,
      }),
      idempotencyKey: `safety-alert-${a.id}`,
    })
    if (ok) {
      sent++
      await admin.from('safety_alerts').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', a.id)
    } else {
      failed++
      const { data: row } = await admin.from('safety_alerts').select('attempts').eq('id', a.id).single()
      await admin
        .from('safety_alerts')
        .update({ status: (row?.attempts ?? MAX_ATTEMPTS) >= MAX_ATTEMPTS ? 'failed' : 'pending' })
        .eq('id', a.id)
    }
  }
  return { sent, failed }
}
