// app/page.tsx
// Homepage: what Blockparty is, real listings (auctions ending soon, just
// listed), how a sale works, the safety features, and charities.
import Link from 'next/link'
import {
  ArrowRight,
  BadgeCheck,
  CreditCard,
  Gavel,
  HeartHandshake,
  Home as HomeIcon,
  KeyRound,
  MapPin,
  Search,
  ShieldCheck,
  Star,
  Truck,
} from 'lucide-react'
import { SiteHeader } from '@/components/SiteHeader'
import { SiteFooter } from '@/components/SiteFooter'
import { HomeListings } from '@/components/home/HomeListings'
import { PLATFORM_FEE_LABEL } from '@/lib/fees'

const STEPS = [
  {
    icon: Search,
    title: 'Find it nearby',
    body: 'Browse what neighbours are selling, by area and category. Save a search to hear when something new turns up.',
  },
  {
    icon: Gavel,
    title: 'Buy it or bid',
    body: "Buy at the set price, or bid in an auction. We place a hold on your card; you aren't charged yet.",
  },
  {
    icon: MapPin,
    title: 'Hand it over',
    body: 'Meet at a safe public spot, pick up at the seller’s home, or have it delivered, if the seller offers it.',
  },
  {
    icon: KeyRound,
    title: 'Check it, then pay',
    body: 'Inspect the item. Happy? Show the seller your handoff code: your card is charged and the seller is paid.',
  },
]

const SAFETY = [
  {
    icon: CreditCard,
    title: 'Pay only at the handoff',
    body: "Your card is held, not charged, until you've seen the item and given the seller your code. Cancel before then and the hold is released.",
  },
  {
    icon: ShieldCheck,
    title: 'Safer meetups',
    body: 'Suggested public meetup spots, in-app messages, and an optional emergency contact who’s told when and where you’re meeting.',
  },
  {
    icon: BadgeCheck,
    title: 'Verified sellers',
    body: 'Sellers verify their identity and bank details with Stripe before they can list, so we always know who gets paid.',
  },
  {
    icon: Star,
    title: 'Reviews and accountability',
    body: 'Buyers and sellers review each other after every handoff, and no-shows get strikes. Block or report anyone, any time.',
  },
]

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#1E293B] flex flex-col font-sans">
      <SiteHeader />

      <main className="flex-1">
        {/* Hero */}
        <section className="max-w-6xl mx-auto px-6 pt-6 pb-8 text-center">
          <div className="max-w-2xl mx-auto space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#A8D5BA]/40 text-[#0E4D5C] text-xs font-bold uppercase tracking-wider">
              <HomeIcon className="w-3.5 h-3.5" /> Your neighbourhood marketplace
            </div>
            <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-[#F26B5B]">Blockparty</h1>
            <p className="text-xl sm:text-2xl font-medium text-[#334155]">
              Buy, sell and bid with neighbours. Pay only once you have the item in hand.
            </p>
          </div>

          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/listings"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full bg-[#0E4D5C] text-white font-bold text-lg shadow-md hover:bg-[#093641] transition"
            >
              Browse listings <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              href="/signup"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full bg-[#F26B5B] text-white font-bold text-lg shadow-md hover:bg-[#e05848] transition"
            >
              Start selling
            </Link>
          </div>
          <p className="mt-3 text-xs text-slate-500">Anyone can browse. A free account lets you buy, bid and sell.</p>
        </section>

        {/* Real listings */}
        <HomeListings />

        {/* How it works */}
        <section id="how-it-works" className="scroll-mt-24 max-w-6xl mx-auto px-6 py-12">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-center">How it works</h2>
          <ol className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {STEPS.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="bg-white rounded-2xl border p-5 shadow-sm">
                <div className="flex items-center gap-3 mb-3">
                  <span className="w-10 h-10 rounded-full bg-[#0E4D5C] text-white flex items-center justify-center font-extrabold">
                    {i + 1}
                  </span>
                  <Icon className="w-6 h-6 text-[#F26B5B]" aria-hidden />
                </div>
                <h3 className="font-bold text-lg">{title}</h3>
                <p className="text-sm text-slate-600 mt-1">{body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-center text-sm text-slate-500">
            Buyers pay no fees. Sellers pay {PLATFORM_FEE_LABEL} of the sale, only when it sells.{' '}
            <Link href="/terms#fees" className="underline">
              Fee details
            </Link>
          </p>
        </section>

        {/* Safety */}
        <section className="bg-[#A8D5BA]/30 py-12">
          <div className="max-w-6xl mx-auto px-6">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-center text-[#0E4D5C]">Built for safe, local trades</h2>
            <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-5">
              {SAFETY.map(({ icon: Icon, title, body }) => (
                <div key={title} className="bg-white rounded-2xl p-5 shadow-sm flex gap-4">
                  <span className="w-12 h-12 shrink-0 rounded-full bg-[#0E4D5C] text-[#A8D5BA] flex items-center justify-center">
                    <Icon className="w-6 h-6" aria-hidden />
                  </span>
                  <div>
                    <h3 className="font-bold">{title}</h3>
                    <p className="text-sm text-slate-600 mt-1">{body}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-6 text-center text-sm text-[#0E4D5C] flex items-center justify-center gap-2">
              <Truck className="w-4 h-4" aria-hidden /> No shipping, no boxes: everything changes hands locally.
            </p>
          </div>
        </section>

        {/* Charities */}
        <section className="max-w-6xl mx-auto px-6 py-12">
          <div className="rounded-3xl bg-white border p-6 sm:p-10 shadow-sm flex flex-col md:flex-row md:items-center gap-6">
            <span className="w-16 h-16 shrink-0 rounded-full bg-[#F4A261]/25 text-[#F26B5B] flex items-center justify-center">
              <HeartHandshake className="w-8 h-8" aria-hidden />
            </span>
            <div className="flex-1">
              <h2 className="text-xl sm:text-2xl font-extrabold">Support local charities</h2>
              <p className="text-slate-600 mt-1">
                Registered Canadian charities sell on Blockparty fee-free, up to a yearly allowance, and can run silent
                auctions for fundraising.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 shrink-0">
              <Link href="/charities" className="px-5 py-3 rounded-full bg-[#0E4D5C] text-white font-bold text-center">
                See charities
              </Link>
              <Link
                href="/charities/apply"
                className="px-5 py-3 rounded-full border-2 border-[#0E4D5C] text-[#0E4D5C] font-bold text-center"
              >
                Apply as a charity
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
