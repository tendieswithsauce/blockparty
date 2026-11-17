// components/orders/OrderView.tsx
// The order page for both sides of a sale:
//   either side suggests a spot + times (with a note) -> the other picks one
//   or counters -> at the meetup the buyer checks the item and gives their
//   code -> seller enters it -> paid. Buyer and seller can message each
//   other here while the order is open.
'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CalendarClock, CheckCircle2, Eye, Home, KeyRound, LocateFixed, MapPin, ShieldCheck, Truck, XCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatCents } from '@/lib/money'
import { areaLabel } from '@/lib/areas'
import { CANCEL_REASONS, addressMapsUrl, cancelReasonLabel, formatMeetupTime, mapsUrl } from '@/lib/orders'
import type { HandoffMethod } from '@/lib/handoff'
import { recordHandoffLocation } from '@/lib/handoff-location'
import { BUY_NOW_CANCEL_WINDOW_SECONDS } from '@/lib/purchase-rules'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { OrderChat } from '@/components/orders/OrderChat'
import { OrderReview } from '@/components/orders/OrderReview'
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
  proposed_by: string | null
  proposal_note: string | null
  meetup_at: string | null
  meetup_deadline: string | null
  picked_up_at: string | null
  cancel_reason: string | null
  canceled_by: string | null
  handoff_method: HandoffMethod
  delivery_fee_cents: number
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

/** Where a pickup or delivery happens (null address = not shown yet). */
type HomePlace = { method: HandoffMethod; address: string | null; hiddenUntil: string | null }

