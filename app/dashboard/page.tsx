// app/dashboard/page.tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  CheckCircle2,
  Circle,
  CreditCard,
  Gavel,
  Heart,
  Landmark,
  MapPin,
  Package,
  PlusCircle,
  RotateCcw,
  ShoppingBag,
  Tag,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { areaLabel } from '@/lib/areas'
import { formatMeetupTime } from '@/lib/orders'
import { formatCents } from '@/lib/money'
import { MIN_PRICE_CENTS } from '@/lib/fees'
import { SiteHeader } from '@/components/SiteHeader'
import { LISTING_CREATED_EVENT } from '@/components/SellSheet'
import type { ModerationResult } from '@/lib/moderation/check-listing'
import { CreateListingModal } from '@/components/dashboard/CreateListingModal'
import { SavedSearches } from '@/components/dashboard/SavedSearches'
import { ConvertToAuctionModal } from '@/components/dashboard/ConvertToAuctionModal'
import { RelistAuctionModal } from '@/components/dashboard/RelistAuctionModal'
import { PayoutDashboardButton, SetUpPayoutsButton } from '@/components/dashboard/PayoutButton'
import { getPayoutStatus } from '@/app/payouts/actions'
import type { PayoutStatus } from '@/lib/stripe/connect'
import { SecuredByStripe, StripeBadge } from '@/components/StripeBadge'

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
  has_reserve: boolean
  reserve_met: boolean
  reserve: { reserve_cents: number } | null
  watch_count: number
  converted_at: string | null
  relisted_as: number | null
  review_status: 'pending' | 'approved' | 'rejected'
  moderation_reason: string | null
}

type Watched = {
  listing_id: number
  /** Null once it's no longer public (sold or taken down). */
  listing: {
    id: number
    title: string
    listing_type: 'fixed' | 'auction'
    status: string
    buy_now_price_cents: number | null
    display_price_cents: number | null
    ends_at: string | null
  } | null
}

type MyBid = {
  id: number
  listing_id: number
  amount_cents: number
  created_at: string
  listing: { id: number; title: string; current_bid_cents: number | null; ends_at: string | null; status: string; silent: boolean } | null
  /** Worked out when loading (needs the clock). */
  state: 'winning' | 'outbid' | 'silent' | 'won' | 'ended'
}

type MyOrder = {
  id: number
  amount_cents: number
  platform_fee_cents: number
  status: string
  created_at: string
  listing_id: number
  seller_id: string
  proposed_times: string[] | null
  proposed_by: string | null
  picked_up_at: string | null
  /** Completed in the last 14 days and you haven't reviewed it yet (worked out when loading). */
  needsReview?: boolean
  meetup_at: string | null
  listing: { title: string; area: { name: string; city: string; timezone: string } | null } | null
}

const ORDER_COLUMNS =
  'id, seller_id, amount_cents, platform_fee_cents, status, created_at, listing_id, proposed_times, proposed_by, meetup_at, picked_up_at, listing:listings(title, area:areas(name, city, timezone))'

type DashboardData = {
  firstName: string
  areaId: string | null
  area: { name: string; city: string } | null
  hasCard: boolean
  listings: MyListing[]
  bids: MyBid[]
  purchases: MyOrder[]
  sales: MyOrder[]
  watching: Watched[]
  /** Your active no-show strikes, soonest to expire first. */
  strikes: { expires_at: string }[]
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  sold: 'Sold',
  pending_pickup: 'Awaiting pickup',
  complete: 'Complete',
  inactive: 'Inactive',
  incomplete: 'Draft',
  pending: 'Pending',
  authorized: 'Arranging meetup',
  completed: 'Done',
  canceled: 'Canceled',
  refunded: 'Refunded',
}

type ListingTab = 'active' | 'sold' | 'inactive'
const LISTING_TABS: { id: ListingTab; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'sold', label: 'Sold' },
  { id: 'inactive', label: 'Inactive' },
]
function listingTab(l: { status: string }): ListingTab {
  if (l.status === 'active') return 'active'
  if (['sold', 'pending_pickup', 'complete'].includes(l.status)) return 'sold'
  return 'inactive'
}

const BID_STATE_LABELS: Record<MyBid['state'], string> = {
  winning: 'Winning',
  outbid: 'Outbid',
  silent: 'Silent bid',
  won: 'Won',
  ended: 'Ended',
}

