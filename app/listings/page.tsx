// app/listings/page.tsx
// Public browse page. The search, filters and results are in ListingsBrowser.
import { Suspense } from 'react'
import Link from 'next/link'
import { Home as HomeIcon } from 'lucide-react'
import { SiteHeader } from '@/components/SiteHeader'
import { ListingsBrowser } from '@/components/listing/ListingsBrowser'

export default function ListingsPage() {
  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#1E293B] flex flex-col font-sans">
      {/* Top Navigation */}
      <SiteHeader active="browse" />

      {/* Main Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 md:px-6 py-4 md:py-8">
        {/* Header & Filter Bar */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4 pb-4 md:mb-8 md:pb-6 border-b border-slate-200">
          <div>
            <div className="hidden sm:inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#A8D5BA]/40 text-[#0E4D5C] text-xs font-bold uppercase tracking-wider mb-2">
              <HomeIcon className="w-3.5 h-3.5" /> Public Marketplace
            </div>
            <h1 className="text-2xl sm:text-4xl font-extrabold text-[#1E293B] tracking-tight">
              Treasures Around You
            </h1>
            <p className="text-slate-500 text-sm mt-1">
              Browse geo-local listings openly. Create an account when you&apos;re ready to bid or buy.
            </p>
          </div>

        </div>

        <Suspense fallback={<div className="h-72 bg-slate-200 animate-pulse rounded-2xl" />}>
          <ListingsBrowser />
        </Suspense>
      </main>

      {/* Deep Teal Footer */}
      <footer className="bg-[#0E4D5C] text-white py-12 px-6 mt-16">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-8">
          <div className="space-y-2">
            <span className="text-2xl font-extrabold text-[#F26B5B]">
              Blockparty
            </span>
            <p className="text-sm text-slate-200 max-w-xs">
              Built by neighbors, for neighbors. Bid, buy, and sell safely in your neighborhood.
            </p>
          </div>

          <div className="flex flex-wrap gap-6 text-sm font-medium text-slate-200">
            <Link href="/listings" className="hover:text-white transition">
              Browse Local
            </Link>
            <Link href="/listings?type=auction" className="hover:text-white transition">
              Active Auctions
            </Link>
            <Link href="/#how-it-works" className="hover:text-white transition">
              How It Works
            </Link>
            <Link href="/signup" className="hover:text-white transition">
              Create Account
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}