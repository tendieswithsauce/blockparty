// lib/email/templates.ts
// Branded HTML emails (same look as supabase/templates). Inline styles and
// tables for email-client support.

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function layout({ heading, body, cta }: { heading: string; body: string; cta?: { label: string; url: string } }) {
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
</td></tr>
<tr><td align="center" style="padding-top:24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#94A3B8;">
  Blockparty &middot; Buy, sell and bid locally in Edmonton<br>Payments held safely until pickup at your exchange hub.
</td></tr>
</table></td></tr></table></body></html>`
}

const p = (text: string) =>
  `<p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:#475569;">${text}</p>`

export function welcomeEmail({ firstName, siteUrl }: { firstName: string | null; siteUrl: string }) {
  const hi = firstName ? `Welcome, ${esc(firstName)}!` : 'Welcome to Blockparty!'
  return {
    subject: 'Welcome to Blockparty',
    html: layout({
      heading: hi,
      body:
        p("Your account is confirmed. Blockparty is Edmonton's neighbourhood marketplace: buy, bid and sell with people nearby, and swap items at a local exchange hub.") +
        p('<strong>To buy or bid:</strong> add a payment method. Your card is only charged when you win or use Buy Now, and the money is held until you pick up.') +
        p('<strong>To sell:</strong> set up payouts with Stripe, then list your first item in a couple of minutes.'),
      cta: { label: 'Go to my dashboard', url: `${siteUrl}/dashboard` },
    }),
    text: `${hi}\n\nYour account is confirmed. Add a payment method to buy or bid, and set up payouts to sell.\n\nGo to your dashboard: ${siteUrl}/dashboard\n`,
  }
}
