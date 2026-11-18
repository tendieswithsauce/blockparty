// app/listings/[id]/page.tsx
// Listing detail: photos, price, seller's area, description, and the bid / buy panel.
import { Suspense } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { ArrowLeft, HeartHandshake, MapPin, ShieldCheck, Tag, Truck } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { areaLabel } from '@/lib/areas'
import { conditionLabel } from '@/lib/categories'
import { SiteHeader } from '@/components/SiteHeader'
import { PhotoGallery } from '@/components/listing/PhotoGallery'
import { BidPanel } from '@/components/listing/BidPanel'
import { SilentBidPanel } from '@/components/listing/SilentBidPanel'
import { BuyNowPanel } from '@/components/listing/BuyNowPanel'
import { WatchButton } from '@/components/listing/WatchButton'
import { RatingSummary } from '@/components/Stars'
import { Avatar } from '@/components/Avatar'
import { ShareButton } from '@/components/listing/ShareButton'
import { ListingQuestions } from '@/components/listing/ListingQuestions'
import { type HandoffOptions, handoffSummary } from '@/lib/handoff'

export default function ListingPage({ params }: PageProps<'/listings/[id]'>) {
  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#1E293B]">
      <SiteHeader active="browse" />
      <main className="max-w-6xl mx-auto px-4 md:px-6 pb-16">
        <Link href="/listings" className="inline-flex items-center gap-1 text-sm font-semibold text-[#0E4D5C] hover:text-[#F26B5B] mb-3 md:mb-6">
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
      'id, seller_id, title, description, listing_type, status, condition, area:areas(name, city), category:categories!category_id(id, name, parent:parent_id(id, name)), image_paths, buy_now_price_cents, starting_price_cents, current_bid_cents, bid_count, ends_at, has_reserve, reserve_met, watch_count, silent, charity:charities(name, slug), offers_meetup, offers_pickup, delivery_fee_cents, delivery_km, extensions, created_at',
    )
    .eq('id', listingId)
    .maybeSingle()
  if (!listing) notFound()
  // The generated types can't tell the parent link (many-to-one) from the
  // children link on this self-referencing table; it's a single row.
  const category = listing.category as unknown as { id: string; name: string; parent: { id: string; name: string } | null } | null

  // Profiles are private; only show the seller's display name.
  const { data: seller } = await createAdminClient()
    .from('profiles')
    .select('username, created_at')
    .eq('id', listing.seller_id)
    .maybeSingle()
  const sellerName = seller?.username || 'A neighbour'
  const handoff: HandoffOptions = {
    offersMeetup: listing.offers_meetup,
    offersPickup: listing.offers_pickup,
    deliveryFeeCents: listing.delivery_fee_cents,
    deliveryKm: listing.delivery_km,
  }
  const { data: sellerProfile } = seller?.username
    ? await supabase.rpc('public_profile', { p_username: seller.username })
    : { data: null }
  const sellerStats = sellerProfile?.[0] ?? null
  const memberSince = seller?.created_at
    ? new Date(seller.created_at).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })
    : null

  const photoUrls = (listing.image_paths ?? []).map(
    (path) => supabase.storage.from('listing-photos').getPublicUrl(path).data.publicUrl,
  )

  return (
    <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6 lg:gap-10 items-start">
      <PhotoGallery photos={photoUrls} title={listing.title} />

      <div className="space-y-6">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span
              className={`inline-block px-3 py-1 text-xs font-bold rounded-full text-white ${
                listing.listing_type === 'auction' ? 'bg-[#F26B5B]' : 'bg-[#0E4D5C]'
              }`}
            >
              {listing.listing_type === 'auction' ? 'Auction' : 'Set price'}
            </span>
            <div className="flex items-center gap-2">
              <ShareButton listingId={listing.id} title={listing.title} />
              <WatchButton
                listingId={listing.id}
                sellerId={listing.seller_id}
                watchCount={listing.watch_count}
                canWatch={listing.status === 'active'}
              />
            </div>
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight mt-3">{listing.title}</h1>
          <p className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm text-slate-500 mt-2">
            <Tag className="w-4 h-4 text-[#0E4D5C]" />
            {category?.parent && (
              <>
                <Link href={`/listings?category=${category.parent.id}`} className="hover:text-[#0E4D5C] hover:underline">
                  {category.parent.name}
                </Link>
                <span aria-hidden>›</span>
              </>
            )}
            {category && (
              <Link href={`/listings?category=${category.id}`} className="hover:text-[#0E4D5C] hover:underline">
                {category.name}
              </Link>
            )}
            <span className="mx-1" aria-hidden>·</span>
            <span className="font-semibold text-slate-700">{conditionLabel(listing.condition)}</span>
          </p>
          <p className="flex items-center gap-1 text-sm text-slate-500 mt-1">
            <MapPin className="w-4 h-4 text-[#F26B5B]" /> Seller in {areaLabel(listing.area)}
          </p>
          <p className="flex items-start gap-1 text-sm text-slate-500 mt-1">
            <Truck className="w-4 h-4 text-[#0E4D5C] shrink-0 mt-0.5" />
            <span>
              {handoffSummary(handoff)}
              {listing.delivery_km !== null && <> · delivers up to {listing.delivery_km} km</>}
            </span>
          </p>
          {listing.charity && (
            <Link
              href={`/charities/${listing.charity.slug}`}
              className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#F4A261]/20 px-3 py-1 text-sm font-semibold text-[#0E4D5C] hover:bg-[#F4A261]/30"
            >
              <HeartHandshake className="w-4 h-4 text-[#F26B5B]" /> Supports {listing.charity.name}
            </Link>
          )}
        </div>

        {listing.silent ? (
          <SilentBidPanel
            listing={{
              id: listing.id,
              title: listing.title,
              sellerId: listing.seller_id,
              status: listing.status,
              startingPriceCents: listing.starting_price_cents ?? 0,
              bidCount: listing.bid_count,
              endsAt: listing.ends_at,
              extensions: listing.extensions,
              charityName: listing.charity?.name ?? null,
              handoff,
            }}
          />
        ) : listing.listing_type === 'auction' ? (
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
              extensions: listing.extensions,
              hasReserve: listing.has_reserve,
              reserveMet: listing.reserve_met,
              handoff,
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
              handoff,
            }}
          />
        )}

        <div className="flex items-start gap-3 bg-[#0E4D5C]/5 rounded-2xl p-4 text-sm">
          <ShieldCheck className="w-5 h-5 text-[#0E4D5C] shrink-0 mt-0.5" />
          <p className="text-slate-600">
            Your card is only charged once you&apos;ve checked the item and handed over your code.{' '}
            {listing.offers_meetup
              ? 'Public meetups happen at safe spots like police exchange zones.'
              : 'Home addresses are only shared once your card hold goes through.'}
          </p>
        </div>

        <div className="flex items-center gap-3 text-sm">
          <Avatar path={sellerStats?.avatar_path} name={sellerName} size="md" />
          <div>
            <p className="font-semibold">
              Sold by{' '}
              {seller?.username ? (
                <Link href={`/u/${seller.username}`} className="hover:text-[#F26B5B] underline-offset-2 hover:underline">
                  {sellerName}
                </Link>
              ) : (
                sellerName
              )}
            </p>
            {sellerStats && (
              <p>
                <RatingSummary rating={sellerStats.rating} count={sellerStats.review_count} />
                {sellerStats.sales > 0 && <span className="text-slate-500"> · {sellerStats.sales} sold</span>}
              </p>
            )}
            {memberSince && <p className="text-slate-500">Member since {memberSince}</p>}
          </div>
        </div>

        {listing.description && (
          <div>
            <h2 className="font-bold mb-2">Description</h2>
            <p className="text-slate-700 whitespace-pre-line leading-relaxed">{listing.description}</p>
          </div>
        )}

        <ListingQuestions listingId={listing.id} sellerId={listing.seller_id} open={listing.status === 'active'} />
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