const ORDER_COLUMNS =
  'id, buyer_id, seller_id, amount_cents, platform_fee_cents, status, authorized_at, proposed_times, proposed_by, proposal_note, meetup_at, meetup_deadline, picked_up_at, cancel_reason, canceled_by, handoff_method, delivery_fee_cents, listing:listings(id, title, image_paths, listing_type, area:areas(name, city, timezone)), spot:meetup_spots(id, name, address, kind, lat, lng, timezone, notes)'

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
  const [home, setHome] = useState<HomePlace | null>(null)
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

    const [{ data: n }, codeRes, suggestRes, placeRes] = await Promise.all([
      supabase.rpc('order_party_names', { p_transaction_id: id }),
      o.buyer_id === uid && o.status === 'authorized'
        ? supabase.rpc('get_handoff_code', { p_transaction_id: id })
        : Promise.resolve({ data: null }),
      o.status === 'authorized' && o.handoff_method === 'meetup'
        ? supabase.rpc('suggest_meetup_spots', { p_transaction_id: id, p_limit: 4 })
        : Promise.resolve({ data: null }),
      o.handoff_method !== 'meetup' ? supabase.rpc('order_handoff_place', { p_transaction_id: id }) : Promise.resolve({ data: null }),
    ])
    setNames({ buyer: n?.[0]?.buyer_name || 'The buyer', seller: n?.[0]?.seller_name || 'The seller' })
    setCode((codeRes.data as string | null) ?? null)
    setSuggestions((suggestRes.data as Suggestion[] | null) ?? [])
    const place = (placeRes.data as { method: HandoffMethod; address: string | null; address_hidden_until: string | null }[] | null)?.[0]
    setHome(place ? { method: place.method, address: place.address, hiddenUntil: place.address_hidden_until } : null)
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
            {order.delivery_fee_cents > 0 && <> (incl. {formatCents(order.delivery_fee_cents)} delivery)</>}
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
      ) : null}

      {order.status === 'completed' ? (
        <OrderReview orderId={order.id} userId={userId} other={other} pickedUpAt={order.picked_up_at} now={now} />
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
          {inUndoWindow ? (
            <div className={card}>
              {role === 'seller' ? (
                <>
                  <p className="font-semibold">Sold! Waiting a few minutes before it&apos;s final</p>
                  <p className="text-sm text-slate-600">
                    Buyers can cancel a set-price purchase for {BUY_NOW_CANCEL_WINDOW_SECONDS / 60} minutes. You can arrange the
                    handoff once that&apos;s passed.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-semibold">Your purchase is on hold</p>
                  <p className="text-sm text-slate-600">
                    You can undo it for {BUY_NOW_CANCEL_WINDOW_SECONDS / 60} minutes. After that, you and {names.seller} agree on a
                    time here.
                  </p>
                </>
              )}
            </div>
          ) : (
            <Meetup
              order={order}
              role={role}
              userId={userId}
              other={other}
              suggestions={suggestions}
              home={home}
              tz={tz}
              onDone={load}
            />
          )}

          {order.meetup_at &&
            (role === 'buyer' ? (
              <BuyerCode orderId={order.id} code={code} amountCents={order.amount_cents} sellerName={names.seller} />
            ) : (
              <HandoffForm order={order} payoutCents={payoutCents} buyerName={names.buyer} onDone={load} />
            ))}

          {!inUndoWindow && (
            <OrderChat orderId={order.id} userId={userId} other={other} meetupAt={order.meetup_at} now={now} />
          )}

          {order.meetup_deadline && (
            <p className="text-xs text-slate-500">
              If the handoff hasn&apos;t happened by {formatMeetupTime(order.meetup_deadline, tz)}, the order is cancelled and{' '}
              {role === 'buyer' ? 'the hold on your card is released' : "the buyer's hold is released"}.
            </p>
          )}

          <SafetyTips method={order.handoff_method} />
          <CancelOrder order={order} role={role} now={now} onDone={load} />
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

/**
 * Meetup negotiation. Either side can suggest a spot and up to 3 times; the
 * other picks one or suggests something else. Once agreed, either side can
 * ask to reschedule.
 */
function Meetup({
  order,
  role,
  userId,
  other,
  suggestions,
  home,
  tz,
  onDone,
}: {
  order: Order
  role: 'buyer' | 'seller'
  userId: string
  other: string
  suggestions: Suggestion[]
  home: HomePlace | null
  tz: string
  onDone: () => void
}) {
  const [editing, setEditing] = useState(false)
  const atHome = order.handoff_method !== 'meetup'
  const hasPlace = atHome || !!order.spot
  const proposal = order.proposed_times?.length && hasPlace ? order.proposed_times : null
  const place = atHome ? <HomeCard home={home} method={order.handoff_method} role={role} other={other} /> : order.spot ? <SpotCard spot={order.spot} /> : null
  const verb = order.handoff_method === 'pickup' ? (role === 'buyer' ? 'Picking up from' : 'Pickup by') : order.handoff_method === 'delivery' ? (role === 'buyer' ? 'Delivery from' : 'Delivering to') : 'Meeting'
  const proposer = proposal ? (order.proposed_by ?? order.seller_id) : null
  const done = () => {
    setEditing(false)
    onDone()
  }

  const form = (mode: 'first' | 'update' | 'counter' | 'reschedule') => (
    <ProposeMeetup
      order={order}
      role={role}
      other={other}
      suggestions={suggestions}
      tz={tz}
      mode={mode}
      onCancel={mode === 'first' && role === 'seller' ? undefined : () => setEditing(false)}
      onDone={done}
      place={atHome ? place : null}
    />
  )

  // Agreed: show it, with a way to ask for a different time.
  if (order.meetup_at && hasPlace) {
    return editing ? (
      form('reschedule')
    ) : (
      <div className={card}>
        <p className="flex items-center gap-2 font-bold">
          <CalendarClock className="w-5 h-5 text-[#0E4D5C]" /> {verb} {other} {formatMeetupTime(order.meetup_at, tz)}
        </p>
        {place}
        <button type="button" onClick={() => setEditing(true)} className="text-sm font-semibold text-[#0E4D5C] underline">
          Need a different time or place?
        </button>
      </div>
    )
  }

  // The other side suggested something: pick a time or counter.
  if (proposal && proposer !== userId && place) {
    return editing ? (
      form('counter')
    ) : (
      <RespondToProposal order={order} place={place} times={proposal} other={other} tz={tz} onCounter={() => setEditing(true)} onDone={done} />
    )
  }

  // You suggested something: waiting on them, but you can change it.
  if (proposal && place) {
    return editing ? (
      form('update')
    ) : (
      <div className={card}>
        <p className="flex items-center gap-2 font-bold">
          <CalendarClock className="w-5 h-5 text-[#0E4D5C]" /> Waiting for {other} to pick a time
        </p>
        {place}
        <ul className="text-sm text-slate-600 list-disc pl-5">
          {proposal.map((t) => (
            <li key={t}>{formatMeetupTime(t, tz)}</li>
          ))}
        </ul>
        {order.proposal_note && <p className="text-sm text-slate-600 italic">Your note: &ldquo;{order.proposal_note}&rdquo;</p>}
        <button type="button" onClick={() => setEditing(true)} className="text-sm font-semibold text-[#0E4D5C] underline">
          Change my suggestion
        </button>
      </div>
    )
  }

  // Nothing suggested yet. The seller is asked to start; the buyer can too.
  if (role === 'seller' || editing) return form('first')
  return (
    <div className={card}>
      <p className="flex items-center gap-2 font-semibold">
        <CalendarClock className="w-5 h-5 text-[#0E4D5C]" /> Waiting for {other} to suggest {atHome ? 'times' : 'a meetup'}
      </p>
      {place}
      <p className="text-sm text-slate-600">
        {atHome
          ? `${other} will suggest a few times. You can also suggest some yourself.`
          : `${other} will pick a safe public spot near you both and suggest a few times. You can also suggest one yourself.`}
      </p>
      <button type="button" onClick={() => setEditing(true)} className={secondaryBtn}>
        {atHome ? 'Suggest times' : 'Suggest a spot and time'}
      </button>
    </div>
  )
}

function ProposeMeetup({
  order,
  role,
  other,
  suggestions,
  tz,
  mode,
  onCancel,
  onDone,
  place,
}: {
  order: Order
  role: 'buyer' | 'seller'
  other: string
  suggestions: Suggestion[]
  tz: string
  mode: 'first' | 'update' | 'counter' | 'reschedule'
  onCancel?: () => void
  onDone: () => void
  /** Pickup / delivery: the fixed place, instead of choosing a spot. */
  place: React.ReactNode
}) {
  const atHome = order.handoff_method !== 'meetup'
  // Start from the current spot when changing or countering a suggestion.
  const [spotId, setSpotId] = useState(mode === 'first' ? '' : (order.spot?.id ?? ''))
  const [times, setTimes] = useState(['', '', ''])
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Earliest allowed time, fixed when the form opens.
  const [earliest] = useState(() => toLocalInput(new Date(Date.now() + 30 * 60_000)))
  const deadline = order.meetup_deadline ? new Date(order.meetup_deadline) : null
  // The current spot may not be among the nearest suggestions; keep it listed.
  const spots: Suggestion[] =
    order.spot && mode !== 'first' && !suggestions.some((s) => s.id === order.spot!.id)
      ? [{ ...order.spot, buyer_km: NaN, seller_km: NaN }, ...suggestions]
      : suggestions
  const chosenSpot = spotId || spots[0]?.id || ''

  const heading = {
    first: atHome ? 'Suggest times' : 'Suggest a meetup',
    update: 'Change your suggestion',
    counter: 'Suggest something else',
    reschedule: 'Suggest a new time or place',
  }[mode]
  const intro = {
    first: atHome
      ? `Pick up to 3 times that work for you. ${other} will choose one or suggest something else.`
      : `Pick a spot and up to 3 times that work for you. ${other} will choose one or suggest something else.`,
    update: `This replaces what you suggested before. ${other} will be told.`,
    counter: `Pick a spot and up to 3 times that work better. ${other} will choose one or suggest something else.`,
    reschedule: `Your current meetup is cancelled until ${other} accepts one of these, so let them know why in the note.`,
  }[mode]

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    // datetime-local values are in this browser's timezone.
    const picked = times.filter(Boolean).map((t) => new Date(t).toISOString())
    if (!atHome && !chosenSpot) return setError('Pick a meetup spot.')
    if (picked.length === 0) return setError('Suggest at least one time.')
    setSaving(true)
    const { error: rpcError } = await createClient().rpc('propose_meetup', {
      p_transaction_id: order.id,
      p_spot_id: atHome ? '' : chosenSpot,
      p_times: picked,
      p_note: note.trim() || null,
    })
    setSaving(false)
    if (rpcError) return setError(`${rpcError.message}.`)
    onDone()
  }

  return (
    <form onSubmit={submit} className={card}>
      <div>
        <p className="flex items-center gap-2 font-bold">
          <CalendarClock className="w-5 h-5 text-[#0E4D5C]" /> {heading}
        </p>
        <p className="text-sm text-slate-600">{intro}</p>
      </div>

      {atHome ? (
        place
      ) : (
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold mb-1">Spots that suit you both</legend>
        {spots.length === 0 && <p className="text-sm text-slate-500">Loading spots…</p>}
        {spots.map((s) => {
          const km = role === 'seller' ? s.seller_km : s.buyer_km
          return (
            <label
              key={s.id}
              className={`block border rounded-xl p-3 cursor-pointer ${chosenSpot === s.id ? 'border-[#0E4D5C] bg-[#0E4D5C]/5' : ''}`}
            >
              <div className="flex gap-3 items-start">
                <input type="radio" name="spot" checked={chosenSpot === s.id} onChange={() => setSpotId(s.id)} className="mt-1" />
                <SpotCard
                  spot={s}
                  extra={
                    <p className="text-xs text-slate-500 mt-1">
                      {Number.isFinite(km) ? `About ${km} km from your area` : 'Currently suggested'}
                    </p>
                  }
                />
              </div>
            </label>
          )
        })}
      </fieldset>
      )}

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
        {deadline && <p className="text-xs text-slate-500">Any time before {formatMeetupTime(deadline.toISOString(), tz)}</p>}
      </div>

      <label className="block">
        <span className="text-sm font-semibold">
          Note <span className="font-normal text-slate-500">(optional)</span>
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={300}
          rows={2}
          placeholder="e.g. Weekday evenings are easiest for me"
          className="mt-1 w-full border px-3 py-2 rounded-lg text-sm"
        />
      </label>

      {error && <div className="p-3 rounded-xl text-sm bg-red-50 text-red-700">{error}</div>}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={saving} className={primaryBtn}>
          {saving ? 'Sending…' : `Send to ${other}`}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={saving} className={secondaryBtn}>
            Never mind
          </button>
        )}
      </div>
    </form>
  )
}

