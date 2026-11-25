// app/about/page.tsx
// About Blockparty: why it exists (the problems with local buy-and-sell) and
// how each one is handled here, plus the Made in Canada note.
import type { Metadata } from 'next'
import Link from 'next/link'
import {
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  CreditCard,
  HandCoins,
  HeartHandshake,
  MessageSquareOff,
  ShieldCheck,
  UserX,
} from 'lucide-react'
import { SiteHeader } from '@/components/SiteHeader'
import { SiteFooter } from '@/components/SiteFooter'
import { MadeInCanadaBadge, MapleLeaf } from '@/components/MadeInCanada'
import { PLATFORM_FEE_LABEL } from '@/lib/fees'

export const metadata: Metadata = {
  title: 'About us',
  description:
    'Blockparty was built by neighbours who were tired of cash-only deals, no-shows and haggling at the door. A local, Canadian way to buy and sell.',
}

const PROBLEMS = [
  {
    icon: CreditCard,
    problem: 'Cash or e-transfer only',
    detail: "Sellers can't take debit or credit from a stranger, so you hunt for an ATM or send money before you've seen the item.",
    fix: 'Pay by card. We place a hold when you buy, and only charge it once you have the item in your hands and give the seller your code. Sellers are paid straight to their bank.',
  },
  {
    icon: ShieldCheck,
    problem: 'Meeting strangers feels risky',
    detail: 'Anonymous profiles, carrying cash to a stranger, and nobody knowing where you went.',
    fix: "No cash changes hands. We suggest public meetup spots like police exchange zones, can let a trusted contact know where and when you're meeting, and keep a private record of where each handoff happened. Your phone number and email are never shown, and a home address is only shared once payment is on hold.",
  },
  {
    icon: CalendarClock,
    problem: 'Endless back-and-forth to arrange a pickup',
    detail: '"Still available?", "Can you do tomorrow?", "Where are you?"',
    fix: 'The seller suggests a spot and a few times, the buyer taps one, and it\'s set. Order chat and an "I\'m here" button take care of the rest, with pickup and delivery options too.',
  },
  {
    icon: HandCoins,
    problem: 'Haggling at the door',
    detail: 'You agree on a price, then the buyer shows up and offers less.',
    fix: "The price is locked in when someone buys or wins. The hold is for exactly that amount, so there's nothing to renegotiate at the meetup.",
  },
  {
    icon: UserX,
    problem: 'No-shows and flakes',
    detail: 'Hours lost waiting for someone who never comes.',
    fix: 'Buying and bidding are real commitments. No-shows get strikes, three strikes pause an account, and everyone is reviewed after every handoff.',
  },
  {
    icon: BadgeCheck,
    problem: 'Scams and "not as described"',
    detail: 'Fake payment screenshots, counterfeit bills, and items that aren\'t what the photos showed.',
    fix: "Every seller is verified by Stripe before they can list, so we know who's getting paid. Buyers check the item before handing over their code, and if it isn't as described, they cancel and the hold is released.",
  },
  {
    icon: MessageSquareOff,
    problem: 'Lowball offers and spam',
    detail: 'A flood of "would you take half?" messages for every listing.',
    fix: "Set a price and Buy Now reserves it instantly, or run an auction and let neighbours bid it up. Either way, you're not fielding offers in your inbox.",
  },
]

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#1E293B] flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        {/* Intro */}
        <section className="max-w-3xl mx-auto px-6 pt-6 pb-10 text-center">
          <MadeInCanadaBadge />
          <h1 className="mt-5 text-4xl sm:text-5xl font-extrabold tracking-tight text-[#0E4D5C]">About Blockparty</h1>
          <p className="mt-4 text-lg text-slate-600">
            Blockparty was created by neighbours like you who were tired of the usual downfalls of traditional online
            marketplaces. So we built a better way to buy, sell and bid on things locally: safer, simpler, and fair to both
            sides.
          </p>
        </section>

        {/* Problems and fixes */}
        <section className="max-w-5xl mx-auto px-6 pb-12">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-center">What we set out to fix</h2>
          <ul className="mt-8 space-y-4">
            {PROBLEMS.map(({ icon: Icon, problem, detail, fix }) => (
              <li key={problem} className="bg-white border rounded-2xl p-5 sm:p-6 shadow-sm grid sm:grid-cols-[1fr_1.4fr] gap-4 sm:gap-8">
                <div className="flex gap-4">
                  <span className="w-11 h-11 shrink-0 rounded-full bg-[#F26B5B]/10 text-[#F26B5B] flex items-center justify-center">
                    <Icon className="w-5 h-5" aria-hidden />
                  </span>
                  <div>
                    <h3 className="font-bold">{problem}</h3>
                    <p className="text-sm text-slate-500 mt-1">{detail}</p>
                  </div>
                </div>
                <div className="border-t sm:border-t-0 sm:border-l border-slate-200 pt-4 sm:pt-0 sm:pl-8">
                  <p className="text-xs font-bold uppercase tracking-wider text-[#0E4D5C]">On Blockparty</p>
                  <p className="text-sm text-slate-700 mt-1">{fix}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Fair and local */}
        <section className="max-w-5xl mx-auto px-6 pb-12 grid sm:grid-cols-2 gap-5">
          <div className="bg-white border rounded-2xl p-6 shadow-sm">
            <h2 className="text-xl font-extrabold">Fair for everyone</h2>
            <p className="text-sm text-slate-600 mt-2">
              Buyers never pay a fee. Sellers pay {PLATFORM_FEE_LABEL} of the sale, and only when something actually sells.{' '}
              <Link href="/terms#fees" className="underline">
                Fee details
              </Link>
            </p>
          </div>
          <div className="bg-white border rounded-2xl p-6 shadow-sm">
            <h2 className="text-xl font-extrabold flex items-center gap-2">
              <HeartHandshake className="w-5 h-5 text-[#F26B5B]" /> Good for the neighbourhood
            </h2>
            <p className="text-sm text-slate-600 mt-2">
              Registered Canadian charities can sell fee-free and run silent auctions to raise money.{' '}
              <Link href="/charities" className="underline">
                See the charities
              </Link>
            </p>
          </div>
        </section>

        {/* Made in Canada */}
        <section className="bg-white border-y">
          <div className="max-w-5xl mx-auto px-6 py-12 flex flex-col sm:flex-row items-center gap-8">
            <MapleLeaf className="w-28 h-28 shrink-0 text-[#D52B1E]" />
            <div className="text-center sm:text-left">
              <MadeInCanadaBadge />
              <h2 className="mt-4 text-2xl sm:text-3xl font-extrabold">Local, Canadian, and proud of it</h2>
              <p className="mt-2 text-slate-600">
                We&apos;re a local Canadian company, building Blockparty for Canadian neighbourhoods: prices in Canadian dollars,
                and meetup spots in the communities we serve. Every sale keeps good stuff moving between neighbours instead
                of into a landfill.
              </p>
            </div>
          </div>
        </section>

        {/* Call to action */}
        <section className="max-w-3xl mx-auto px-6 py-12 text-center">
          <h2 className="text-2xl sm:text-3xl font-extrabold">Come join the party</h2>
          <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/listings"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full bg-[#0E4D5C] text-white font-bold shadow-md hover:bg-[#093641] transition"
            >
              Browse listings <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              href="/signup"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full bg-[#F26B5B] text-white font-bold shadow-md hover:bg-[#e05848] transition"
            >
              Start selling
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}
