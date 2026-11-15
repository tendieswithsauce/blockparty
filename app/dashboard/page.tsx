// app/dashboard/page.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  CheckCircle2,
  Circle,
  CreditCard,
  Gavel,
  Landmark,
  MapPin,
  Package,
  PlusCircle,
  ShoppingBag,
  Tag,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { hubName } from '@/lib/hubs'
import { formatCents } from '@/lib/money'
import { SiteHeader } from '@/components/SiteHeader'
import { CreateListingModal } from '@/components/dashboard/CreateListingModal'
import { PayoutDashboardButton, SetUpPayoutsButton } from '@/components/dashboard/PayoutButton'
import { getPayoutStatus } from '@/app/payouts/actions'
import type { PayoutStatus } from '@/lib/stripe/connect'

type MyListing = {
  id: number
  title: string
  listing_type: 'fixed' | 'auction'
  status: string
  image_paths: string[]
  buy_now_price_cents: number | null
  starting_price_cents: number | null
  current_bid_cents: number | null
  bid_count: number
  ends_at: string | null
}

type MyBid = {
  id: number
  amount_cents: number
  created_at: string
  listing: { id: number; title: string; current_bid_cents: number | null; ends_at: string | null; status: string } | null
}

type MyPurchase = { id: number; amount_cents: number; status: string; created_at: string; listing_id: number }

type DashboardData = {
  firstName: string
  preferredHub: string | null
  hasCard: boolean
  listings: MyListing[]
  bids: MyBid[]
  purchases: MyPurchase[]
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  sold: 'Sold',
  pending_pickup: 'Awaiting pickup',
  complete: 'Complete',
  inactive: 'Inactive',
  incomplete: 'Draft',
  pending: 'Pending',
  authorized: 'Paid, held',
  dropped_off: 'At hub',
  completed: 'Picked up',
  canceled: 'Canceled',
  refunded: 'Refunded',
}

