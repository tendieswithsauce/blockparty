// components/listing/OffersInbox.tsx
// The seller's offers on a set-price listing (shown on the listing page to
// its seller, at #offers, where offer notifications link). Every offer here
// is already held on the buyer's card. Accept sells it at the offer; "Meet
// in the middle" offers the halfway price, which the buyer takes with one
// tap; Decline releases the hold. Also the listing's offer settings: firm
// price or open to offers, and an optional amount below which offers are
// declined automatically (never shown to buyers).
'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { HandCoins, Handshake, Settings2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { dollarsToCents, formatCents } from '@/lib/money'
import { methodTitle } from '@/lib/handoff'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import type { Database, OfferStatus } from '@/lib/supabase/database.types'
import { respondToOffer } from '@/app/offers/actions'

type Offer = Database['public']['Functions']['seller_listing_offers']['Returns'][number]
type Action = 'accept' | 'counter' | 'decline'

const when = (iso: string) => new Date(iso).toLocaleString('en-CA', { weekday: 'short', hour: 'numeric', minute: '2-digit' })

const DONE: Partial<Record<OfferStatus, string>> = {
  accepted: 'Accepted',
  declined: 'Declined',
  counter_declined: 'Passed on your middle price',
  withdrawn: 'Withdrawn by the buyer',
  expired: 'Expired',
  closed: 'Closed',
}

