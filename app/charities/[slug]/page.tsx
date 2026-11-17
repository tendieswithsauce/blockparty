// app/charities/[slug]/page.tsx
// One charity: who they are and everything they have for sale.
import { Suspense } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { ArrowLeft, BadgeCheck, ExternalLink, HeartHandshake } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { formatCents } from '@/lib/money'
import { SiteHeader } from '@/components/SiteHeader'

export default function CharityPage({ params }: PageProps<'/charities/[slug]'>) {
  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#1E293B]">
      <SiteHeader active="charities" />
      <main className="max-w-6xl mx-auto px-6 pb-16 space-y-6">
        <Link href="/charities" className="inline-flex items-center gap-1 text-sm font-semibold text-[#0E4D5C] hover:text-[#F26B5B]">
          <ArrowLeft className="w-4 h-4" /> All charities
        </Link>
        <Suspense fallback={<div className="h-64 rounded-2xl bg-slate-200 animate-pulse" />}>
          {params.then(({ slug }) => (
            <CharityContent slug={slug} />
          ))}
        </Suspense>
      </main>
    </div>
  )
}

async function CharityContent({ slug }: { slug: string }) {
  if (!/^[a-z0-9-]{1,90}$/.test(slug)) notFound()
  await connection()
  const supabase = await createClient()
  const { data: charity } = await supabase
    .from('charities')
    .select('id, name, description, website, cra_legal_name, cra_city, cra_province, status')
    .eq('slug', slug)
    .eq('status', 'approved')
    .maybeSingle()
  if (!charity) notFound()

  const { data: listings } = await supabase
    .from('listings')
    .select('id, title, listing_type, display_price_cents, image_paths, ends_at, bid_count')
    .eq('charity_id', charity.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(60)

  const website = charity.website && /^https?:\/\//i.test(charity.website) ? charity.website : null

  return (
    <div className="space-y-6">
      <section className="bg-white border rounded-2xl p-6 shadow-sm space-y-2">
        <h1 className="text-3xl font-extrabold text-[#0E4D5C] flex items-center gap-2">
          <HeartHandshake className="w-7 h-7 text-[#F26B5B]" /> {charity.name}
        </h1>
        <p className="text-sm text-slate-600 flex items-center gap-1">
          <BadgeCheck className="w-4 h-4 text-green-700" /> Registered Canadian charity
          {charity.cra_legal_name && charity.cra_legal_name.toLowerCase() !== charity.name.toLowerCase() && (
            <> · {charity.cra_legal_name}</>
          )}
        </p>
        {charity.description && <p className="text-slate-700 whitespace-pre-line">{charity.description}</p>}
        {website && (
          <a href={website} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-sm text-[#0E4D5C] underline">
            Visit their website <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </section>

      <section>
        <h2 className="text-lg font-bold mb-3">For sale</h2>
        {!listings?.length ? (
          <p className="text-slate-500 text-sm">Nothing listed right now. Check back soon.</p>
        ) : (
          <ul className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {listings.map((l) => {
              const photo = l.image_paths?.[0]
                ? supabase.storage.from('listing-photos').getPublicUrl(l.image_paths[0]).data.publicUrl
                : null
              return (
                <li key={l.id}>
                  <Link href={`/listings/${l.id}`} className="block bg-white border rounded-xl overflow-hidden hover:border-[#0E4D5C]">
                    <div className="aspect-[4/3] bg-slate-100">
                      {/* eslint-disable-next-line @next/next/no-img-element -- Supabase public URL */}
                      {photo && <img src={photo} alt={l.title} className="w-full h-full object-cover" />}
                    </div>
                    <div className="p-3">
                      <p className="font-semibold line-clamp-1">{l.title}</p>
                      <p className="text-sm text-[#0E4D5C] font-bold">
                        {l.listing_type === 'auction' ? 'From ' : ''}
                        {formatCents(l.display_price_cents ?? 0)}
                      </p>
                      <p className="text-xs text-slate-500">
                        {l.listing_type === 'auction'
                          ? `Silent auction · ${l.bid_count} ${l.bid_count === 1 ? 'bid' : 'bids'}`
                          : 'Set price'}
                      </p>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
