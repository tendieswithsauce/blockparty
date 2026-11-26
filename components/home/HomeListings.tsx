// components/home/HomeListings.tsx
// Real listings on the homepage: auctions ending soonest, the newest
// listings, then free stuff, from search_listings() like Browse.
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { LISTING_CARD_COLUMNS, ListingCard, type ListingCardData } from '@/components/listing/ListingCard'

const COUNT = 4

export function HomeListings() {
  const [ending, setEnding] = useState<ListingCardData[] | null>(null)
  const [newest, setNewest] = useState<ListingCardData[] | null>(null)
  const [free, setFree] = useState<ListingCardData[] | null>(null)

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    const search = (type: 'auction' | 'free' | null, sort: 'ending_soon' | 'newest') =>
      supabase
        .rpc('search_listings', { p_listing_type: type, p_sort: sort, p_limit: COUNT + 4 })
        .select(LISTING_CARD_COLUMNS)
        .then(({ data }) => (data ?? []) as unknown as ListingCardData[])
    Promise.all([search('auction', 'ending_soon'), search(null, 'newest'), search('free', 'newest')]).then(
      ([auctions, latest, freeItems]) => {
        if (cancelled) return
        const shownAuctions = auctions.slice(0, COUNT)
        const shownFree = freeItems.slice(0, COUNT)
        const shownIds = new Set([...shownAuctions, ...shownFree].map((l) => l.id))
        setEnding(shownAuctions)
        setFree(shownFree)
        // Don't repeat a listing already shown in another row.
        setNewest(latest.filter((l) => !shownIds.has(l.id)).slice(0, COUNT))
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      <Row title="Auctions ending soon" href="/listings?type=auction&sort=ending_soon" items={ending} empty="No auctions running right now." />
      <Row title="Just listed" href="/listings?sort=newest" items={newest} empty="Nothing new yet. Be the first to list something!" />
      <Row title="Free stuff" href="/listings?type=free" items={free} empty="" />
    </>
  )
}

function Row({ title, href, items, empty }: { title: string; href: string; items: ListingCardData[] | null; empty: string }) {
  if (items !== null && items.length === 0 && title !== 'Just listed') return null
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-end justify-between gap-3 mb-4">
        <h2 className="text-xl sm:text-2xl font-extrabold text-[#1E293B]">{title}</h2>
        <Link href={href} className="text-sm font-bold text-[#0E4D5C] hover:text-[#F26B5B] inline-flex items-center gap-1 shrink-0">
          See all <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
      {items === null ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
          {Array.from({ length: COUNT }, (_, n) => (
            <div key={n} className="h-64 bg-slate-200 animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
          {items.map((item) => (
            <ListingCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  )
}