function RespondToProposal({
  order,
  place,
  times,
  other,
  tz,
  onCounter,
  onDone,
}: {
  order: Order
  place: React.ReactNode
  times: string[]
  other: string
  tz: string
  onCounter: () => void
  onDone: () => void
}) {
  const [picked, setPicked] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function confirm() {
    setError('')
    if (!picked) return setError('Pick a time.')
    setSaving(true)
    const { error: rpcError } = await createClient().rpc('choose_meetup_time', {
      p_transaction_id: order.id,
      p_time: picked,
    })
    setSaving(false)
    if (rpcError) return setError(`${rpcError.message}.`)
    onDone()
  }

  return (
    <div className={card}>
      <p className="flex items-center gap-2 font-bold">
        <CalendarClock className="w-5 h-5 text-[#0E4D5C]" /> {other} suggested {order.handoff_method === 'meetup' ? 'a meetup' : 'some times'}
      </p>
      {place}
      {order.proposal_note && (
        <p className="text-sm bg-slate-50 rounded-xl p-3">
          <span className="font-semibold">{other}:</span> &ldquo;{order.proposal_note}&rdquo;
        </p>
      )}
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold mb-1">Pick a time</legend>
        {times.map((t) => (
          <label key={t} className={`flex items-center gap-3 border rounded-xl p-3 cursor-pointer ${picked === t ? 'border-[#0E4D5C] bg-[#0E4D5C]/5' : ''}`}>
            <input type="radio" name="time" checked={picked === t} onChange={() => setPicked(t)} />
            <span className="text-sm font-medium">{formatMeetupTime(t, tz)}</span>
          </label>
        ))}
      </fieldset>
      {error && <div className="p-3 rounded-xl text-sm bg-red-50 text-red-700">{error}</div>}
      <div className="flex flex-wrap gap-3">
        <button onClick={confirm} disabled={saving} className={primaryBtn}>
          {saving ? 'Saving…' : 'Confirm time'}
        </button>
        <button onClick={onCounter} disabled={saving} className={secondaryBtn}>
          Suggest something else
        </button>
      </div>
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
    // Where the handoff happened (for safety; admins only). Never blocks the sale.
    await recordHandoffLocation(order.id, 5000)
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
      <LocationNote />
    </form>
  )
}

