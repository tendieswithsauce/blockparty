// app/listings/[id]/page.tsx
// Listing detail: photos, price, hub, description, and the bid / buy panel.
import { Suspense } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { ArrowLeft, MapPin, ShieldCheck, User } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hubName } from '@/lib/hubs'
import { SiteHeader } from '@/components/SiteHeader'
import { PhotoGallery } from '@/components/listing/PhotoGallery'
import { BidPanel } from '@/components/listing/BidPanel'
import { BuyNowPanel } from '@/components/listing/BuyNowPanel'

export default function ListingPage({ params }: PageProps<'/listings/[id]'>) {
  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#1E293B]">
      <SiteHeader active="browse" />
      <main className="max-w-6xl mx-auto px-6 pb-16">
        <Link href="/listings" className="inline-flex items-center gap-1 text-sm font-semibold text-[#0E4D5C] hover:text-[#F26B5B] mb-6">
          <ArrowLeft className="w-4 h-4" /> Back to listings
        </Link>
        <Suspense fallback={<ListingSkeleton />}>
          {params.then(({ id }) => (
            <ListingContent id={id} />
          ))}
        </Suspense>
      </main>
    </div>
  )
}

async function ListingContent({ id }: { id: string }) {
  const listingId = Number(id)
  if (!Number.isSafeInteger(listingId) || listingId <= 0) notFound()

  // Per-request data (signed-in viewer, live price); also keeps the Supabase
  // client's clock reads out of the prerender.
  await connection()
  const supabase = await createClient()
  const { data: listing } = await supabase
    .from('listings')
    .select(
      'id, seller_id, title, description, listing_type, status, location_hub, image_paths, buy_now_price_cents, starting_price_cents, current_bid_cents, bid_count, ends_at, created_at',
    )
    .eq('id', listingId)
    .maybeSingle()
  if (!listing) notFound()

  // Profiles are private; only show the seller's first name.
  const { data: seller } = await createAdminClient()
    .from('profiles')
    .select('full_name, created_at')
    .eq('id', listing.seller_id)
    .maybeSingle()
  const sellerFirstName = seller?.full_name?.split(' ')[0] || 'A neighbour'
  const memberSince = seller?.created_at
    ? new Date(seller.created_at).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })
    : null

  const photoUrls = (listing.image_paths ?? []).map(
    (path) => supabase.storage.from('listing-photos').getPublicUrl(path).data.publicUrl,
  )

  return (
    <div className="grid lg:grid-cols-[1.4fr_1fr] gap-10 items-start">
      <PhotoGallery photos={photoUrls} title={listing.title} />

      <div className="space-y-6">
        <div>
          <span
            className={`inline-block px-3 py-1 text-xs font-bold rounded-full text-white ${
              listing.listing_type === 'auction' ? 'bg-[#F26B5B]' : 'bg-[#0E4D5C]'
            }`}
          >
            {listing.listing_type === 'auction' ? 'Auction' : 'Buy It Now'}
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight mt-3">{listing.title}</h1>
          <p className="flex items-center gap-1 text-sm text-slate-500 mt-2">
            <MapPin className="w-4 h-4 text-[#F26B5B]" /> Pickup at {hubName(listing.location_hub)}
          </p>
        </div>

        {listing.listing_type === 'auction' ? (
          <BidPanel
            listing={{
              id: listing.id,
              title: listing.title,
              sellerId: listing.seller_id,
              status: listing.status,
              startingPriceCents: listing.starting_price_cents ?? 0,
              currentBidCents: listing.current_bid_cents,
              bidCount: listing.bid_count,
              endsAt: listing.ends_at,
            }}
          />
        ) : (
          <BuyNowPanel
            listing={{
              id: listing.id,
              title: listing.title,
              sellerId: listing.seller_id,
              status: listing.status,
              priceCents: listing.buy_now_price_cents ?? 0,
              hubName: hubName(listing.location_hub),
            }}
          />
        )}

        <div className="flex items-start gap-3 bg-[#0E4D5C]/5 rounded-2xl p-4 text-sm">
          <ShieldCheck className="w-5 h-5 text-[#0E4D5C] shrink-0 mt-0.5" />
          <p className="text-slate-600">
            Your payment is held by Blockparty and only released to the seller once you pick the item up at the hub.
          </p>
        </div>

        <div className="flex items-center gap-3 text-sm">
          <span className="w-10 h-10 rounded-full bg-[#F4A261]/30 flex items-center justify-center">
            <User className="w-5 h-5 text-[#0E4D5C]" />
          </span>
          <div>
            <p className="font-semibold">Sold by {sellerFirstName}</p>
            {memberSince && <p className="text-slate-500">Member since {memberSince}</p>}
          </div>
        </div>

        {listing.description && (
          <div>
            <h2 className="font-bold mb-2">Description</h2>
            <p className="text-slate-700 whitespace-pre-line leading-relaxed">{listing.description}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function ListingSkeleton() {
  return (
    <div className="grid lg:grid-cols-[1.4fr_1fr] gap-10">
      <div className="aspect-[4/3] rounded-2xl bg-slate-200 animate-pulse" />
      <div className="space-y-4">
        <div className="h-8 w-2/3 rounded bg-slate-200 animate-pulse" />
        <div className="h-4 w-1/3 rounded bg-slate-200 animate-pulse" />
        <div className="h-48 rounded-2xl bg-slate-200 animate-pulse" />
      </div>
    </div>
  )
}
