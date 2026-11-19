// lib/stripe/server.ts
// Server-only Stripe client. Never import this from a 'use client' file:
// it reads STRIPE_SECRET_KEY.
import 'server-only'
import Stripe from 'stripe'

let stripe: Stripe | null = null

export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY)
}

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
  if (!stripe) {
    stripe = new Stripe(key, {
      appInfo: { name: 'Blockparty' },
    })
  }
  return stripe
}