function listingPrice(l: MyListing) {
  if (l.listing_type === 'fixed') return formatCents(l.buy_now_price_cents ?? 0)
  return formatCents(l.current_bid_cents ?? l.starting_price_cents ?? 0)
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [payouts, setPayouts] = useState<PayoutStatus | null | undefined>(undefined)
  const [showModal, setShowModal] = useState(false)
  const [showPayoutPrompt, setShowPayoutPrompt] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'info' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      // Session was revoked (e.g. signed out on another device): start over.
      window.location.assign('/login?next=/dashboard')
      return
    }

    const [profileRes, listingsRes, bidsRes, purchasesRes] = await Promise.all([
      supabase.from('profiles').select('full_name, preferred_hub, stripe_payment_method_id').eq('id', user.id).single(),
      supabase
        .from('listings')
        .select('id, title, listing_type, status, image_paths, buy_now_price_cents, starting_price_cents, current_bid_cents, bid_count, ends_at')
        .eq('seller_id', user.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('bids')
        .select('id, amount_cents, created_at, listing:listings(id, title, current_bid_cents, ends_at, status)')
        .eq('bidder_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('transactions')
        .select('id, amount_cents, status, created_at, listing_id')
        .eq('buyer_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20),
    ])

    const profile = profileRes.data
    setData({
      firstName: profile?.full_name?.split(' ')[0] ?? '',
      preferredHub: profile?.preferred_hub ?? null,
      hasCard: Boolean(profile?.stripe_payment_method_id),
      listings: (listingsRes.data ?? []) as MyListing[],
      bids: (bidsRes.data ?? []) as unknown as MyBid[],
      purchases: (purchasesRes.data ?? []) as MyPurchase[],
    })
  }, [])

  useEffect(() => {
    // Message after returning from Stripe payout onboarding.
    const params = new URLSearchParams(window.location.search)
    const result = params.get('payouts')
    if (result) {
      window.history.replaceState(null, '', window.location.pathname)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the URL after the Stripe redirect
      setNotice(
        result === 'ready'
          ? { kind: 'success', text: "Payouts are set up. You're ready to sell!" }
          : result === 'pending'
            ? { kind: 'info', text: 'Stripe still needs a few details before you can get paid. Pick up where you left off any time.' }
            : { kind: 'error', text: 'Something went wrong opening payout setup. Please try again.' },
      )
    }
    load()
    getPayoutStatus()
      .then(setPayouts)
      .catch(() => setPayouts(null))
  }, [load])

  const payoutsReady = payouts?.ready === true

  function onCreateClick() {
    if (payoutsReady) setShowModal(true)
    else setShowPayoutPrompt(true)
  }

  const activeListings = data?.listings.filter((l) => l.status === 'active') ?? []
  const soldCount = data?.listings.filter((l) => ['sold', 'pending_pickup', 'complete'].includes(l.status)).length ?? 0

  const steps = [
    {
      done: Boolean(data?.hasCard),
      icon: CreditCard,
      title: 'Add a payment method',
      body: 'Needed to bid or buy. You are only charged when you win or use Buy Now.',
      action: (
        <Link href="/profile#payment-method" className="px-4 py-2 rounded-full bg-[#0E4D5C] text-white text-sm font-semibold hover:bg-[#0b3f4b]">
          Add payment method
        </Link>
      ),
    },
    {
      done: payoutsReady,
      icon: Landmark,
      title: 'Set up payouts',
      body: 'Connect a bank account with Stripe so we can pay you when your item is picked up.',
      action: <SetUpPayoutsButton label={payouts?.accountId ? 'Finish payout setup' : 'Set up payouts'} />,
    },
    {
      done: Boolean(data?.preferredHub),
      icon: MapPin,
      title: 'Pick your exchange hub',
      body: data?.preferredHub ? `Your default hub is ${hubName(data.preferredHub)}.` : 'Where you usually drop off and pick up items.',
      action: (
        <Link href="/profile" className="px-4 py-2 rounded-full border-2 border-[#0E4D5C] text-[#0E4D5C] text-sm font-semibold hover:bg-[#0E4D5C]/5">
          Choose hub
        </Link>
      ),
    },
    {
      done: (data?.listings.length ?? 0) > 0,
      icon: Tag,
      title: 'List your first item',
      body: 'Snap a few photos, set a price or start an auction.',
      action: (
        <button onClick={onCreateClick} className="px-4 py-2 rounded-full bg-[#F26B5B] text-white text-sm font-semibold hover:bg-[#e05a4a]">
          Create listing
        </button>
      ),
    },
  ]
  const stepsDone = steps.filter((s) => s.done).length

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#1E293B]">
      <SiteHeader />
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        <div className="flex flex-wrap gap-4 justify-between items-center">
          <div>
            <h1 className="text-3xl font-extrabold text-[#0E4D5C]">
              {data?.firstName ? `Hi, ${data.firstName}` : 'Your dashboard'}
            </h1>
            <p className="text-slate-500">Everything you&apos;re buying and selling on Blockparty.</p>
          </div>
          <button
            onClick={onCreateClick}
            className="flex items-center gap-2 bg-[#F26B5B] text-white px-5 py-2.5 rounded-full font-semibold hover:bg-[#e05a4a] transition"
          >
            <PlusCircle className="w-4 h-4" />
            Create new listing
          </button>
        </div>

        {notice && (
          <div
            className={`p-4 rounded-xl text-sm ${
              notice.kind === 'success'
                ? 'bg-green-50 text-green-800'
                : notice.kind === 'info'
                  ? 'bg-amber-50 text-amber-800'
                  : 'bg-red-50 text-red-700'
            }`}
          >
            {notice.text}
          </div>
        )}

        {/* Getting started */}
        {data && stepsDone < steps.length && (
          <section className="bg-white border rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Get set up</h2>
              <span className="text-sm text-slate-500">
                {stepsDone} of {steps.length} done
              </span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 mb-6 overflow-hidden">
              <div className="h-full bg-[#0E4D5C] transition-all" style={{ width: `${(stepsDone / steps.length) * 100}%` }} />
            </div>
            <ul className="divide-y">
              {steps.map((step) => (
                <li key={step.title} className="flex flex-wrap items-center gap-4 py-4">
                  {step.done ? (
                    <CheckCircle2 className="w-6 h-6 text-green-600 shrink-0" />
                  ) : (
                    <Circle className="w-6 h-6 text-slate-300 shrink-0" />
                  )}
                  <step.icon className="w-5 h-5 text-[#0E4D5C] shrink-0" />
                  <div className="flex-1 min-w-[200px]">
                    <p className={`font-semibold ${step.done ? 'text-slate-400 line-through' : ''}`}>{step.title}</p>
                    <p className="text-sm text-slate-500">{step.body}</p>
                  </div>
                  {!step.done && step.action}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Stats */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Active listings', value: activeListings.length, icon: Package },
            { label: 'Items sold', value: soldCount, icon: ShoppingBag },
            { label: 'Bids placed', value: data?.bids.length ?? 0, icon: Gavel },
            { label: 'Purchases', value: data?.purchases.length ?? 0, icon: CreditCard },
          ].map((stat) => (
            <div key={stat.label} className="bg-white border rounded-2xl p-5 shadow-sm">
              <stat.icon className="w-5 h-5 text-[#F26B5B] mb-3" />
              <p className="text-3xl font-extrabold">{data ? stat.value : '–'}</p>
              <p className="text-sm text-slate-500">{stat.label}</p>
            </div>
          ))}
        </section>

        {payoutsReady && (
          <div className="flex items-center justify-between bg-white border rounded-2xl px-6 py-4 shadow-sm">
            <span className="flex items-center gap-2 text-sm">
              <Landmark className="w-4 h-4 text-green-600" /> Payouts are active. Earnings are sent to your bank after pickup.
            </span>
            <PayoutDashboardButton />
          </div>
        )}

        {/* Listings */}
        <section className="bg-white border rounded-2xl p-6 shadow-sm">
          <h2 className="text-lg font-bold mb-4">Your listings</h2>
          {!data ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : data.listings.length === 0 ? (
            <EmptyState
              icon={Tag}
              title="Nothing listed yet"
              body="Turn the stuff you don't need into cash. Neighbours pick it up at your exchange hub, and you get paid once they do."
              action={
                <button onClick={onCreateClick} className="px-4 py-2 rounded-full bg-[#F26B5B] text-white text-sm font-semibold hover:bg-[#e05a4a]">
                  List your first item
                </button>
              }
            />
          ) : (
            <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.listings.map((l) => (
                <li key={l.id} className="border rounded-xl overflow-hidden">
                  <div className="aspect-[4/3] bg-slate-100">
                    {l.image_paths?.[0] && (
                      // eslint-disable-next-line @next/next/no-img-element -- Supabase public URL
                      <img
                        src={createClient().storage.from('listing-photos').getPublicUrl(l.image_paths[0]).data.publicUrl}
                        alt={l.title}
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold line-clamp-1">{l.title}</p>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 shrink-0">
                        {STATUS_LABELS[l.status] ?? l.status}
                      </span>
                    </div>
                    <p className="text-[#0E4D5C] font-bold mt-1">{listingPrice(l)}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      {l.listing_type === 'auction'
                        ? `${l.bid_count} ${l.bid_count === 1 ? 'bid' : 'bids'}${l.ends_at ? ` · ends ${new Date(l.ends_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}` : ''}`
                        : 'Buy Now'}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Bids */}
          <section className="bg-white border rounded-2xl p-6 shadow-sm">
            <h2 className="text-lg font-bold mb-4">Your bids</h2>
            {!data ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : data.bids.length === 0 ? (
              <EmptyState
                icon={Gavel}
                title="No bids yet"
                body="Find something you like and place a bid. We'll only charge your card if you win."
                action={<BrowseLink />}
              />
            ) : (
              <ul className="divide-y">
                {data.bids.map((b) => (
                  <li key={b.id} className="py-3 flex justify-between gap-4 text-sm">
                    <span className="font-medium line-clamp-1">{b.listing?.title ?? 'Listing'}</span>
                    <span className="shrink-0">
                      {formatCents(b.amount_cents)}
                      {b.listing?.current_bid_cents === b.amount_cents ? (
                        <span className="ml-2 text-green-700 font-semibold">Winning</span>
                      ) : (
                        <span className="ml-2 text-amber-700 font-semibold">Outbid</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Purchases */}
          <section className="bg-white border rounded-2xl p-6 shadow-sm">
            <h2 className="text-lg font-bold mb-4">Purchases</h2>
            {!data ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : data.purchases.length === 0 ? (
              <EmptyState
                icon={ShoppingBag}
                title="No purchases yet"
                body="When you buy something, your payment is held safely until you pick it up at the hub."
                action={<BrowseLink />}
              />
            ) : (
              <ul className="divide-y">
                {data.purchases.map((p) => (
                  <li key={p.id} className="py-3 flex justify-between gap-4 text-sm">
                    <span>Order #{p.id}</span>
                    <span>
                      {formatCents(p.amount_cents)} · {STATUS_LABELS[p.status] ?? p.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {showPayoutPrompt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true">
          <div className="bg-white max-w-md w-full p-6 rounded-2xl space-y-4">
            <Landmark className="w-8 h-8 text-[#0E4D5C]" />
            <h2 className="text-xl font-bold">Set up payouts first</h2>
            <p className="text-slate-600 text-sm">
              Before you list an item, connect a bank account with Stripe so we can send you the money once your buyer picks it up.
              It takes about 5 minutes.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setShowPayoutPrompt(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
                Not now
              </button>
              <SetUpPayoutsButton label={payouts?.accountId ? 'Finish payout setup' : 'Set up payouts'} />
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <CreateListingModal
          defaultHub={data?.preferredHub ?? undefined}
          onClose={() => setShowModal(false)}
          onCreated={() => {
            setShowModal(false)
            setNotice({ kind: 'success', text: 'Your listing is live!' })
            load()
          }}
        />
      )}
    </div>
  )
}

function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  body: string
  action?: React.ReactNode
}) {
  return (
    <div className="text-center py-10 px-4 border-2 border-dashed border-slate-200 rounded-xl">
      <Icon className="w-10 h-10 mx-auto text-slate-300 mb-3" />
      <p className="font-semibold">{title}</p>
      <p className="text-sm text-slate-500 max-w-sm mx-auto mt-1 mb-4">{body}</p>
      {action}
    </div>
  )
}

function BrowseLink() {
  return (
    <Link
      href="/listings"
      className="inline-block px-4 py-2 rounded-full border-2 border-[#0E4D5C] text-[#0E4D5C] text-sm font-semibold hover:bg-[#0E4D5C]/5"
    >
      Browse listings
    </Link>
  )
}