function SafetyTips({ method }: { method: HandoffMethod }) {
  return (
    <div className="flex items-start gap-3 bg-[#0E4D5C]/5 rounded-2xl p-4 text-sm text-slate-600">
      <ShieldCheck className="w-5 h-5 text-[#0E4D5C] shrink-0 mt-0.5" />
      <ul className="space-y-1">
        {method === 'meetup' ? (
          <>
            <li>Meet in daylight or a well-lit spot, and tell someone where you&apos;re going.</li>
            <li>Police exchange zones have cameras but aren&apos;t staffed; stations aren&apos;t open 24/7.</li>
          </>
        ) : (
          <>
            <li>Do the handoff at the door or in a driveway, in daylight if you can. You don&apos;t need to go inside.</li>
            <li>Have someone else home if possible, and tell someone when the handoff is.</li>
          </>
        )}
        <li>
          Add an <Link href="/profile" className="underline">emergency contact</Link> and we&apos;ll email them where and when you&apos;re
          meeting.
        </li>
        <li>Never pay or accept payment outside Blockparty, and never share your code before checking the item.</li>
      </ul>
    </div>
  )
}

/** Pickup at the seller's home, or delivery to the buyer's home. */
function HomeCard({
  home,
  method,
  role,
  other,
}: {
  home: HomePlace | null
  method: HandoffMethod
  role: 'buyer' | 'seller'
  other: string
}) {
  const Icon = method === 'delivery' ? Truck : Home
  const yours = (method === 'pickup' && role === 'seller') || (method === 'delivery' && role === 'buyer')
  const label =
    method === 'pickup'
      ? yours
        ? `${other} picks it up from your home`
        : `Pick up from ${other}'s home`
      : yours
        ? `${other} delivers it to your home`
        : `Deliver to ${other}'s home`
  return (
    <div className="flex items-start gap-3">
      <Icon className="w-5 h-5 text-[#F26B5B] shrink-0 mt-0.5" />
      <div className="text-sm">
        <p className="font-semibold">{label}</p>
        {home?.address ? (
          <p className="text-slate-600">
            {home.address}
            {!yours && (
              <>
                {' '}
                ·{' '}
                <a href={addressMapsUrl(home.address)} target="_blank" rel="noreferrer" className="underline">
                  Map
                </a>
              </>
            )}
          </p>
        ) : (
          <p className="text-slate-500">
            {home?.hiddenUntil
              ? 'The address appears here once the 5-minute undo window has passed.'
              : 'No address on file. Ask in the chat below.'}
          </p>
        )}
        {yours && <p className="text-xs text-slate-500 mt-0.5">Only {other} can see this address, and only while the order is open.</p>}
      </div>
    </div>
  )
}

