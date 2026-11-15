// lib/site-url.ts
// Absolute site origin for links we hand to Supabase and Stripe (email links,
// OAuth and Stripe onboarding return URLs). Server-only: reads request headers.
import { headers } from 'next/headers'

export async function siteUrl(): Promise<string> {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')
  }
  const h = await headers()
  const origin = h.get('origin')
  if (origin) return origin
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'https'
  return `${proto}://${host}`
}
