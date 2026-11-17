// lib/handoff.ts
// How an item changes hands (client and server): meet at a public spot,
// pick up at the seller's home, or the seller delivers for a fee.
// The database enforces the same rules (begin_purchase / place_bid).
import type { HandoffMethod } from '@/lib/supabase/database.types'
import { formatCents } from '@/lib/money'

export type { HandoffMethod }

/** Days after the card hold to complete the handoff before it's released. */
export const HANDOFF_WINDOW_DAYS = 5

export type HandoffOptions = {
  offersMeetup: boolean
  offersPickup: boolean
  deliveryFeeCents: number | null
  deliveryKm: number | null
}

export function availableMethods(o: HandoffOptions): HandoffMethod[] {
  const methods: HandoffMethod[] = []
  if (o.offersMeetup) methods.push('meetup')
  if (o.offersPickup) methods.push('pickup')
  if (o.deliveryFeeCents !== null) methods.push('delivery')
  return methods
}

export function methodTitle(method: HandoffMethod) {
  return { meetup: 'Meet at a safe public spot', pickup: "Pick up at the seller's home", delivery: 'Delivered to your home' }[
    method
  ]
}

export function methodDetail(method: HandoffMethod, o: HandoffOptions) {
  if (method === 'meetup') return 'Like a police exchange zone. Free.'
  if (method === 'pickup') return "Free. You'll see the address once your card hold goes through."
  return `${formatCents(o.deliveryFeeCents ?? 0)} delivery fee, paid to the seller. Up to ${o.deliveryKm} km from the seller's area.`
}

/** Short summary for the listing page, e.g. "Meetup · Pickup · Delivery ($10)". */
export function handoffSummary(o: HandoffOptions) {
  return availableMethods(o)
    .map((m) =>
      m === 'meetup' ? 'Public meetup' : m === 'pickup' ? 'Pickup at seller’s home' : `Delivery (${formatCents(o.deliveryFeeCents ?? 0)})`,
    )
    .join(' · ')
}

/** "Fri, Nov 20" style date for the latest handoff day. */
export function formatDeadline(date: Date) {
  return date.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })
}

/** When the handoff must happen by if the buyer's hold starts at `start`. */
export function handoffDeadline(start: Date | number) {
  return new Date(new Date(start).getTime() + HANDOFF_WINDOW_DAYS * 86_400_000)
}
