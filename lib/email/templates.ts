// lib/email/templates.ts
// Branded HTML emails (same look as supabase/templates). Inline styles and
// tables for email-client support.

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function layout({
  heading,
  body,
  cta,
  note = '',
}: {
  heading: string
  body: string
  cta?: { label: string; url: string }
  note?: string
}) {
  const button = cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;"><tr>
        <td align="center" style="background-color:#F26B5B;border-radius:999px;">
          <a href="${esc(cta.url)}" style="display:inline-block;padding:14px 32px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;">${esc(cta.label)}</a>
        </td></tr></table>`
    : ''
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(heading)}</title></head>
<body style="margin:0;padding:0;background-color:#FAF8F5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FAF8F5;"><tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
<tr><td align="center" style="padding-bottom:24px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="width:14px;height:14px;background-color:#F26B5B;border-radius:7px 7px 0 0;"></td>
    <td style="width:14px;height:14px;background-color:#0E4D5C;border-radius:7px 7px 0 0;"></td>
    <td style="width:14px;height:14px;background-color:#F4A261;border-radius:7px 7px 0 0;"></td>
    <td style="padding-left:10px;font-family:Arial,Helvetica,sans-serif;font-size:26px;font-weight:800;letter-spacing:-0.5px;color:#F26B5B;">Blockparty</td>
  </tr></table>
</td></tr>
<tr><td style="background-color:#ffffff;border:1px solid #E7E2DA;border-radius:16px;padding:40px 36px;font-family:Arial,Helvetica,sans-serif;color:#1E293B;">
  <h1 style="margin:0 0 12px;font-size:24px;line-height:1.3;font-weight:800;color:#0E4D5C;">${esc(heading)}</h1>
  ${body}
  ${button}
  ${note}
</td></tr>
<tr><td align="center" style="padding-top:24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#94A3B8;">
  Blockparty &middot; Buy, sell and bid with your neighbours<br>Meet at a safe public spot. Pay only when you accept the item.
</td></tr>
</table></td></tr></table></body></html>`
}

const p = (text: string) =>
  `<p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:#475569;">${text}</p>`

// Kinds the user can switch off on their profile (matches public.notify()).
const OPTIONAL_KINDS = new Set(['outbid', 'watch_auction', 'watch_ending', 'watch_price_drop', 'saved_search'])

const CTA_LABELS: Record<string, string> = {
  outbid: 'Bid again',
  watch_auction: 'See the auction',
  watch_ending: 'See the auction',
  watch_price_drop: 'See the listing',
  saved_search: 'See the listing',
  payment_failed: 'Check my payment method',
  auction_unsold: 'Go to my dashboard',
}

/** Email version of an in-app notification (title + one paragraph + button). */
export function notificationEmail({
  kind,
  title,
  body,
  link,
  siteUrl,
}: {
  kind: string
  title: string
  body: string | null
  link: string | null
  siteUrl: string
}) {
  const url = link ? `${siteUrl}${link}` : `${siteUrl}/dashboard`
  const label = CTA_LABELS[kind] ?? (link?.startsWith('/orders/') ? 'Open my order' : 'Open Blockparty')
  const optOut = OPTIONAL_KINDS.has(kind)
    ? `<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#94A3B8;">You can turn off outbid, watchlist and saved-search emails on your <a href="${esc(`${siteUrl}/profile`)}" style="color:#0E4D5C;">profile</a>.</p>`
    : ''
  return {
    subject: title,
    html: layout({ heading: title, body: body ? p(esc(body)) : '', cta: { label, url }, note: optOut }),
    text: `${title}\n\n${body ? `${body}\n\n` : ''}${label}: ${url}\n${
      OPTIONAL_KINDS.has(kind) ? `\nTurn off outbid, watchlist and saved-search emails: ${siteUrl}/profile\n` : ''
    }`,
  }
}

export function welcomeEmail({ firstName, siteUrl }: { firstName: string | null; siteUrl: string }) {
  const hi = firstName ? `Welcome, ${esc(firstName)}!` : 'Welcome to Blockparty!'
  return {
    subject: 'Welcome to Blockparty',
    html: layout({
      heading: hi,
      body:
        p("Your account is confirmed. Blockparty is your neighbourhood marketplace: buy, bid and sell with people nearby, meet at a safe public spot, and only pay once you've checked the item.") +
        p('<strong>To buy or bid:</strong> add a payment method. When you win an auction or buy a set-price item we hold the amount on your card, and only charge it once you&rsquo;ve met the seller and accepted the item.') +
        p('<strong>To sell:</strong> set up payouts with Stripe, then list your first item in a couple of minutes.'),
      cta: { label: 'Go to my dashboard', url: `${siteUrl}/dashboard` },
    }),
    text: `${hi}\n\nYour account is confirmed. Add a payment method to buy or bid, and set up payouts to sell.\n\nGo to your dashboard: ${siteUrl}/dashboard\n`,
  }
}

/**
 * To someone a member named as their emergency contact: where and when the
 * member is meeting another member (or that it's done / cancelled).
 */
export function safetyAlertEmail({ subject, body, toName }: { subject: string; body: string; toName: string | null }) {
  const hi = toName ? `Hi ${toName},` : 'Hi,'
  const why =
    'You&rsquo;re getting this because a Blockparty member added you as their emergency contact. Blockparty is a local marketplace where neighbours meet to buy and sell. If you think this is a mistake, you can ignore this email.'
  return {
    subject,
    html: layout({
      heading: subject,
      body: p(esc(hi)) + p(esc(body)),
      note: `<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#94A3B8;">${why}</p>`,
    }),
    text: `${hi}\n\n${body}\n\nYou're getting this because a Blockparty member added you as their emergency contact. If you think this is a mistake, you can ignore this email.\n`,
  }
}
