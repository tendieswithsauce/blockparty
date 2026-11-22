// components/listing/SilentBidPanel.tsx
// Silent (charity) auction panel. Nobody sees the amounts others bid: the
// panel shows the starting price, how many bids there are, your own highest
// bid and whether it's currently on top. Highest bid wins when it ends.
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Clock, CreditCard, EyeOff, Gavel, Trophy } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { HandoffChoice, HandoffDeadlineNote } from '@/components/listing/HandoffChoice'
import { type HandoffMethod, type HandoffOptions, availableMethods, handoffDeadline } from '@/lib/handoff'
import { MAX_PRICE_CENTS, dollarsToCents, formatCents } from '@/lib/money'

type ListingInfo = {
  id: number
  title: string
  sellerId: string
  status: string
  startingPriceCents: number
  bidCount: number
  endsAt: string | null
  extensions: number
  charityName: string | null
  handoff: HandoffOptions
}

function timeLeft(endsAt: string | null, now: number | null) {
  if (!endsAt || now === null) return null
  const ms = new Date(endsAt).getTime() - now
  if (ms <= 0) return 'Ended'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m ${s % 60}s`
  return `${m}m ${s % 60}s`
}

export function SilentBidPanel({ listing }: { listing: ListingInfo }) {
  const [bidCount, setBidCount] = useState(listing.bidCount)
  const lastCount = useRef(listing.bidCount)
  const [status, setStatus] = useState(listing.status)
  const [endsAt, setEndsAt] = useState(listing.endsAt)
  const [extensions, setExtensions] = useState(listing.extensions)
  const [userId, setUserId] = useState<string | null | undefined>(undefined)
  const [hasCard, setHasCard] = useState(false)
  const [hasHomeAddress, setHasHomeAddress] = useState(false)
  const [method, setMethod] = useState<HandoffMethod>(() => availableMethods(listing.handoff)[0] ?? 'meetup')
  // Stable for the effect below.
  const offered = availableMethods(listing.handoff).join(',')
  const [myBid, setMyBid] = useState<number | null>(null)
  const [leading, setLeading] = useState(false)
  const [wonOrderId, setWonOrderId] = useState<number | null>(null)
  // Set while the viewer's win still needs confirming and paying.
  const [confirmUntil, setConfirmUntil] = useState<string | null>(null)
  const [now, setNow] = useState<number | null>(null)
  const [amount, setAmount] = useState('')
  const [pendingCents, setPendingCents] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // You can bid anything from the starting price, or raise your own bid.
  const minBidCents = Math.max(listing.startingPriceCents, myBid === null ? 0 : myBid + 100)
  const ended = status !== 'active' || (now !== null && endsAt !== null && new Date(endsAt).getTime() <= now)
  const isSeller = userId === listing.sellerId

  useEffect(() => {
    const tick = () => setNow(Date.now())
    const first = setTimeout(tick, 0)
    const t = setInterval(tick, 1000)
    return () => {
      clearTimeout(first)
      clearInterval(t)
    }
  }, [])

  const refreshStanding = useCallback(async () => {
    const { data } = await createClient().rpc('silent_bid_status', { p_listing_id: listing.id })
    setMyBid(data?.[0]?.my_bid_cents ?? null)
    setLeading(Boolean(data?.[0]?.is_leading))
  }, [listing.id])

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    async function load() {
      const { data: auth } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }))
      if (cancelled) return
      const uid = auth.user?.id ?? null
      setUserId(uid)
      if (!uid) return
      const [{ data: profile }, { data: choice }, { data: win }] = await Promise.all([
        supabase.from('profiles').select('stripe_payment_method_id, home_address').eq('id', uid).single(),
          supabase.from('bid_handoff_choices').select('method').eq('listing_id', listing.id).eq('bidder_id', uid).maybeSingle(),
        supabase
          .from('transactions')
          .select('id, status, confirm_by')
          .eq('listing_id', listing.id)
          .eq('buyer_id', uid)
          .in('status', ['pending', 'authorized', 'dropped_off', 'completed'])
          .maybeSingle(),
      ])
      if (cancelled) return
      setHasCard(Boolean(profile?.stripe_payment_method_id))
      setHasHomeAddress(Boolean(profile?.home_address))
      if (choice?.method && offered.split(',').includes(choice.method)) setMethod(choice.method)
      setWonOrderId(win?.id ?? null)
      setConfirmUntil(win?.status === 'pending' ? win.confirm_by : null)
      await refreshStanding()
    }
    load()
    return () => {
      cancelled = true
    }
  }, [listing.id, offered, refreshStanding])

  // The bid count and end time update live; when someone else bids, check
  // whether you're still on top.
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`silent-listing-${listing.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'listings', filter: `id=eq.${listing.id}` },
        (payload) => {
          const row = payload.new as { bid_count: number; status: string; ends_at: string | null; extensions?: number }
          if (row.bid_count !== lastCount.current) {
            lastCount.current = row.bid_count
            void refreshStanding()
          }
          setBidCount(row.bid_count)
          setStatus(row.status)
          setEndsAt(row.ends_at)
          setExtensions(row.extensions ?? 0)
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [listing.id, refreshStanding])

  function reviewBid(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const cents = amount ? dollarsToCents(amount) : null
    if (cents === null) return setError('Enter the most you want to bid.')
    if (cents < minBidCents) return setError(`Your bid must be at least ${formatCents(minBidCents)}.`)
    if (cents > MAX_PRICE_CENTS) return setError(`Bids are capped at ${formatCents(MAX_PRICE_CENTS)}.`)
    setPendingCents(cents)
  }

  async function placeBid() {
    const cents = pendingCents
    if (cents === null) return
    setSubmitting(true)
    const { error: rpcError } = await createClient().rpc('place_bid', { p_listing_id: listing.id, p_amount_cents: cents, p_handoff: method })
    setSubmitting(false)
    setPendingCents(null)
    if (rpcError) {
      const min = rpcError.message.match(/at least (\d+) cents/)
      return setError(min ? `Your bid must be at least ${formatCents(Number(min[1]))}.` : rpcError.message)
    }
    setAmount('')
    await refreshStanding()
  }

  const left = timeLeft(endsAt, now)

  return (
    <div className="bg-white border rounded-2xl p-6 shadow-sm space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">Bidding starts at</p>
          <p className="text-4xl font-extrabold text-[#0E4D5C]">{formatCents(listing.startingPriceCents)}</p>
          <p className="text-sm text-slate-500 mt-1">
            {bidCount} {bidCount === 1 ? 'bid' : 'bids'} so far
          </p>
        </div>
        {left && (
          <div className={`text-right ${ended ? 'text-slate-500' : 'text-[#F26B5B]'}`}>
            <p className="text-sm flex items-center gap-1 justify-end">
              <Clock className="w-4 h-4" /> {ended ? 'Auction' : 'Ends in'}
            </p>
            <p className="text-xl font-bold tabular-nums">{left}</p>
          </div>
        )}
      </div>

      <div className="flex items-start gap-2 p-3 rounded-xl bg-[#0E4D5C]/5 text-sm text-slate-700">
        <EyeOff className="w-4 h-4 mt-0.5 shrink-0 text-[#0E4D5C]" />
        <p>
          <span className="font-semibold">Silent auction{listing.charityName ? ` for ${listing.charityName}` : ''}.</span> Bids
          are hidden, so bid the most you&apos;re willing to pay. The highest bid wins when it ends.
        </p>
      </div>

      {myBid !== null && !ended && (
        <div
          className={`flex items-center gap-2 p-3 rounded-xl text-sm font-semibold ${
            leading ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'
          }`}
        >
          {leading ? <Trophy className="w-4 h-4" /> : <Gavel className="w-4 h-4" />}
          Your bid: {formatCents(myBid)} · {leading ? "it's currently the highest" : 'someone has bid more'}
        </div>
      )}

      {error && <div className="p-3 rounded-xl text-sm bg-red-50 text-red-700">{error}</div>}

      {wonOrderId !== null && confirmUntil ? (
        <div className="flex items-start gap-2 p-4 rounded-xl bg-[#F26B5B]/10 text-[#1E293B] text-sm">
          <Trophy className="w-5 h-5 shrink-0 text-[#F26B5B]" />
          <p>
            <span className="font-semibold">You won!</span> Confirm and pay by{' '}
            {new Date(confirmUntil).toLocaleString('en-CA', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}, or it
            goes to the next bidder.{' '}
            <Link href={`/orders/${wonOrderId}`} className="font-semibold underline">
              Confirm now
            </Link>
          </p>
        </div>
      ) : wonOrderId !== null ? (
        <div className="flex items-start gap-2 p-4 rounded-xl bg-green-50 text-green-800 text-sm">
          <Trophy className="w-5 h-5 shrink-0" />
          <p>
            <span className="font-semibold">You won!</span> We&apos;ve placed a hold on your card for your bid; you&apos;re only
            charged once you&apos;ve checked the item.{' '}
            <Link href={`/orders/${wonOrderId}`} className="font-semibold underline">
              View order &amp; meetup
            </Link>
          </p>
        </div>
      ) : ended ? (
        <p className="text-sm text-slate-600">
          {status === 'active' ? 'This auction has ended. The winner will be notified shortly.' : 'This auction is closed.'}
        </p>
      ) : userId === undefined ? (
        <div className="h-24 rounded-xl bg-slate-100 animate-pulse" />
      ) : userId === null ? (
        <Link
          href={`/login?next=${encodeURIComponent(`/listings/${listing.id}`)}`}
          className="block text-center w-full py-3 rounded-full bg-[#F26B5B] text-white font-bold hover:bg-[#e05a4a]"
        >
          Sign in to bid
        </Link>
      ) : isSeller ? (
        <p className="text-sm text-slate-600 bg-slate-50 rounded-xl p-3">
          This is your listing. You can see every bid in your notifications as they come in.
        </p>
      ) : !hasCard ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Add a payment method to bid. You&apos;re only charged if you win.</p>
          <Link
            href="/profile#payment-method"
            className="flex items-center justify-center gap-2 w-full py-3 rounded-full bg-[#0E4D5C] text-white font-bold hover:bg-[#0b3f4b]"
          >
            <CreditCard className="w-4 h-4" /> Add payment method
          </Link>
        </div>
      ) : minBidCents > MAX_PRICE_CENTS ? (
        <p className="text-sm text-slate-600">You&apos;ve bid the {formatCents(MAX_PRICE_CENTS)} maximum.</p>
      ) : (
        <form onSubmit={reviewBid} className="space-y-3">
          <label htmlFor="silent-bid-amount" className="block text-sm font-medium text-slate-700">
            {myBid === null ? 'Your bid' : 'Raise your bid'} (at least {formatCents(minBidCents)})
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
              <input
                id="silent-bid-amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                min={minBidCents / 100}
                max={MAX_PRICE_CENTS / 100}
                placeholder={(minBidCents / 100).toFixed(2)}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full border border-slate-300 rounded-xl pl-7 pr-3 py-3 focus:outline-none focus:ring-2 focus:ring-[#0E4D5C]"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="px-6 rounded-full bg-[#F26B5B] text-white font-bold hover:bg-[#e05a4a] disabled:opacity-60"
            >
              {submitting ? 'Bidding…' : 'Place bid'}
            </button>
          </div>
          <p className="text-xs text-slate-500">You&apos;ll review your bid before it&apos;s placed.</p>
          <p className="text-xs text-slate-500">
            {extensions > 0
              ? `Extended ${extensions} ${extensions === 1 ? 'time' : 'times'} by late bids. `
              : ''}
            A bid in the last 2 minutes adds 2 minutes, so nobody wins by sniping.
          </p>
        </form>
      )}

      {pendingCents !== null && (
        <ConfirmDialog
          title={`Bid ${formatCents(pendingCents)}?`}
          confirmLabel={`Place ${formatCents(pendingCents)} bid`}
          busyLabel="Bidding…"
          busy={submitting}
          onConfirm={placeBid}
          onCancel={() => setPendingCents(null)}
        >
          <p>
            You&apos;re bidding <strong>{formatCents(pendingCents)}</strong> on <strong>{listing.title}</strong>
            {listing.charityName ? <> for {listing.charityName}</> : null}.
          </p>
          <HandoffChoice
            options={listing.handoff}
            value={method}
            onChange={setMethod}
            hasHomeAddress={hasHomeAddress}
            listingId={listing.id}
          />
          <p>
            If yours is the highest bid when it ends, you&apos;ll have 24 hours to confirm and pay it
            {method === 'delivery' && <> plus the {formatCents(listing.handoff.deliveryFeeCents ?? 0)} delivery fee</>}; we
            hold it on your card then. Your card is only charged once you&apos;ve checked the item.{' '}
            <strong>Bids can&apos;t be withdrawn.</strong>
          </p>
          {endsAt && <HandoffDeadlineNote deadline={handoffDeadline(new Date(endsAt).getTime() + 86_400_000)} auction />}
        </ConfirmDialog>
      )}
    </div>
  )
}
