// components/dashboard/ConvertToAuctionModal.tsx
// Switch a set-price listing to an auction (once per listing, while nobody
// is buying it). Watchers are notified by convert_to_auction().
'use client'

import { useState } from 'react'
import { Gavel, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { MAX_PRICE_CENTS, dollarsToCents, formatCents } from '@/lib/money'
import { MIN_PRICE_CENTS } from '@/lib/fees'

const AUCTION_DURATIONS_DAYS = [1, 3, 5, 7] as const

export function ConvertToAuctionModal({
  listing,
  onClose,
  onConverted,
}: {
  listing: { id: number; title: string; priceCents: number; watchCount: number }
  onClose: () => void
  onConverted: () => void
}) {
  // Suggest starting at half the set price, and protecting the set price
  // with a reserve.
  const suggestedStart = Math.max(MIN_PRICE_CENTS, Math.round(listing.priceCents / 200) * 100)
  const [start, setStart] = useState(String(suggestedStart / 100))
  const [durationDays, setDurationDays] = useState(3)
  const [useReserve, setUseReserve] = useState(listing.priceCents > suggestedStart)
  const [reserve, setReserve] = useState(String(listing.priceCents / 100))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const startCents = dollarsToCents(start)
    if (startCents === null || startCents < MIN_PRICE_CENTS || startCents > MAX_PRICE_CENTS) {
      setError(`The starting price must be between ${formatCents(MIN_PRICE_CENTS)} and ${formatCents(MAX_PRICE_CENTS)}.`)
      return
    }
    let reserveCents: number | null = null
    if (useReserve) {
      reserveCents = dollarsToCents(reserve)
      if (reserveCents === null || reserveCents <= startCents || reserveCents > MAX_PRICE_CENTS) {
        setError(`The reserve must be higher than the starting price and at most ${formatCents(MAX_PRICE_CENTS)}.`)
        return
      }
    }

    setSaving(true)
    const { error: rpcError } = await createClient().rpc('convert_to_auction', {
      p_listing_id: listing.id,
      p_starting_price_cents: startCents,
      p_duration_days: durationDays,
      p_reserve_cents: reserveCents,
    })
    setSaving(false)
    if (rpcError) {
      setError(rpcError.code === 'P0001' ? `${rpcError.message}.` : 'Something went wrong. Please try again.')
      return
    }
    onConverted()
  }

  const inputClass =
    'mt-1 w-full border border-slate-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0E4D5C]'

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true">
      <div className="bg-white max-w-md w-full rounded-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 pt-6">
          <h2 className="text-xl font-bold text-[#0E4D5C] flex items-center gap-2">
            <Gavel className="w-5 h-5" /> Switch to auction
          </h2>
          <button type="button" onClick={onClose} disabled={saving} className="p-1 rounded-full hover:bg-slate-100" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <p className="text-sm text-slate-600">
            <span className="font-semibold text-[#1E293B]">{listing.title}</span> is listed for {formatCents(listing.priceCents)}.
            As an auction it sells to the highest bidder instead.{' '}
            {listing.watchCount > 0 &&
              `${listing.watchCount} ${listing.watchCount === 1 ? 'person is' : 'people are'} watching it and will be told. `}
            You can only do this once, and it can&apos;t be switched back.
          </p>

          {error && <div className="p-3 text-sm rounded-lg bg-red-50 text-red-700">{error}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="convert-start" className="block text-sm font-medium text-gray-700">Starting price ($)</label>
              <input
                id="convert-start"
                type="number"
                step="0.01"
                min={MIN_PRICE_CENTS / 100}
                max={MAX_PRICE_CENTS / 100}
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="convert-duration" className="block text-sm font-medium text-gray-700">Auction length</label>
              <select
                id="convert-duration"
                value={durationDays}
                onChange={(e) => setDurationDays(Number(e.target.value))}
                className={inputClass}
              >
                {AUCTION_DURATIONS_DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d} {d === 1 ? 'day' : 'days'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <fieldset>
            <legend className="block text-sm font-medium text-gray-700">Reserve price</legend>
            <div className="mt-1 flex gap-4 text-sm">
              <label className="inline-flex items-center gap-2">
                <input type="radio" name="convert-reserve" checked={!useReserve} onChange={() => setUseReserve(false)} />
                No reserve
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="radio" name="convert-reserve" checked={useReserve} onChange={() => setUseReserve(true)} />
                Set a reserve
              </label>
            </div>
            {useReserve && (
              <input
                type="number"
                step="0.01"
                min={MIN_PRICE_CENTS / 100}
                max={MAX_PRICE_CENTS / 100}
                required
                aria-label="Reserve price in dollars"
                value={reserve}
                onChange={(e) => setReserve(e.target.value)}
                className={inputClass}
              />
            )}
            <p className="mt-1 text-xs text-gray-500">
              {useReserve
                ? "Kept secret. Bidders only see whether it's been met. If bidding ends below it, the item doesn't sell."
                : 'The item sells to the highest bidder, whatever the final price.'}
            </p>
          </fieldset>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-full bg-[#F26B5B] text-white font-semibold hover:bg-[#e05a4a] disabled:opacity-60"
            >
              {saving ? 'Starting…' : 'Start auction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
