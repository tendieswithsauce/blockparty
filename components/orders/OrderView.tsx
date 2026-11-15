// components/orders/OrderView.tsx
// The order page for both sides of a sale:
//   seller suggests a spot + times -> buyer picks one -> at the meetup the
//   buyer checks the item and gives their code -> seller enters it -> paid.
'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CalendarClock, CheckCircle2, KeyRound, MapPin, ShieldCheck, XCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatCents } from '@/lib/money'
import { areaLabel } from '@/lib/areas'
import { CANCEL_REASONS, cancelReasonLabel, formatMeetupTime, mapsUrl } from '@/lib/orders'
import { BUY_NOW_CANCEL_WINDOW_SECONDS } from '@/lib/purchase-rules'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { cancelOrder, completeHandoff } from '@/app/orders/actions'

type Spot = {
  id: string
  name: string
  address: string
  kind: string
  lat: number
  lng: number
  timezone: string
  notes: string | null
}

type Order = {
  id: number
  buyer_id: string
  seller_id: string
  amount_cents: number
  platform_fee_cents: number
  status: string
  authorized_at: string | null
  proposed_times: string[] | null
  meetup_at: string | null
  meetup_deadline: string | null
  picked_up_at: string | null
  cancel_reason: string | null
  canceled_by: string | null
  listing: {
    id: number
    title: string
    image_paths: string[]
    listing_type: 'fixed' | 'auction'
    area: { name: string; city: string; timezone: string } | null
  } | null
  spot: Spot | null
}

type Suggestion = Spot & { buyer_km: number; seller_km: number }

const ORDER_COLUMNS =
  'id, buyer_id, seller_id, amount_cents, platform_fee_cents, status, authorized_at, proposed_times, meetup_at, meetup_deadline, picked_up_at, cancel_reason, canceled_by, listing:listings(id, title, image_paths, listing_type, area:areas(name, city, timezone)), spot:meetup_spots(id, name, address, kind, lat, lng, timezone, notes)'

const card = 'bg-white border rounded-2xl p-6 shadow-sm space-y-4'
const primaryBtn = 'px-5 py-2.5 rounded-full bg-[#F26B5B] text-white font-bold hover:bg-[#e05a4a] disabled:opacity-60'
const secondaryBtn =
  'px-5 py-2.5 rounded-full border-2 border-[#0E4D5C] text-[#0E4D5C] font-semibold hover:bg-[#0E4D5C]/5 disabled:opacity-60'

