// lib/email/send.ts
// Transactional email through Resend's HTTP API. Server-only.
// Env: RESEND_API_KEY, EMAIL_FROM (e.g. "Blockparty <hello@blockpartymarketplace.com>",
// on a domain verified in Resend). If RESEND_API_KEY is missing, emails are
// skipped with a warning so local dev still works.

type Email = { to: string; subject: string; html: string; text: string; idempotencyKey?: string }

export async function sendEmail({ to, subject, html, text, idempotencyKey }: Email): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM ?? 'Blockparty <hello@blockpartymarketplace.com>'
  if (!apiKey) {
    console.warn(`RESEND_API_KEY not set; skipped email "${subject}"`)
    return false
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify({ from, to: [to], subject, html, text }),
  })

  if (!res.ok) {
    console.error(`Resend failed (${res.status}) for "${subject}":`, await res.text())
    return false
  }
  return true
}
