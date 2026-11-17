// app/charities/page.tsx
// Charity section: registered charities raising money on Blockparty.
import { Suspense } from 'react'
import Link from 'next/link'
import { connection } from 'next/server'
import { HeartHandshake, MapPin } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { SiteHeader } from '@/components/SiteHeader'

export default function CharitiesPage() {
  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#1E293B]">
      <SiteHeader active="charities" />
      <main className="max-w-6xl mx-auto px-6 pb-16 space-y-8">
        <section className="bg-white border rounded-2xl p-8 shadow-sm flex flex-wrap items-center gap-6">
          <HeartHandshake className="w-12 h-12 text-[#F26B5B] shrink-0" />
          <div className="flex-1 min-w-[260px]">
            <h1 className="text-3xl font-extrabold text-[#0E4D5C]">Shop for a cause</h1>
            <p className="text-slate-600 mt-1">
              Registered Canadian charities sell donated items here. Their auctions are silent: bids are hidden, so you bid
              what it&apos;s worth to you, and the money goes to the charity.
            </p>
          </div>
          <Link
            href="/charities/apply"
            className="px-5 py-2.5 rounded-full border-2 border-[#0E4D5C] text-[#0E4D5C] font-semibold hover:bg-[#0E4D5C]/5"
          >
            Sell for your charity
          </Link>
        </section>
        <Suspense fallback={<div className="h-40 rounded-2xl bg-slate-200 animate-pulse" />}>
          <Directory />
        </Suspense>
      </main>
    </div>
  )
}

async function Directory() {
  await connection()
  const supabase = await createClient()
  const { data: charities } = await supabase.rpc('charity_directory')
  if (!charities?.length) {
    return (
      <p className="text-slate-500">
        No charities yet. If you run one,{' '}
        <Link href="/charities/apply" className="text-[#0E4D5C] underline">
          apply to sell here
        </Link>
        .
      </p>
    )
  }
  return (
    <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {charities.map((c) => (
        <li key={c.id}>
          <Link href={`/charities/${c.slug}`} className="block bg-white border rounded-2xl p-5 shadow-sm hover:border-[#0E4D5C] h-full">
            <p className="font-bold text-lg">{c.name}</p>
            {c.city && (
              <p className="text-sm text-slate-500 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" />
                {c.city.charAt(0) + c.city.slice(1).toLowerCase()}
                {c.province ? `, ${c.province}` : ''}
              </p>
            )}
            {c.description && <p className="text-sm text-slate-600 mt-2 line-clamp-3">{c.description}</p>}
            <p className="text-sm font-semibold text-[#F26B5B] mt-3">
              {c.active_listings} {c.active_listings === 1 ? 'item' : 'items'} for sale
            </p>
          </Link>
        </li>
      ))}
    </ul>
  )
}
