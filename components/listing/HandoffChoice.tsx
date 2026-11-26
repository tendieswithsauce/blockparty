// components/listing/HandoffChoice.tsx
// In the buy / bid confirmation: how the buyer will get the item, and the
// date by which they must be able to collect it (or the hold is released).
'use client'

import Link from 'next/link'
import { CalendarClock, Home, MapPin, Truck } from 'lucide-react'
import {
  type HandoffMethod,
  type HandoffOptions,
  HANDOFF_WINDOW_DAYS,
  availableMethods,
  formatDeadline,
  methodDetail,
  methodTitle,
} from '@/lib/handoff'

const ICONS = { meetup: MapPin, pickup: Home, delivery: Truck } as const

export function HandoffChoice({
  options,
  value,
  onChange,
  hasHomeAddress,
  listingId,
}: {
  options: HandoffOptions
  value: HandoffMethod
  onChange: (m: HandoffMethod) => void
  hasHomeAddress: boolean
  listingId: number
}) {
  const methods = availableMethods(options)
  return (
    <fieldset className="space-y-2">
      <legend className="font-semibold text-slate-700 mb-1">How you&apos;ll get it</legend>
      {methods.map((m) => {
        const Icon = ICONS[m]
        const blocked = m === 'delivery' && !hasHomeAddress
        return (
          <label
            key={m}
            className={`flex items-start gap-3 border rounded-xl p-3 ${
              value === m ? 'border-[#0E4D5C] bg-[#0E4D5C]/5' : ''
            } ${blocked ? 'opacity-70' : 'cursor-pointer'}`}
          >
            <input
              type="radio"
              name="handoff"
              className="mt-1 w-4 h-4"
              checked={value === m}
              disabled={blocked}
              onChange={() => onChange(m)}
            />
            <span className="text-sm">
              <span className="flex items-center gap-1.5 font-semibold text-slate-800">
                <Icon className="w-4 h-4 text-[#0E4D5C]" /> {methodTitle(m)}
              </span>
              <span className="block text-slate-500">{methodDetail(m, options)}</span>
              {blocked && (
                <Link
                  href={`/profile?next=${encodeURIComponent(`/listings/${listingId}`)}`}
                  className="block font-semibold text-[#0E4D5C] underline mt-0.5"
                >
                  Add your home address to choose delivery
                </Link>
              )}
            </span>
          </label>
        )
      })}
    </fieldset>
  )
}

/** The "you must be able to collect it by" warning. */
export function HandoffDeadlineNote({ deadline, auction, free = false }: { deadline: Date; auction: boolean; free?: boolean }) {
  return (
    <div className="flex items-start gap-2 rounded-xl bg-amber-50 text-amber-900 p-3 text-sm">
      <CalendarClock className="w-4 h-4 shrink-0 mt-0.5" />
      <p>
        <strong>
          Only {auction ? 'bid' : free ? 'claim it' : 'buy'} if you can get the item by {formatDeadline(deadline)}.
        </strong>{' '}
        {auction ? 'If you win, you have 24 hours to confirm and pay; then you' : 'You'} and the seller have{' '}
        {HANDOFF_WINDOW_DAYS} days to do the handoff. After that the order is cancelled
        {free ? ' and the item goes back to the seller.' : ' and the hold on your card is released.'}
      </p>
    </div>
  )
}