function LocationNote() {
  return (
    <p className="flex items-start gap-1.5 text-xs text-slate-500">
      <LocateFixed className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      For everyone&apos;s safety we ask your phone for your location at the handoff. Only Blockparty staff can see it, and it&apos;s
      deleted after 90 days. You can say no.
    </p>
  )
}

/** The buyer's code, shown on tap (which also records where they are). */
function BuyerCode({
  orderId,
  code,
  amountCents,
  sellerName,
}: {
  orderId: number
  code: string | null
  amountCents: number
  sellerName: string
}) {
  const [shown, setShown] = useState(false)
  return (
    <div className={card}>
      <p className="flex items-center gap-2 font-bold">
        <KeyRound className="w-5 h-5 text-[#F26B5B]" /> Your handoff code
      </p>
      {shown ? (
        <p className="text-5xl font-extrabold tracking-[0.3em] text-[#0E4D5C] tabular-nums">{code ?? '······'}</p>
      ) : (
        <button
          type="button"
          onClick={() => {
            setShown(true)
            recordHandoffLocation(orderId)
          }}
          className={`${primaryBtn} w-full inline-flex items-center justify-center gap-2`}
        >
          <Eye className="w-4 h-4" /> Show my code
        </button>
      )}
      <p className="text-sm text-slate-600">
        Check the item first. Only give this code to {sellerName} once you&apos;re happy with it: entering it charges your card{' '}
        {formatCents(amountCents)}. If the item isn&apos;t as described, keep the code and cancel the order below.
      </p>
      <LocationNote />
    </div>
  )
}

function CancelOrder({
  order,
  role,
  now,
  onDone,
}: {
  order: Order
  role: 'buyer' | 'seller'
  now: number | null
  onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // A no-show can only be reported once the agreed time has passed; it gives
  // the other person a strike (unless they tapped "I'm here").
  const meetupPassed = !!order.meetup_at && now !== null && now >= new Date(order.meetup_at).getTime()
  const reasons = Object.entries(CANCEL_REASONS[role]).filter(
    ([value]) => (meetupPassed || !value.endsWith('_no_show')) && (value !== 'too_far' || order.handoff_method === 'delivery'),
  )

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
              {reasons.map(([value, label]) => (
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