export function OffersInbox({
  listing,
}: {
  listing: { id: number; title: string; status: string; priceCents: number }
}) {
  const router = useRouter()
  const [offers, setOffers] = useState<Offer[] | null>(null)
  const [accepts, setAccepts] = useState<boolean | null>(null)
  // The choice while editing settings (saved with Save).
  const [draft, setDraft] = useState(false)
  const [floor, setFloor] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState<{ offer: Offer; action: Action } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    const supabase = createClient()
    const [{ data: list }, { data: settings }] = await Promise.all([
      supabase.rpc('seller_listing_offers', { p_listing_id: listing.id }),
      supabase.rpc('my_listing_offer_settings', { p_listing_id: listing.id }),
    ])
    setOffers(list ?? [])
    const s = settings?.[0]
    setAccepts(s?.accepts_offers ?? false)
    setFloor(s?.floor_cents ? (s.floor_cents / 100).toFixed(2) : '')
  }, [listing.id])

  useEffect(() => {
    const first = setTimeout(load, 0)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => {
      clearTimeout(first)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  async function respond() {
    if (!pending) return
    setError('')
    setBusy(true)
    const result = await respondToOffer(pending.offer.id, pending.action).catch(() => ({
      ok: false as const,
      error: 'Something went wrong. Please try again.',
    }))
    setBusy(false)
    if (!result.ok) return setError(result.error)
    if (pending.action === 'accept' && result.transactionId) return router.push(`/orders/${result.transactionId}`)
    setNotice(
      pending.action === 'counter'
        ? `We've offered ${pending.offer.buyer_name} ${formatCents(pending.offer.midpoint_cents)}. They have 24 hours to take it.`
        : 'Offer declined. The buyer’s hold has been released.',
    )
    setPending(null)
    load()
  }

  async function saveSettings(nextAccepts: boolean) {
    setError('')
    let floorCents: number | null = null
    if (nextAccepts && floor.trim()) {
      floorCents = dollarsToCents(floor)
      if (floorCents === null) return setError('Enter a valid amount, or leave it empty.')
      if (floorCents >= listing.priceCents) return setError('The automatic decline amount must be below your price.')
    }
    setSaving(true)
    const { error: rpcError } = await createClient().rpc('set_listing_offers', {
      p_listing_id: listing.id,
      p_accepts: nextAccepts,
      p_floor_cents: floorCents,
    })
    setSaving(false)
    if (rpcError) return setError(rpcError.code === 'P0001' ? `${rpcError.message}.` : 'Could not save. Please try again.')
    setAccepts(nextAccepts)
    setEditing(false)
    setNotice(nextAccepts ? 'Your listing is open to offers.' : 'Your price is firm now. Buyers can no longer make offers.')
  }

  if (accepts === null || offers === null) return null
  const open = offers.filter((o) => o.status === 'open' || o.status === 'countered')
  const done = offers.filter((o) => !(o.status === 'open' || o.status === 'countered')).slice(0, 5)

  return (
    <section id="offers" className="bg-white border rounded-2xl p-6 shadow-sm space-y-4 scroll-mt-24">
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-2 font-bold">
          <HandCoins className="w-5 h-5 text-[#0E4D5C]" /> Offers {open.length > 0 && `(${open.length})`}
        </p>
        <button
          type="button"
          onClick={() => {
            setDraft(Boolean(accepts))
            setEditing((e) => !e)
          }}
          className="inline-flex items-center gap-1 text-sm font-semibold text-[#0E4D5C] underline"
        >
          <Settings2 className="w-4 h-4" /> {accepts ? 'Open to offers' : 'Firm price'}
        </button>
      </div>

      {notice && <div className="p-3 rounded-xl text-sm bg-green-50 text-green-800">{notice}</div>}
      {error && !pending && <div className="p-3 rounded-xl text-sm bg-red-50 text-red-700">{error}</div>}

      {editing && (
        <div className="rounded-xl border p-4 space-y-3 text-sm">
          <fieldset className="flex gap-4">
            <label className="inline-flex items-center gap-2">
              <input type="radio" name={`offers-${listing.id}`} checked={!draft} onChange={() => setDraft(false)} />
              Firm price
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="radio" name={`offers-${listing.id}`} checked={draft} onChange={() => setDraft(true)} />
              Open to offers
            </label>
          </fieldset>
          {draft && (
            <>
              <label className="block">
                <span className="font-medium text-slate-700">Automatically decline offers below (optional)</span>
                <div className="relative mt-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    value={floor}
                    onChange={(e) => setFloor(e.target.value)}
                    placeholder="Leave empty to answer every offer yourself"
                    className="w-full border rounded-lg pl-7 pr-3 py-2"
                  />
                </div>
              </label>
              <p className="text-xs text-slate-500">Buyers never see this amount. Offers below it are declined right away.</p>
            </>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={() => saveSettings(draft)}
            className="px-4 py-2 rounded-full bg-[#0E4D5C] text-white font-semibold disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}

      {open.length === 0 ? (
        <p className="text-sm text-slate-500">
          {accepts ? 'No offers right now. Every offer you get is already on hold on the buyer’s card.' : 'Your price is firm.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {open.map((o) => (
            <li key={o.id} className="border rounded-xl p-3 text-sm space-y-2">
              <p>
                <span className="font-semibold">{o.buyer_name}</span> offered{' '}
                <span className="font-bold text-[#0E4D5C]">{formatCents(o.amount_cents)}</span>
                {o.delivery_fee_cents > 0 && <> + {formatCents(o.delivery_fee_cents)} delivery</>} ·{' '}
                {methodTitle(o.handoff_method).toLowerCase()}
              </p>
              {o.status === 'countered' ? (
                <p className="flex items-center gap-1.5 text-slate-600">
                  <Handshake className="w-4 h-4" /> You offered to meet at {formatCents(o.counter_cents ?? o.midpoint_cents)}.
                  Waiting for them{o.expires_at && <> until {when(o.expires_at)}</>}.
                </p>
              ) : (
                <>
                  {o.expires_at && <p className="text-xs text-slate-500">Answer by {when(o.expires_at)}</p>}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setPending({ offer: o, action: 'accept' })}
                      className="px-4 py-2 rounded-full bg-[#F26B5B] text-white font-bold hover:bg-[#e05a4a]"
                    >
                      Accept {formatCents(o.amount_cents)}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPending({ offer: o, action: 'counter' })}
                      className="inline-flex items-center gap-1 px-4 py-2 rounded-full border-2 border-[#0E4D5C] text-[#0E4D5C] font-semibold hover:bg-[#0E4D5C]/5"
                    >
                      <Handshake className="w-4 h-4" /> Meet in the middle: {formatCents(o.midpoint_cents)}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPending({ offer: o, action: 'decline' })}
                      className="px-4 py-2 rounded-full border-2 border-slate-300 font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Decline
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-500">Earlier offers</summary>
          <ul className="mt-2 space-y-1 text-slate-600">
            {done.map((o) => (
              <li key={o.id}>
                {o.buyer_name}: {formatCents(o.amount_cents)} · {DONE[o.status] ?? o.status}
              </li>
            ))}
          </ul>
        </details>
      )}

      {pending && (
        <ConfirmDialog
          title={
            pending.action === 'accept'
              ? `Sell to ${pending.offer.buyer_name} for ${formatCents(pending.offer.amount_cents)}?`
              : pending.action === 'counter'
                ? `Offer ${formatCents(pending.offer.midpoint_cents)}?`
                : 'Decline this offer?'
          }
          confirmLabel={
            pending.action === 'accept' ? 'Accept and sell' : pending.action === 'counter' ? 'Meet in the middle' : 'Decline offer'
          }
          busyLabel="Saving…"
          busy={busy}
          error={error}
          onConfirm={respond}
          onCancel={() => {
            setPending(null)
            setError('')
          }}
        >
          {pending.action === 'accept' ? (
            <p>
              {pending.offer.buyer_name}&apos;s card is already on hold for {formatCents(pending.offer.amount_cents)}
              {pending.offer.delivery_fee_cents > 0 && <> plus {formatCents(pending.offer.delivery_fee_cents)} delivery</>}. Your
              listing comes down, any other offers are declined, and you arrange the handoff on the order page.
            </p>
          ) : pending.action === 'counter' ? (
            <p>
              Halfway between their {formatCents(pending.offer.amount_cents)} and your {formatCents(listing.priceCents)}.{' '}
              {pending.offer.buyer_name} gets 24 hours to take it with one tap; if they do, it&apos;s sold. Your listing stays up
              meanwhile, so someone else can still buy it at your price.
            </p>
          ) : (
            <p>
              The hold on {pending.offer.buyer_name}&apos;s card is released. They can make another offer if they have any
              left (3 per item).
            </p>
          )}
        </ConfirmDialog>
      )}
    </section>
  )
}