/** What to tell the seller after they create a listing. */
function createdNotice(result: ModerationResult): { kind: 'success' | 'info'; text: string } {
  return result === 'approved'
    ? { kind: 'success', text: 'Your listing is live!' }
    : result === 'held'
      ? { kind: 'info', text: "Thanks! We're taking a closer look at your listing before it goes live. We'll let you know." }
      : { kind: 'info', text: "Your listing is saved. It'll go live in a minute or two, once our automatic check finishes." }
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
  const [converting, setConverting] = useState<MyListing | null>(null)
  const [listingView, setListingView] = useState<ListingTab>('active')
  const [relisting, setRelisting] = useState<number | null>(null)
  const [relistingAuction, setRelistingAuction] = useState<MyListing | null>(null)
  const payoutReturn = useRef<string | null | undefined>(undefined)
  const [notice, setNotice] = useState<{ kind: 'success' | 'info' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      // Session was revoked (e.g. signed out on another device): start over.
      window.location.assign('/login?next=/dashboard')
      return
    }

    const [profileRes, listingsRes, bidsRes, purchasesRes, salesRes, watchRes, strikesRes, myReviewsRes] = await Promise.all([
      supabase.from('profiles').select('full_name, area_id, stripe_payment_method_id, area:areas(name, city)').eq('id', user.id).single(),
      supabase
        .from('listings')
        .select('id, title, listing_type, status, image_paths, buy_now_price_cents, starting_price_cents, current_bid_cents, bid_count, ends_at, has_reserve, reserve_met, watch_count, converted_at, relisted_as, review_status, moderation_reason, reserve:listing_reserves(reserve_cents)')
        .eq('seller_id', user.id)
        .order('created_at', { ascending: false }),
      // Bidder ids aren't readable through the API; my_bids() returns your own (newest first).
      supabase
        .rpc('my_bids', { p_limit: 50 })
        .select('id, listing_id, amount_cents, created_at, listing:listings!bids_listing_id_fkey(id, title, current_bid_cents, ends_at, status, silent)'),
      supabase
        .from('transactions')
        .select(ORDER_COLUMNS)
        .eq('buyer_id', user.id)
        .in('status', ['authorized', 'completed', 'refunded'])
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('transactions')
        .select(ORDER_COLUMNS)
        .eq('seller_id', user.id)
        .in('status', ['authorized', 'completed', 'refunded'])
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('watchlist')
        .select('listing_id, listing:listings(id, title, listing_type, status, buy_now_price_cents, display_price_cents, ends_at)')
        .order('created_at', { ascending: false })
        .limit(30),
      supabase
        .from('strikes')
        .select('expires_at')
        .is('voided_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('expires_at'),
      supabase.from('reviews').select('transaction_id').eq('reviewer_id', user.id),
    ])

    const profile = profileRes.data
    const purchases = (purchasesRes.data ?? []) as unknown as MyOrder[]
    // One row per auction (your latest bid is your highest), with where it stands.
    const now = Date.now()
    const reviewed = new Set((myReviewsRes.data ?? []).map((r) => r.transaction_id))
    const markReview = (o: MyOrder): MyOrder => ({
      ...o,
      needsReview:
        o.status === 'completed' &&
        !reviewed.has(o.id) &&
        !!o.picked_up_at &&
        now - new Date(o.picked_up_at).getTime() < 14 * 86_400_000,
    })
    const seen = new Set<number>()
    const bids: MyBid[] = []
    for (const b of (bidsRes.data ?? []) as unknown as Omit<MyBid, 'state'>[]) {
      if (seen.has(b.listing_id)) continue
      seen.add(b.listing_id)
      const l = b.listing
      const live = l && l.status === 'active' && (!l.ends_at || new Date(l.ends_at).getTime() > now)
      const state: MyBid['state'] = live
        ? l.silent ? 'silent' : l.current_bid_cents === b.amount_cents ? 'winning' : 'outbid'
        : l && purchases.some((p) => p.listing_id === l.id) ? 'won' : 'ended'
      bids.push({ ...b, state })
      if (bids.length === 20) break
    }
    setData({
      firstName: profile?.full_name?.split(' ')[0] ?? '',
      areaId: profile?.area_id ?? null,
      area: (profile?.area as { name: string; city: string } | null) ?? null,
      hasCard: Boolean(profile?.stripe_payment_method_id),
      listings: (listingsRes.data ?? []) as MyListing[],
      bids,
      purchases: purchases.map(markReview),
      sales: ((salesRes.data ?? []) as unknown as MyOrder[]).map(markReview),
      watching: (watchRes.data ?? []) as unknown as Watched[],
      strikes: strikesRes.data ?? [],
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    const READY_NOTICE = { kind: 'success', text: "Payouts are set up. You're ready to sell!" } as const
    const PENDING_NOTICE = {
      kind: 'info',
      text: 'Stripe still needs a few details before you can get paid. Pick up where you left off any time.',
    } as const

    // Message after returning from Stripe payout onboarding. Read the URL only
    // once (we strip it right away) so a re-run of this effect still knows.
    if (payoutReturn.current === undefined) {
      payoutReturn.current = new URLSearchParams(window.location.search).get('payouts')
      if (payoutReturn.current) window.history.replaceState(null, '', window.location.pathname)
    }
    const result = payoutReturn.current
    if (result) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the URL after the Stripe redirect
      setNotice(
        result === 'ready'
          ? READY_NOTICE
          : result === 'pending'
            ? { kind: 'info', text: 'Checking your payout setup with Stripe…' }
            : { kind: 'error', text: 'Something went wrong opening payout setup. Please try again.' },
      )
    }
    load()

    // Stripe usually takes a few seconds to verify a seller after they submit
    // onboarding, so right after returning keep re-checking for a little while
    // before telling them something is still missing.
    async function checkPayouts() {
      const attempts = result === 'pending' ? 6 : 1
      for (let i = 0; i < attempts; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 2000))
        if (cancelled) return
        const status = await getPayoutStatus().catch(() => null)
        if (cancelled) return
        setPayouts(status)
        if (status?.ready) {
          if (result === 'pending') setNotice(READY_NOTICE)
          return
        }
      }
      if (result === 'pending') setNotice(PENDING_NOTICE)
    }
    checkPayouts()

    return () => {
      cancelled = true
    }
  }, [load])

  const payoutsReady = payouts?.ready === true

  function onCreateClick() {
    if (payoutsReady) setShowModal(true)
    else setShowPayoutPrompt(true)
  }

  // A listing created from the phone tab bar's Sell sheet (components/SellSheet).
  useEffect(() => {
    const onCreated = (e: Event) => {
      setNotice(createdNotice((e as CustomEvent<ModerationResult>).detail))
      load()
    }
    window.addEventListener(LISTING_CREATED_EVENT, onCreated)
    return () => window.removeEventListener(LISTING_CREATED_EVENT, onCreated)
  }, [load])

  const activeListings = data?.listings.filter((l) => l.status === 'active') ?? []
  const shownListings = data?.listings.filter((l) => listingTab(l) === listingView) ?? []

  async function relist(l: MyListing) {
    setRelisting(l.id)
    const { error } = await createClient().rpc('relist_listing', { p_listing_id: l.id })
    setRelisting(null)
    if (error) {
      setNotice({ kind: 'error', text: error.code === 'P0001' ? `${error.message}.` : 'Could not relist it. Please try again.' })
      return
    }
    setNotice({ kind: 'success', text: `${l.title} is back up.` })
    setListingView('active')
    load()
  }
  const soldCount = data?.listings.filter((l) => ['sold', 'pending_pickup', 'complete'].includes(l.status)).length ?? 0

  const steps = [
    {
      done: Boolean(data?.hasCard),
      icon: CreditCard,
      title: 'Add a payment method',
      body: 'Needed to bid or buy. You are only charged after you meet the seller and accept the item.',
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
      done: Boolean(data?.area),
      icon: MapPin,
      title: 'Set your area',
      body: data?.area
        ? `You're in ${areaLabel(data.area)}.`
        : 'So we can suggest meetup spots that are fair to you and the other person.',
      action: (
        <Link href="/profile" className="px-4 py-2 rounded-full border-2 border-[#0E4D5C] text-[#0E4D5C] text-sm font-semibold hover:bg-[#0E4D5C]/5">
          Choose area
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

        {data && data.strikes.length > 0 && (
          <div className={`p-4 rounded-xl text-sm ${data.strikes.length >= 3 ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}`}>
            <p className="font-semibold">
              {data.strikes.length >= 3
                ? `Buying, bidding and selling are paused until ${new Date(data.strikes[0].expires_at).toLocaleDateString('en-CA', { month: 'long', day: 'numeric' })}`
                : `You have ${data.strikes.length} no-show ${data.strikes.length === 1 ? 'strike' : 'strikes'}`}
            </p>
            <p className="mt-1">
              You get a strike when someone reports you didn&apos;t show up to an agreed meetup. Strikes expire after 90 days; with 3,
              buying, bidding and selling are paused. Tap &ldquo;I&apos;m here&rdquo; on the order page when you arrive: it counts as
              proof you showed up.
            </p>
          </div>
        )}

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
            <SecuredByStripe className="mb-2" text="Cards and payouts are handled by Stripe." />
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
              <Landmark className="w-4 h-4 text-green-600" /> Payouts are active. Earnings are sent to your bank as soon as the buyer accepts the item.
            </span>
            <div className="flex items-center gap-3">
              <StripeBadge size="sm" />
              <PayoutDashboardButton />
            </div>
          </div>
        )}

        {/* Listings */}
        <section className="bg-white border rounded-2xl p-4 sm:p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-lg font-bold">Your listings</h2>
            {data && data.listings.length > 0 && (
              <div role="tablist" aria-label="Listing status" className="inline-flex rounded-full bg-slate-100 p-1 text-sm font-semibold">
                {LISTING_TABS.map((t) => {
                  const count = data.listings.filter((l) => listingTab(l) === t.id).length
                  const on = listingView === t.id
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => setListingView(t.id)}
                      className={`px-3 py-1.5 rounded-full ${on ? 'bg-white text-[#0E4D5C] shadow-sm' : 'text-slate-500'}`}
                    >
                      {t.label} <span className="font-normal">{count}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          {!data ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : data.listings.length === 0 ? (
            <EmptyState
              icon={Tag}
              title="Nothing listed yet"
              body="Turn the stuff you don't need into cash. You meet buyers at a safe public spot and get paid the moment they accept the item."
              action={
                <button onClick={onCreateClick} className="px-4 py-2 rounded-full bg-[#F26B5B] text-white text-sm font-semibold hover:bg-[#e05a4a]">
                  List your first item
                </button>
              }
            />
          ) : shownListings.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">
              {listingView === 'active' ? 'Nothing live right now.' : listingView === 'sold' ? 'Nothing sold yet.' : 'No inactive listings.'}
            </p>
          ) : (
            <ul className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {shownListings.map((l) => {
                const live = l.status === 'active'
                return (
                  <li key={l.id} className="border rounded-xl overflow-hidden flex flex-col">
                    <div className="relative aspect-[4/3] bg-slate-100">
                      {l.image_paths?.[0] && (
                        // eslint-disable-next-line @next/next/no-img-element -- Supabase public URL
                        <img
                          src={createClient().storage.from('listing-photos').getPublicUrl(l.image_paths[0]).data.publicUrl}
                          alt={l.title}
                          className={`w-full h-full object-cover ${live ? '' : 'grayscale'}`}
                        />
                      )}
                      {/* Grey wash over anything that isn't live. */}
                      {!live && <div className="absolute inset-0 bg-slate-500/40" aria-hidden />}
                      <span
                        className={`absolute top-2 left-2 text-[11px] font-bold px-2 py-0.5 rounded-full ${
                          live ? 'bg-white/90 text-[#0E4D5C]' : 'bg-slate-700/90 text-white'
                        }`}
                      >
                        {l.review_status === 'pending' && live
                          ? 'In review'
                          : l.review_status === 'rejected'
                            ? 'Not approved'
                            : (STATUS_LABELS[l.status] ?? l.status)}
                      </span>
                    </div>
                    <div className={`p-3 sm:p-4 flex-1 ${live ? '' : 'bg-slate-50'}`}>
                      <Link
                        href={`/listings/${l.id}`}
                        className={`block text-sm sm:text-base font-semibold line-clamp-2 sm:line-clamp-1 hover:text-[#F26B5B] ${live ? '' : 'text-slate-500'}`}
                      >
                        {l.title}
                      </Link>
                      <p className={`font-bold mt-1 ${live ? 'text-[#0E4D5C]' : 'text-slate-500'}`}>{listingPrice(l)}</p>
                      {l.review_status !== 'approved' && (live || l.review_status === 'rejected') && (
                        <p className={`text-xs mt-1 ${l.review_status === 'rejected' ? 'text-red-700' : 'text-amber-800'}`}>
                          {l.review_status === 'rejected'
                            ? (l.moderation_reason ?? "It doesn't meet our listing rules.")
                            : l.moderation_reason
                              ? `Being reviewed: ${l.moderation_reason}`
                              : 'Being checked. It goes live in a minute or two.'}
                        </p>
                      )}
                      <p className="text-xs text-slate-500 mt-1">
                        {l.listing_type === 'auction'
                          ? `${l.bid_count} ${l.bid_count === 1 ? 'bid' : 'bids'}${l.ends_at ? ` · ${live ? 'ends' : 'ended'} ${new Date(l.ends_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}` : ''}${l.reserve ? ` · reserve ${formatCents(l.reserve.reserve_cents)}${l.reserve_met ? ' (met)' : ''}` : ' · no reserve'}`
                          : 'Set Price'}
                        {l.watch_count > 0 && ` · ${l.watch_count} watching`}
                      </p>
                      {l.listing_type === 'fixed' && live && !l.converted_at && (
                        <button
                          type="button"
                          onClick={() => setConverting(l)}
                          className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-[#0E4D5C] hover:text-[#F26B5B]"
                        >
                          <Gavel className="w-4 h-4" /> Switch to auction
                        </button>
                      )}
                      {l.listing_type === 'fixed' && l.status === 'inactive' && l.review_status !== 'rejected' && (
                        <button
                          type="button"
                          onClick={() => relist(l)}
                          disabled={relisting === l.id}
                          className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-[#0E4D5C] hover:text-[#F26B5B] disabled:opacity-60"
                        >
                          <RotateCcw className="w-4 h-4" /> {relisting === l.id ? 'Relisting…' : 'Relist'}
                        </button>
                      )}
                      {l.listing_type === 'auction' && l.status === 'inactive' && l.review_status !== 'rejected' &&
                        (l.relisted_as ? (
                          <Link
                            href={`/listings/${l.relisted_as}`}
                            className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-[#F26B5B]"
                          >
                            <RotateCcw className="w-4 h-4" /> Relisted · view
                          </Link>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setRelistingAuction(l)}
                            className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-[#0E4D5C] hover:text-[#F26B5B]"
                          >
                            <RotateCcw className="w-4 h-4" /> Relist
                          </button>
                        ))}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* Sales */}
        {data && data.sales.length > 0 && (
          <section className="bg-white border rounded-2xl p-6 shadow-sm">
            <h2 className="text-lg font-bold mb-4">Your sales</h2>
            <ul className="divide-y">
              {data.sales.map((s) => (
                <OrderRow key={s.id} order={s} role="seller" />
              ))}
            </ul>
          </section>
        )}

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
                      <span
                        className={`ml-2 font-semibold ${
                          b.state === 'winning' || b.state === 'won'
                            ? 'text-green-700'
                            : b.state === 'outbid'
                              ? 'text-amber-700'
                              : 'text-slate-500'
                        }`}
                      >
                        {BID_STATE_LABELS[b.state]}
                      </span>
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
                body="When you buy something, your card is only charged once you've met the seller and accepted the item."
                action={<BrowseLink />}
              />
            ) : (
              <ul className="divide-y">
                {data.purchases.map((p) => (
                  <OrderRow key={p.id} order={p} role="buyer" />
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Watchlist */}
        {data && data.watching.length > 0 && (
          <section className="bg-white border rounded-2xl p-6 shadow-sm">
            <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
              <Heart className="w-5 h-5 text-[#F26B5B]" /> Watching
            </h2>
            <p className="text-sm text-slate-500 mb-4">
              We&apos;ll tell you if the price drops, it becomes an auction, or its auction is about to end.
            </p>
            <ul className="divide-y">
              {data.watching.map((w) => (
                <li key={w.listing_id} className="py-3 flex justify-between items-center gap-4 text-sm">
                  {w.listing && w.listing.status === 'active' ? (
                    <Link href={`/listings/${w.listing.id}`} className="font-medium line-clamp-1 hover:text-[#F26B5B]">
                      {w.listing.title}
                    </Link>
                  ) : (
                    <span className="text-slate-400 line-clamp-1">{w.listing?.title ?? 'No longer available'}</span>
                  )}
                  <span className="shrink-0 flex items-center gap-3">
                    {w.listing?.status === 'active' && (
                      <span>
                        {formatCents(w.listing.display_price_cents ?? 0)}
                        <span className="ml-2 text-xs font-semibold text-slate-500">
                          {w.listing.listing_type === 'auction' ? 'Auction' : 'Set Price'}
                        </span>
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={async () => {
                        await createClient().from('watchlist').delete().eq('listing_id', w.listing_id)
                        load()
                      }}
                      className="text-xs font-semibold text-slate-500 hover:text-[#F26B5B]"
                    >
                      Remove
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <SavedSearches />
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
            <SecuredByStripe text="Your identity and bank details go straight to Stripe, not to Blockparty." />
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setShowPayoutPrompt(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
                Not now
              </button>
              <SetUpPayoutsButton label={payouts?.accountId ? 'Finish payout setup' : 'Set up payouts'} />
            </div>
          </div>
        </div>
      )}

      {relistingAuction && (
        <RelistAuctionModal
          listing={{
            id: relistingAuction.id,
            title: relistingAuction.title,
            startCents: relistingAuction.starting_price_cents ?? MIN_PRICE_CENTS,
            reserveCents: relistingAuction.reserve?.reserve_cents ?? null,
            bidCount: relistingAuction.bid_count,
          }}
          onClose={() => setRelistingAuction(null)}
          onRelisted={() => {
            setRelistingAuction(null)
            setNotice({ kind: 'success', text: `${relistingAuction.title} is up for auction again.` })
            setListingView('active')
            load()
          }}
        />
      )}

      {converting && (
        <ConvertToAuctionModal
          listing={{
            id: converting.id,
            title: converting.title,
            priceCents: converting.buy_now_price_cents ?? 0,
            watchCount: converting.watch_count,
          }}
          onClose={() => setConverting(null)}
          onConverted={() => {
            setConverting(null)
            setNotice({ kind: 'success', text: `${converting.title} is now an auction.` })
            load()
          }}
        />
      )}

      {showModal && (
        <CreateListingModal
          defaultArea={data?.areaId ?? undefined}
          onClose={() => setShowModal(false)}
          onCreated={(result) => {
            setShowModal(false)
            setNotice(createdNotice(result))
            load()
          }}
        />
      )}
    </div>
  )
}

/** One order in the dashboard, with what happens next. */
function OrderRow({ order, role }: { order: MyOrder; role: 'buyer' | 'seller' }) {
  const tz = order.listing?.area?.timezone ?? 'America/Edmonton'
  let next: { text: string; action: boolean }
  if (order.status === 'completed')
    next = order.needsReview ? { text: 'Leave a review', action: true } : { text: role === 'seller' ? 'Paid' : 'Done', action: false }
  else if (order.status !== 'authorized') next = { text: STATUS_LABELS[order.status] ?? order.status, action: false }
  else if (order.meetup_at) next = { text: `Meetup ${formatMeetupTime(order.meetup_at, tz)}`, action: false }
  else if (order.proposed_times?.length) {
    // Whoever didn't make the suggestion needs to answer it.
    const proposer = (order.proposed_by ?? order.seller_id) === order.seller_id ? 'seller' : 'buyer'
    next = proposer !== role ? { text: 'Pick a meetup time', action: true } : { text: `Waiting for ${role === 'buyer' ? 'seller' : 'buyer'}`, action: false }
  } else next = role === 'seller' ? { text: 'Suggest a meetup', action: true } : { text: 'Waiting for seller', action: false }

  return (
    <li>
      <Link href={`/orders/${order.id}`} className="py-3 flex justify-between gap-4 text-sm hover:bg-slate-50 -mx-2 px-2 rounded-lg">
        <span className="min-w-0">
          <span className="font-medium line-clamp-1">{order.listing?.title ?? `Order #${order.id}`}</span>
          <span className="text-xs text-slate-500">{areaLabel(order.listing?.area)}</span>
        </span>
        <span className="shrink-0 text-right">
          {formatCents(role === 'seller' ? order.amount_cents - order.platform_fee_cents : order.amount_cents)}
          <span className={`block text-xs font-semibold ${next.action ? 'text-[#F26B5B]' : 'text-[#0E4D5C]'}`}>
            {next.action && '● '}
            {next.text}
          </span>
        </span>
      </Link>
    </li>
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
