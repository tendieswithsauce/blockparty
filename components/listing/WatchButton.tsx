// components/listing/WatchButton.tsx
// Heart toggle for the watchlist. Watchers hear about price drops, a switch
// to auction, and auctions ending within the hour.
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Heart } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type ViewerState = 'loading' | 'signed-out' | 'seller' | 'watching' | 'not-watching'

export function WatchButton({
  listingId,
  sellerId,
  watchCount,
  canWatch,
}: {
  listingId: number
  sellerId: string
  watchCount: number
  canWatch: boolean
}) {
  const [state, setState] = useState<ViewerState>('loading')
  const [count, setCount] = useState(watchCount)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false
    supabase.auth.getUser().then(async ({ data }) => {
      const user = data.user
      let next: ViewerState
      if (!user) next = 'signed-out'
      else if (user.id === sellerId) next = 'seller'
      else {
        const { data: row } = await supabase
          .from('watchlist')
          .select('listing_id')
          .eq('listing_id', listingId)
          .maybeSingle()
        next = row ? 'watching' : 'not-watching'
      }
      if (!cancelled) setState(next)
    })
    return () => {
      cancelled = true
    }
  }, [listingId, sellerId])

  const countLabel = count > 0 ? `${count} watching` : null

  if (state === 'seller' || state === 'loading' || (!canWatch && state !== 'watching')) {
    return countLabel ? <span className="text-sm text-slate-500">{countLabel}</span> : null
  }

  if (state === 'signed-out') {
    return (
      <Link
        href={`/login?next=/listings/${listingId}`}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#0E4D5C] hover:text-[#F26B5B]"
      >
        <Heart className="w-4 h-4" /> Watch{countLabel && <span className="font-normal text-slate-500">· {countLabel}</span>}
      </Link>
    )
  }

  const watching = state === 'watching'
  const toggle = async () => {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error: err } = watching
      ? await supabase.from('watchlist').delete().eq('listing_id', listingId)
      : await supabase.from('watchlist').insert({ listing_id: listingId })
    setBusy(false)
    if (err && err.code !== '23505') {
      setError(watching ? "Couldn't remove it. Try again." : "Couldn't watch this listing. Try again.")
      return
    }
    setState(watching ? 'not-watching' : 'watching')
    if (!err) setCount((c) => Math.max(0, c + (watching ? -1 : 1)))
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-pressed={watching}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-semibold transition disabled:opacity-60 ${
          watching
            ? 'border-[#F26B5B] bg-[#F26B5B]/10 text-[#F26B5B]'
            : 'border-slate-300 text-[#0E4D5C] hover:border-[#F26B5B] hover:text-[#F26B5B]'
        }`}
      >
        <Heart className={`w-4 h-4 ${watching ? 'fill-current' : ''}`} />
        {watching ? 'Watching' : 'Watch'}
      </button>
      {countLabel && <span className="text-sm text-slate-500">{countLabel}</span>}
      {error && <span className="text-sm text-red-600">{error}</span>}
    </span>
  )
}
