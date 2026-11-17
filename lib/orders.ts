// lib/orders.ts
// Shared order constants (client and server).

export const CANCEL_REASONS = {
  buyer: {
    not_as_described: "The item isn't as described",
    changed_mind: 'I changed my mind',
    cant_meet: "We couldn't find a time to meet",
    seller_no_show: "The seller didn't show up",
  },
  seller: {
    unavailable: 'The item is no longer available',
    cant_meet: "We couldn't find a time to meet",
    too_far: 'The delivery address is too far for me',
    buyer_no_show: "The buyer didn't show up",
  },
} as const

const ALL_REASONS: Record<string, string> = {
  ...CANCEL_REASONS.buyer,
  ...CANCEL_REASONS.seller,
  no_meetup: "The meetup didn't happen before the deadline",
}

export function cancelReasonLabel(reason: string | null) {
  return (reason && ALL_REASONS[reason]) || 'Cancelled'
}

/** "Thu, Nov 19, 6:30 p.m." in the meetup spot's own timezone. */
export function formatMeetupTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(new Date(iso))
}

export function mapsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
}

export function addressMapsUrl(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}
