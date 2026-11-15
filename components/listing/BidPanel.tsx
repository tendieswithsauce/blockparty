// components/listing/BidPanel.tsx
// Live auction panel: current bid, countdown, bid form and bid history.
// Updates in real time via Supabase Realtime when anyone bids.
'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Clock, CreditCard, Gavel, Trophy } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { MAX_PRICE_CENTS, dollarsToCents, formatCents } from '@/lib/money'

type ListingInfo = {
  id: number
  title: string
  sellerId: string
  status: string
  startingPriceCents: number
  currentBidCents: number | null
  bidCount: number
  endsAt: string | null
}

type Bid = { id: number; amount_cents: number; created_at: string; bidder_id: string }

const BID_INCREMENT_CENTS = 100

function timeLeft(endsAt: string | null, now: number | null) {
  if (!endsAt || now === null) return null
  const ms = new Date(endsAt).getTime() - now
  if (ms <= 0) return 'Ended'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m ${sec}s`
  return `${m}m ${sec}s`
}

function friendlyError(message: string) {
  const min = message.match(/at least (\d+) cents/)
  if (min) return `Your bid must be at least ${formatCents(Number(min[1]))}.`
  return message
}

export function BidPanel({ listing }: { listing: ListingInfo }) {
  const [currentBid, setCurrentBid] = useState(listing.currentBidCents)
  const [bidCount, setBidCount] = useState(listing.bidCount)
  const [status, setStatus] = useState(listing.status)
  const [endsAt, setEndsAt] = useState(listing.endsAt)
  const [bids, setBids] = useState<Bid[]>([])
  const [userId, setUserId] = useState<string | null | undefined>(undefined)
  const [hasCard, setHasCard] = useState(false)
  // Set in the browser only: the clock isn't available while prerendering.
  const [now, setNow] = useState<number | null>(null)
  const [amount, setAmount] = useState('')
  const [pendingCents, setPendingCents] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const minBidCents = currentBid === null ? listing.startingPriceCents : currentBid + BID_INCREMENT_CENTS
  const ended = status !== 'active' || (now !== null && endsAt !== null && new Date(endsAt).getTime() <= now)
  const atMax = minBidCents > MAX_PRICE_CENTS
  const isSeller = userId === listing.sellerId
  const topBid = bids[0]
  const youreWinning = Boolean(userId && topBid?.bidder_id === userId)
  const youBid = Boolean(userId && bids.some((b) => b.bidder_id === userId))

  // Countdown tick.
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const first = setTimeout(tick, 0)
    const t = setInterval(tick, 1000)
    return () => {
      clearTimeout(first)
      clearInterval(t)
    }
  }, [])

  // Who's looking, whether they have a card, and the bid history.
  useEffect(() => {
    let cancelled = false
    // Created in the browser only (not during server prerender).
    const supabase = createClient()
    async function loadBids() {
      const { data: history } = await supabase
        .from('bids')
        .select('id, amount_cents, created_at, bidder_id')
        .eq('listing_id', listing.id)
        .order('amount_cents', { ascending: false })
        .limit(20)
      if (!cancelled) setBids(history ?? [])
    }
    async function load() {
      const { data: auth } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }))
      if (cancelled) return
      const uid = auth.user?.id ?? null
      setUserId(uid)
      if (uid) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('stripe_payment_method_id')
          .eq('id', uid)
          .single()
        if (!cancelled) setHasCard(Boolean(profile?.stripe_payment_method_id))
      }
    }
    loadBids()
    load()
    return () => {
      cancelled = true
    }
  }, [listing.id])

  // Live updates from other bidders.
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`listing-${listing.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'listings', filter: `id=eq.${listing.id}` },
        (payload) => {
          const row = payload.new as { current_bid_cents: number | null; bid_count: number; status: string; ends_at: string | null }
          setCurrentBid(row.current_bid_cents)
          setBidCount(row.bid_count)
          setStatus(row.status)
          setEndsAt(row.ends_at)
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'bids', filter: `listing_id=eq.${listing.id}` },
        (payload) => {
          const bid = payload.new as Bid
          setBids((prev) =>
            prev.some((b) => b.id === bid.id) ? prev : [bid, ...prev].sort((a, b) => b.amount_cents - a.amount_cents),
          )
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [listing.id])

  // Anonymous labels: "You", or Bidder 1, 2... in order of first bid.
  const bidderLabel = useMemo(() => {
    const order = [...bids].sort((a, b) => a.created_at.localeCompare(b.created_at))
    const labels = new Map<string, string>()
    for (const b of order) {
      if (!labels.has(b.bidder_id)) labels.set(b.bidder_id, `Bidder ${labels.size + 1}`)
    }
    return (id: string) => (id === userId ? 'You' : (labels.get(id) ?? 'Bidder'))
  }, [bids, userId])

  // Step 1: check the amount, then ask the bidder to confirm.
  function reviewBid(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setMessage('')
    const cents = amount ? dollarsToCents(amount) : minBidCents
    if (cents === null) return setError('Enter a valid amount.')
    if (cents < minBidCents) return setError(`Your bid must be at least ${formatCents(minBidCents)}.`)
    if (cents > MAX_PRICE_CENTS) return setError(`Bids are capped at ${formatCents(MAX_PRICE_CENTS)}.`)
    setPendingCents(cents)
  }

  // Step 2: the bidder confirmed in the dialog.
  async function placeBid() {
    const cents = pendingCents
    if (cents === null) return
    setSubmitting(true)
    const { data, error: rpcError } = await createClient().rpc('place_bid', {
      p_listing_id: listing.id,
      p_amount_cents: cents,
    })
    setSubmitting(false)
    setPendingCents(null)

    if (rpcError) return setError(friendlyError(rpcError.message))

    // Apply our own bid right away (Realtime will confirm it too).
    if (data) {
      const bid = data as Bid
      setBids((prev) => (prev.some((b) => b.id === bid.id) ? prev : [bid, ...prev]))
      setCurrentBid(bid.amount_cents)
      setBidCount((c) => c + 1)
    }
    setAmount('')
    setMessage(`You're the highest bidder at ${formatCents(cents)}.`)
  }

  const left = timeLeft(endsAt, now)

  return (
    <div className="bg-white border rounded-2xl p-6 shadow-sm space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">{currentBid === null ? 'Starting bid' : 'Current bid'}</p>
          <p className="text-4xl font-extrabold text-[#0E4D5C]">{formatCents(currentBid ?? listing.startingPriceCents)}</p>
          <p className="text-sm text-slate-500 mt-1">
            {bidCount} {bidCount === 1 ? 'bid' : 'bids'}
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

      {userId && youBid && !ended && (
        <div
          className={`flex items-center gap-2 p-3 rounded-xl text-sm font-semibold ${
            youreWinning ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'
          }`}
        >
          {youreWinning ? <Trophy className="w-4 h-4" /> : <Gavel className="w-4 h-4" />}
          {youreWinning ? "You're the highest bidder" : "You've been outbid"}
        </div>
      )}

      {error && <div className="p-3 rounded-xl text-sm bg-red-50 text-red-700">{error}</div>}
      {message && !error && youreWinning && <div className="p-3 rounded-xl text-sm bg-green-50 text-green-800">{message}</div>}

      {ended ? (
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
        <p className="text-sm text-slate-600 bg-slate-50 rounded-xl p-3">This is your listing, so you can&apos;t bid on it.</p>
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
      ) : atMax ? (
        <p className="text-sm text-slate-600">This auction has reached the {formatCents(MAX_PRICE_CENTS)} maximum.</p>
      ) : (
        <form onSubmit={reviewBid} className="space-y-3">
          <label htmlFor="bid-amount" className="block text-sm font-medium text-slate-700">
            Your bid (minimum {formatCents(minBidCents)})
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
              <input
                id="bid-amount"
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
          <div className="flex gap-2">
            {[0, 500, 1000]
              .map((extra) => minBidCents + extra)
              .filter((c) => c <= MAX_PRICE_CENTS)
              .map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setAmount((c / 100).toFixed(2))}
                  className="px-3 py-1.5 rounded-full border text-sm font-semibold text-[#0E4D5C] hover:bg-[#0E4D5C]/5"
                >
                  {formatCents(c)}
                </button>
              ))}
          </div>
          <p className="text-xs text-slate-500">You&apos;ll review your bid before it&apos;s placed.</p>
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
            You&apos;re bidding <strong>{formatCents(pendingCents)}</strong> on <strong>{listing.title}</strong>.
          </p>
          <p>
            If you win, Blockparty will charge your saved card for your bid and hold the money until you pick up the item at
            the hub. <strong>Bids can&apos;t be withdrawn.</strong>
          </p>
        </ConfirmDialog>
      )}

      {bids.length > 0 && (
        <div>
          <h3 className="text-sm font-bold mb-2">Bid history</h3>
          <ul className="divide-y text-sm">
            {bids.slice(0, 10).map((b, i) => (
              <li key={b.id} className="py-2 flex justify-between">
                <span className={i === 0 ? 'font-semibold' : 'text-slate-600'}>{bidderLabel(b.bidder_id)}</span>
                <span className="tabular-nums">
                  {formatCents(b.amount_cents)}
                  <span className="text-slate-400 ml-2 text-xs">
                    {new Date(b.created_at).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
