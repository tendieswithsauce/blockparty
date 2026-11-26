// lib/listing-type.ts
// Labels and colours for the three kinds of listing (Buy Now, Auction, Free).
import type { Database } from '@/lib/supabase/database.types'

export type ListingType = Database['public']['Enums']['listing_type']

export function typeLabel(type: ListingType, silent = false) {
  if (silent) return 'Silent auction'
  return type === 'auction' ? 'Auction' : type === 'free' ? 'Free' : 'Buy Now'
}

export function typeBadgeClass(type: ListingType) {
  return type === 'auction' ? 'bg-[#F26B5B]' : type === 'free' ? 'bg-[#2E8B57]' : 'bg-[#0E4D5C]'
}