/** datetime-local value (browser local time) for a Date. */
function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function OrderView({ id }: { id: number }) {
  const [order, setOrder] = useState<Order | null | undefined>(undefined)
  const [userId, setUserId] = useState<string | null>(null)
  const [names, setNames] = useState({ buyer: '', seller: '' })
  const [code, setCode] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [now, setNow] = useState<number | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data: auth } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }))
    const uid = auth.user?.id ?? null
    if (!uid) {
      window.location.assign(`/login?next=/orders/${id}`)
      return
    }
    const { data } = await supabase.from('transactions').select(ORDER_COLUMNS).eq('id', id).maybeSingle()
    const o = (data as unknown as Order) ?? null
    setUserId(uid)
    setOrder(o)
    if (!o) return

    const [{ data: n }, codeRes, suggestRes] = await Promise.all([
      supabase.rpc('order_party_names', { p_transaction_id: id }),
      o.buyer_id === uid && o.status === 'authorized'
        ? supabase.rpc('get_handoff_code', { p_transaction_id: id })
        : Promise.resolve({ data: null }),
      o.seller_id === uid && o.status === 'authorized' && !o.meetup_at
        ? supabase.rpc('suggest_meetup_spots', { p_transaction_id: id, p_limit: 4 })
        : Promise.resolve({ data: null }),
    ])
    setNames({ buyer: n?.[0]?.buyer_first_name || 'The buyer', seller: n?.[0]?.seller_first_name || 'The seller' })
    setCode((codeRes.data as string | null) ?? null)
    setSuggestions((suggestRes.data as Suggestion[] | null) ?? [])
  }, [id])

  // Load, then keep up with the other person's changes.
  useEffect(() => {
    const first = setTimeout(load, 0)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    const refresh = setInterval(load, 20_000)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => {
      clearTimeout(first)
      clearInterval(tick)
      clearInterval(refresh)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  if (order === undefined) return <div className="h-64 rounded-2xl bg-slate-200 animate-pulse" />
  if (order === null || !userId) {
    return (
      <div className={card}>
        <p className="font-semibold">Order not found</p>
        <p className="text-sm text-slate-500">It may belong to a different account.</p>
      </div>
    )
  }

  const role: 'buyer' | 'seller' = order.buyer_id === userId ? 'buyer' : 'seller'
  const other = role === 'buyer' ? names.seller : names.buyer
  const tz = order.spot?.timezone ?? order.listing?.area?.timezone ?? 'America/Edmonton'
  const photo = order.listing?.image_paths?.[0]
    ? createClient().storage.from('listing-photos').getPublicUrl(order.listing.image_paths[0]).data.publicUrl
    : null
  const payoutCents = order.amount_cents - order.platform_fee_cents
  const undoUntil =
    order.listing?.listing_type === 'fixed' && order.authorized_at
      ? new Date(order.authorized_at).getTime() + BUY_NOW_CANCEL_WINDOW_SECONDS * 1000
      : null
  const inUndoWindow = undoUntil !== null && now !== null && now < undoUntil

  return (
    <div className="space-y-6">
      {/* Item */}
      <div className={`${card} flex gap-4 items-center space-y-0`}>
        <div className="w-20 h-20 rounded-xl bg-slate-100 overflow-hidden shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element -- Supabase public URL */}
          {photo && <img src={photo} alt="" className="w-full h-full object-cover" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Order #{order.id} · {role === 'buyer' ? `Buying from ${names.seller}` : `Selling to ${names.buyer}`}
          </p>
          <Link href={`/listings/${order.listing?.id}`} className="text-xl font-extrabold hover:text-[#F26B5B] line-clamp-1">
            {order.listing?.title ?? 'Item'}
          </Link>
          <p className="text-sm text-slate-600">
            {formatCents(order.amount_cents)}
            {role === 'seller' && <> · you get {formatCents(payoutCents)} after the fee</>}
            {' · '}
            {areaLabel(order.listing?.area)}
          </p>
        </div>
      </div>

      {order.status === 'completed' ? (
        <div className={`${card} bg-green-50 border-green-200`}>
          <p className="flex items-center gap-2 font-bold text-green-800">
            <CheckCircle2 className="w-5 h-5" /> Sale complete
          </p>
          <p className="text-sm text-green-800">
            {role === 'buyer'
              ? `Your card was charged ${formatCents(order.amount_cents)}. Enjoy it!`
              : `${formatCents(payoutCents)} is on its way to your bank through Stripe.`}
          </p>
        </div>
      ) : order.status === 'canceled' ? (
        <div className={card}>
          <p className="flex items-center gap-2 font-bold">
            <XCircle className="w-5 h-5 text-slate-500" /> Order cancelled
          </p>
          <p className="text-sm text-slate-600">
            {cancelReasonLabel(order.cancel_reason)}.{' '}
            {role === 'buyer' ? 'The hold on your card was released; you were not charged.' : 'The buyer was not charged.'}
          </p>
        </div>
      ) : order.status !== 'authorized' ? (
        <div className={card}>
          <p className="text-sm text-slate-600">This order is being set up. Check back in a minute.</p>
        </div>
      ) : (
        <>
          {role === 'seller' && inUndoWindow ? (
            <div className={card}>
              <p className="font-semibold">Sold! Waiting a few minutes before it&apos;s final</p>
              <p className="text-sm text-slate-600">
                Buyers can cancel a Buy Now purchase for {BUY_NOW_CANCEL_WINDOW_SECONDS / 60} minutes. You can suggest a meetup
                once that&apos;s passed.
              </p>
            </div>
          ) : !order.meetup_at ? (
            role === 'seller' ? (
              <ProposeMeetup
                order={order}
                suggestions={suggestions}
                buyerName={names.buyer}
                tz={tz}
                onDone={load}
              />
            ) : order.proposed_times?.length && order.spot ? (
              <ChooseTime order={order} spot={order.spot} sellerName={names.seller} tz={tz} onDone={load} />
            ) : (
              <div className={card}>
                <p className="flex items-center gap-2 font-semibold">
                  <CalendarClock className="w-5 h-5 text-[#0E4D5C]" /> Waiting for {names.seller} to suggest a meetup
                </p>
                <p className="text-sm text-slate-600">
                  {names.seller} will pick a safe public spot near you both and suggest a few times. We&apos;ll show them here.
                </p>
              </div>
            )
          ) : (
            order.spot && (
              <MeetupDetails spot={order.spot} meetupAt={order.meetup_at} tz={tz} other={other} />
            )
          )}

          {order.meetup_at &&
            (role === 'buyer' ? (
              <div className={card}>
                <p className="flex items-center gap-2 font-bold">
                  <KeyRound className="w-5 h-5 text-[#F26B5B]" /> Your handoff code
                </p>
                <p className="text-5xl font-extrabold tracking-[0.3em] text-[#0E4D5C] tabular-nums">{code ?? '······'}</p>
                <p className="text-sm text-slate-600">
                  Check the item first. Only give this code to {names.seller} once you&apos;re happy with it: entering it
                  charges your card {formatCents(order.amount_cents)}. If the item isn&apos;t as described, keep the code and
                  cancel the order below.
                </p>
              </div>
            ) : (
              <HandoffForm order={order} payoutCents={payoutCents} buyerName={names.buyer} onDone={load} />
            ))}

          {order.meetup_deadline && (
            <p className="text-xs text-slate-500">
              Meet by {formatMeetupTime(order.meetup_deadline, tz)}. If the handoff hasn&apos;t happened by then, the order is
              cancelled and {role === 'buyer' ? 'the hold on your card is released' : "the buyer's hold is released"}.
            </p>
          )}

          <SafetyTips />
          <CancelOrder order={order} role={role} onDone={load} />
        </>
      )}
    </div>
  )
}

function SpotCard({ spot, extra }: { spot: Spot; extra?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <MapPin className="w-5 h-5 text-[#F26B5B] shrink-0 mt-0.5" />
      <div className="text-sm">
        <p className="font-semibold">
          {spot.name}
          {spot.kind === 'police_exchange_zone' && (
            <span className="ml-2 inline-flex items-center gap-1 text-xs font-bold text-[#0E4D5C] bg-[#0E4D5C]/10 px-2 py-0.5 rounded-full">
              <ShieldCheck className="w-3 h-3" /> Police exchange zone
            </span>
          )}
        </p>
        <p className="text-slate-600">
          {spot.address} ·{' '}
          <a href={mapsUrl(spot.lat, spot.lng)} target="_blank" rel="noreferrer" className="underline">
            Map
          </a>
        </p>
        {spot.notes && <p className="text-slate-500 text-xs mt-0.5">{spot.notes}</p>}
        {extra}
      </div>
    </div>
  )
}

function ProposeMeetup({
  order,
  suggestions,
  buyerName,
  tz,
  onDone,
}: {
  order: Order
  suggestions: Suggestion[]
  buyerName: string
  tz: string
  onDone: () => void
}) {
  const [spotId, setSpotId] = useState('')
  const [times, setTimes] = useState(['', '', ''])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Earliest allowed time, fixed when the form opens.
  const [earliest] = useState(() => toLocalInput(new Date(Date.now() + 30 * 60_000)))
  const chosenSpot = spotId || suggestions[0]?.id || ''
  const deadline = order.meetup_deadline ? new Date(order.meetup_deadline) : null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    // datetime-local values are in this browser's timezone.
    const picked = times.filter(Boolean).map((t) => new Date(t).toISOString())
    if (!chosenSpot) return setError('Pick a meetup spot.')
    if (picked.length === 0) return setError('Suggest at least one time.')
    setSaving(true)
    const { error: rpcError } = await createClient().rpc('propose_meetup', {
      p_transaction_id: order.id,
      p_spot_id: chosenSpot,
      p_times: picked,
    })
    setSaving(false)
    if (rpcError) return setError(`${rpcError.message}.`)
    onDone()
  }

  return (
    <form onSubmit={submit} className={card}>
      <div>
        <p className="flex items-center gap-2 font-bold">
          <CalendarClock className="w-5 h-5 text-[#0E4D5C]" /> Suggest a meetup
        </p>
        <p className="text-sm text-slate-600">
          {order.proposed_times?.length
            ? `You've suggested times. Waiting for ${buyerName} to pick one; you can change them below.`
            : `Pick a spot and up to 3 times that work for you. ${buyerName} will choose one.`}
        </p>
      </div>

      {order.proposed_times?.length && order.spot ? (
        <div className="rounded-xl bg-slate-50 p-3 text-sm space-y-1">
          <p className="font-semibold">Currently suggested</p>
          <p>{order.spot.name}</p>
          <ul className="list-disc pl-5 text-slate-600">
            {order.proposed_times.map((t) => (
              <li key={t}>{formatMeetupTime(t, tz)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold mb-1">Spots that suit you both</legend>
        {suggestions.length === 0 && <p className="text-sm text-slate-500">Loading spots…</p>}
        {suggestions.map((s) => (
          <label
            key={s.id}
            className={`block border rounded-xl p-3 cursor-pointer ${chosenSpot === s.id ? 'border-[#0E4D5C] bg-[#0E4D5C]/5' : ''}`}
          >
            <div className="flex gap-3 items-start">
              <input type="radio" name="spot" checked={chosenSpot === s.id} onChange={() => setSpotId(s.id)} className="mt-1" />
              <SpotCard spot={s} extra={<p className="text-xs text-slate-500 mt-1">About {s.seller_km} km from your area</p>} />
            </div>
          </label>
        ))}
      </fieldset>

      <div className="space-y-2">
        <p className="text-sm font-semibold">Times</p>
        {times.map((t, i) => (
          <input
            key={i}
            type="datetime-local"
            value={t}
            min={earliest}
            max={deadline ? toLocalInput(deadline) : undefined}
            onChange={(e) => setTimes((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
            className="w-full border px-3 py-2 rounded-lg"
            aria-label={`Time option ${i + 1}`}
          />
        ))}
        {deadline && <p className="text-xs text-slate-500">Any time before {formatMeetupTime(deadline.toISOString(), tz)}.</p>}
      </div>

      {error && <div className="p-3 rounded-xl text-sm bg-red-50 text-red-700">{error}</div>}
      <button type="submit" disabled={saving} className={primaryBtn}>
        {saving ? 'Sending…' : order.proposed_times?.length ? 'Update suggestion' : `Send to ${buyerName}`}
      </button>
    </form>
  )
}

function ChooseTime({
  order,
  spot,
  sellerName,
  tz,
  onDone,
}: {
  order: Order
  spot: Spot
  sellerName: string
  tz: string
  onDone: () => void
}) {
  const [picked, setPicked] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function choose(time: string | null) {
    setError('')
    if (time === '') return setError('Pick a time.')
    setSaving(true)
    const { error: rpcError } = await createClient().rpc('choose_meetup_time', {
      p_transaction_id: order.id,
      p_time: time,
    })
    setSaving(false)
    if (rpcError) return setError(`${rpcError.message}.`)
    onDone()
  }

  return (
    <div className={card}>
      <p className="flex items-center gap-2 font-bold">
        <CalendarClock className="w-5 h-5 text-[#0E4D5C]" /> {sellerName} suggested a meetup
      </p>
      <SpotCard spot={spot} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold mb-1">Pick a time</legend>
        {order.proposed_times!.map((t) => (
          <label key={t} className={`flex items-center gap-3 border rounded-xl p-3 cursor-pointer ${picked === t ? 'border-[#0E4D5C] bg-[#0E4D5C]/5' : ''}`}>
            <input type="radio" name="time" checked={picked === t} onChange={() => setPicked(t)} />
            <span className="text-sm font-medium">{formatMeetupTime(t, tz)}</span>
          </label>
        ))}
      </fieldset>
      {error && <div className="p-3 rounded-xl text-sm bg-red-50 text-red-700">{error}</div>}
      <div className="flex flex-wrap gap-3">
        <button onClick={() => choose(picked)} disabled={saving} className={primaryBtn}>
          {saving ? 'Saving…' : 'Confirm time'}
        </button>
        <button onClick={() => choose(null)} disabled={saving} className={secondaryBtn}>
          None of these work
        </button>
      </div>
    </div>
  )
}

function MeetupDetails({ spot, meetupAt, tz, other }: { spot: Spot; meetupAt: string; tz: string; other: string }) {
  return (
    <div className={card}>
      <p className="flex items-center gap-2 font-bold">
        <CalendarClock className="w-5 h-5 text-[#0E4D5C]" /> Meeting {other} {formatMeetupTime(meetupAt, tz)}
      </p>
      <SpotCard spot={spot} />
    </div>
  )
}

function HandoffForm({
  order,
  payoutCents,
  buyerName,
  onDone,
}: {
  order: Order
  payoutCents: number
  buyerName: string
  onDone: () => void
}) {
  const [code, setCode] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!/^\d{6}$/.test(code.replace(/\D/g, ''))) return setError("Enter the buyer's 6-digit code.")
    setSaving(true)
    const result = await completeHandoff(order.id, code).catch(() => ({ ok: false as const, error: 'Something went wrong. Please try again.' }))
    setSaving(false)
    if (!result.ok) return setError(result.error)
    setDone(
      result.payoutPending
        ? 'Sale complete! Your payout is being processed.'
        : `Sale complete! ${formatCents(result.payoutCents)} is on its way to your bank.`,
    )
    onDone()
  }

  if (done) return <div className="p-4 rounded-xl bg-green-50 text-green-800 text-sm font-semibold">{done}</div>

  return (
    <form onSubmit={submit} className={card}>
      <p className="flex items-center gap-2 font-bold">
        <KeyRound className="w-5 h-5 text-[#F26B5B]" /> Complete the sale
      </p>
      <p className="text-sm text-slate-600">
        Once {buyerName} has checked the item, ask for their 6-digit code and enter it here. We&apos;ll charge their card and
        send you {formatCents(payoutCents)}.
      </p>
      <input
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="123456"
        className="w-full border px-4 py-3 rounded-xl text-2xl tracking-[0.3em] text-center tabular-nums"
        aria-label="Buyer's handoff code"
      />
      {error && <div className="p-3 rounded-xl text-sm bg-red-50 text-red-700">{error}</div>}
      <button type="submit" disabled={saving} className={`${primaryBtn} w-full`}>
        {saving ? 'Completing…' : 'Complete sale'}
      </button>
    </form>
  )
}

function SafetyTips() {
  return (
    <div className="flex items-start gap-3 bg-[#0E4D5C]/5 rounded-2xl p-4 text-sm text-slate-600">
      <ShieldCheck className="w-5 h-5 text-[#0E4D5C] shrink-0 mt-0.5" />
      <ul className="space-y-1">
        <li>Meet in daylight or a well-lit spot, and tell someone where you&apos;re going.</li>
        <li>Police exchange zones have cameras but aren&apos;t staffed; stations aren&apos;t open 24/7.</li>
        <li>Never pay or accept payment outside Blockparty, and never share your code before checking the item.</li>
      </ul>
    </div>
  )
}

function CancelOrder({ order, role, onDone }: { order: Order; role: 'buyer' | 'seller'; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const reasons = CANCEL_REASONS[role]

  async function confirm() {
    if (!reason) return setError('Choose a reason.')
    setBusy(true)
    const result = await cancelOrder(order.id, reason).catch(() => ({ ok: false as const, error: 'Something went wrong.' }))
    setBusy(false)
    if (!result.ok) return setError(result.error)
    setOpen(false)
    onDone()
  }

  return (
    <>
      <button
        onClick={() => {
          setError('')
          setOpen(true)
        }}
        className="text-sm font-semibold text-slate-500 hover:text-red-600 underline"
      >
        Cancel this order
      </button>
      {open && (
        <ConfirmDialog
          title="Cancel this order?"
          confirmLabel="Cancel order"
          busyLabel="Cancelling…"
          busy={busy}
          error={error}
          onConfirm={confirm}
          onCancel={() => setOpen(false)}
        >
          <p>
            {role === 'buyer'
              ? "The hold on your card is released and you won't be charged."
              : "The buyer's hold is released and they won't be charged."}{' '}
            {order.listing?.listing_type === 'fixed' ? 'The item goes back on sale.' : 'The auction stays closed.'}
          </p>
          <label className="block">
            <span className="font-semibold text-slate-700">Reason</span>
            <select value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full border px-3 py-2 rounded-lg">
              <option value="" disabled>
                Choose a reason
              </option>
              {Object.entries(reasons).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </ConfirmDialog>
      )}
    </>
  )
}
