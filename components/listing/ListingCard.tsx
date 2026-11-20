// components/listing/ListingCard.tsx
// One listing in a grid (Browse results, the homepage): photo, type badges,
// price, category, condition and area. Data comes from search_listings()
// selected with LISTING_CARD_COLUMNS.
'use client'

import Link from 'next/link'
import { MapPin, Tag } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { areaLabel } from '@/lib/areas'
import { categoryPath, conditionLabel, type CategoryRef } from '@/lib/categories'
import { formatCents } from '@/lib/money'

export const LISTING_CARD_COLUMNS =
  'id, title, listing_type, condition, image_paths, display_price_cents, ends_at, has_reserve, silent, charity:charities(name), area:areas(name, city), category:categories!category_id(name, parent:parent_id(name))'

export type ListingCardData = {
  id: number
  title: string
  listing_type: 'fixed' | 'auction'
  condition: string
  image_paths: string[]
  display_price_cents: number | null
  ends_at: string | null
  has_reserve: boolean
  silent: boolean
  charity: { name: string } | null
  area: { name: string; city: string } | null
  category: CategoryRef
}

const photoUrl = (path: string) => createClient().storage.from('listing-photos').getPublicUrl(path).data.publicUrl

export function ListingCard({ item }: { item: ListingCardData }) {
  return (
    <Link
      href={`/listings/${item.id}`}
      className="group bg-white rounded-2xl border border-slate-200/80 overflow-hidden shadow-sm hover:shadow-md transition flex flex-col"
    >
      <div className="aspect-square sm:aspect-auto sm:h-44 bg-slate-100 relative overflow-hidden">
        {item.image_paths?.[0] ? (
          // eslint-disable-next-line @next/next/no-img-element -- Supabase public URL
          <img src={photoUrl(item.image_paths[0])} alt={item.title} className="w-full h-full object-cover group-hover:scale-[1.02] transition" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs">No photo</div>
        )}
        <span className="absolute top-2 right-2 sm:top-3 sm:right-3 flex flex-col items-end gap-1">
          <span
            className={`px-2.5 sm:px-3 py-1 text-[11px] sm:text-xs font-bold rounded-full shadow-sm text-white ${
              item.listing_type === 'auction' ? 'bg-[#F26B5B]' : 'bg-[#0E4D5C]'
            }`}
          >
            {item.silent ? 'Silent auction' : item.listing_type === 'auction' ? 'Auction' : 'Set Price'}
          </span>
          {item.listing_type === 'auction' && !item.has_reserve && (
            <span className="px-2.5 sm:px-3 py-1 text-[11px] sm:text-xs font-bold rounded-full shadow-sm bg-[#F4A261] text-[#1E293B]">
              No reserve
            </span>
          )}
        </span>
        {item.charity && (
          <span className="absolute bottom-2 left-2 sm:bottom-3 sm:left-3 max-w-[85%] truncate px-2.5 py-1 text-[11px] sm:text-xs font-semibold rounded-full bg-white/95 text-[#0E4D5C] shadow-sm">
            ♥ {item.charity.name}
          </span>
        )}
      </div>

      <div className="p-3 sm:p-4 flex-1 flex flex-col gap-1 min-w-0">
        <h3 className="font-bold text-slate-900 text-sm sm:text-base truncate group-hover:text-[#0E4D5C]">{item.title}</h3>
        <p className="text-sm text-slate-700">
          {item.silent ? 'Bids from ' : item.listing_type === 'auction' ? 'Current bid ' : ''}
          <span className="font-extrabold text-slate-900">{formatCents(item.display_price_cents ?? 0)}</span>
          {item.listing_type === 'auction' && item.has_reserve && !item.silent && <span className="text-xs text-slate-500"> · reserve</span>}
        </p>
        <p className="text-xs text-slate-500 flex items-center gap-1 truncate" title={categoryPath(item.category) ?? undefined}>
          <Tag className="w-3.5 h-3.5 text-[#0E4D5C] shrink-0" />
          {item.category?.name ?? 'Uncategorized'} · {conditionLabel(item.condition)}
        </p>
        <p className="text-xs text-slate-500 flex items-center gap-1 truncate">
          <MapPin className="w-3.5 h-3.5 text-[#F26B5B] shrink-0" />
          {item.area?.name ?? areaLabel(null)}
        </p>
      </div>
    </Link>
  )
}
