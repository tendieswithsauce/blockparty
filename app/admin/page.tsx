// app/admin/page.tsx
// Admin area: revenue at a glance, listings held by the automatic check, and
// no-show strikes. Every call is checked server-side with is_admin().
'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, ShieldAlert, XCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatCents } from '@/lib/money'
import { SiteHeader } from '@/components/SiteHeader'
import type { Database } from '@/lib/supabase/database.types'

type Fns = Database['public']['Functions']
type Overview = Fns['admin_overview']['Returns'][number]
type QueueItem = Fns['admin_review_queue']['Returns'][number]
type StrikeRow = Fns['admin_strikes']['Returns'][number]
type CharityApp = Fns['admin_charity_queue']['Returns'][number]

const card = 'bg-white border rounded-2xl p-6 shadow-sm'

export default function AdminPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [strikes, setStrikes] = useState<StrikeRow[]>([])
  const [charities, setCharities] = useState<CharityApp[]>([])
  const [feeCap, setFeeCap] = useState<number | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data: isAdmin } = await supabase.rpc('is_admin')
    setAllowed(!!isAdmin)
    if (!isAdmin) return
    const [o, q, s, c, settings] = await Promise.all([
      supabase.rpc('admin_overview'),
      supabase.rpc('admin_review_queue'),
      supabase.rpc('admin_strikes'),
      supabase.rpc('admin_charity_queue'),
      supabase.from('marketplace_settings').select('charity_fee_free_cap_cents').maybeSingle(),
    ])
    setCharities(c.data ?? [])
    setFeeCap(settings.data?.charity_fee_free_cap_cents ?? null)
    setOverview(o.data?.[0] ?? null)
    setQueue(q.data ?? [])
    setStrikes(s.data ?? [])
  }, [])

  useEffect(() => {
    const first = setTimeout(load, 0)
    return () => clearTimeout(first)
  }, [load])

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#1E293B]">
      <SiteHeader />
      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        {allowed === null ? (
          <div className="h-64 rounded-2xl bg-slate-200 animate-pulse" />
        ) : !allowed ? (
          <div className={card}>
            <p className="font-semibold">Page not found</p>
            <Link href="/" className="text-sm text-[#0E4D5C] underline">
              Go home
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-3xl font-extrabold text-[#0E4D5C]">Admin</h1>
            {overview && <OverviewCards o={overview} />}
            <ReviewQueue items={queue} onDone={load} />
            <CharityQueue items={charities} onDone={load} />
            {feeCap !== null && <FeeCapSetting cents={feeCap} onDone={load} />}
            <Strikes rows={strikes} onDone={load} />
          </>
        )}
      </main>
    </div>
  )
}

function OverviewCards({ o }: { o: Overview }) {
  const stats = [
    { label: 'Fees this month', value: formatCents(Number(o.fees_month_cents)), sub: `${formatCents(Number(o.fees_all_cents))} all time` },
    { label: 'Sales this month', value: formatCents(Number(o.sales_month_cents)), sub: `${formatCents(Number(o.sales_all_cents))} all time` },
    { label: 'Handoffs this month', value: String(o.orders_month), sub: `${o.orders_all} all time` },
    { label: 'Open orders', value: String(o.open_orders), sub: `${o.cancelled_month} cancelled this month` },
    { label: 'Live listings', value: String(o.active_listings), sub: '' },
    { label: 'Members', value: String(o.users), sub: `${o.new_users_month} new this month` },
  ]
  return (
    <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {stats.map((s) => (
        <div key={s.label} className="bg-white border rounded-2xl p-4 shadow-sm">
          <p className="text-xs text-slate-500">{s.label}</p>
          <p className="text-2xl font-extrabold">{s.value}</p>
          {s.sub && <p className="text-xs text-slate-500">{s.sub}</p>}
        </div>
      ))}
    </section>
  )
}

function ReviewQueue({ items, onDone }: { items: QueueItem[]; onDone: () => void }) {
  return (
    <section className={card}>
      <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
        <ShieldAlert className="w-5 h-5 text-[#F26B5B]" /> Listings to review ({items.length})
      </h2>
      <p className="text-sm text-slate-500 mb-4">
        Held by the automatic check, or the check failed 3 times. The seller is told when you decide.
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing waiting.</p>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => (
            <ReviewItem key={item.id} item={item} onDone={onDone} />
          ))}
        </ul>
      )}
    </section>
  )
}

function ReviewItem({ item, onDone }: { item: QueueItem; onDone: () => void }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()
  const photos = item.image_paths.map((p) => supabase.storage.from('listing-photos').getPublicUrl(p).data.publicUrl)

  async function decide(approve: boolean) {
    setError('')
    setBusy(true)
    const { error: rpcError } = await supabase.rpc('admin_review_listing', {
      p_listing_id: item.id,
      p_approve: approve,
      p_reason: reason.trim() || null,
    })
    setBusy(false)
    if (rpcError) return setError(rpcError.message)
    onDone()
  }

  return (
    <li className="border rounded-xl p-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        {photos.map((src) => (
          // eslint-disable-next-line @next/next/no-img-element -- Supabase public URL
          <a key={src} href={src} target="_blank" rel="noreferrer">
            <img src={src} alt="" className="w-24 h-24 object-cover rounded-lg bg-slate-100" />
          </a>
        ))}
      </div>
      <div>
        <p className="font-semibold">
          {item.title}{' '}
          <span className="font-normal text-slate-500">
            · {item.price_cents !== null ? formatCents(item.price_cents) : ''} {item.listing_type === 'auction' ? 'auction' : 'set price'} ·{' '}
            {item.category} · by {item.seller_name}
          </span>
        </p>
        {item.description && <p className="text-sm text-slate-700 whitespace-pre-line mt-1">{item.description}</p>}
        <p className="text-sm mt-2 bg-amber-50 text-amber-900 rounded-lg p-2">
          {item.moderated_by === 'ai' ? 'Automatic check: ' : ''}
          {item.moderation_reason ?? 'The automatic check failed 3 times; it needs a manual look.'}
        </p>
      </div>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason shown to the seller if you reject it"
        className="w-full border px-3 py-2 rounded-lg text-sm"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => decide(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#0E4D5C] text-white text-sm font-semibold disabled:opacity-60"
        >
          <CheckCircle2 className="w-4 h-4" /> Approve
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => decide(false)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border-2 border-red-600 text-red-700 text-sm font-semibold disabled:opacity-60"
        >
          <XCircle className="w-4 h-4" /> Reject
        </button>
      </div>
    </li>
  )
}

function Strikes({ rows, onDone }: { rows: StrikeRow[]; onDone: () => void }) {
  const [busy, setBusy] = useState<number | null>(null)
  return (
    <section className={card}>
      <h2 className="text-lg font-bold mb-1">Active no-show strikes ({rows.length})</h2>
      <p className="text-sm text-slate-500 mb-4">Remove a strike if a report turns out to be wrong. The member is told.</p>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">None.</p>
      ) : (
        <ul className="divide-y">
          {rows.map((s) => (
            <li key={s.id} className="py-3 flex flex-wrap justify-between gap-3 text-sm">
              <span>
                <Link href={`/u/${s.username}`} className="font-semibold hover:underline">
                  {s.username}
                </Link>{' '}
                <span className="text-slate-500">
                  ({s.active_count} active) · {s.reason === 'buyer_no_show' ? 'buyer' : 'seller'} no-show
                  {s.item_title ? ` · ${s.item_title}` : ''} ·{' '}
                  {new Date(s.created_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
                </span>
              </span>
              <button
                type="button"
                disabled={busy === s.id}
                onClick={async () => {
                  setBusy(s.id)
                  await createClient().rpc('admin_void_strike', { p_strike_id: s.id })
                  setBusy(null)
                  onDone()
                }}
                className="text-xs font-semibold text-slate-600 hover:text-red-600 underline"
              >
                Remove strike
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function CharityQueue({ items, onDone }: { items: CharityApp[]; onDone: () => void }) {
  return (
    <section className={card}>
      <h2 className="text-lg font-bold mb-1">Charity applications ({items.length})</h2>
      <p className="text-sm text-slate-500 mb-4">
        Matched against the CRA list. Before approving, confirm the charity is still registered and the person can act for it
        (for example, call the charity using contact details from the CRA listing or their website).
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing waiting.</p>
      ) : (
        <ul className="space-y-4">
          {items.map((c) => (
            <CharityItem key={c.id} item={c} onDone={onDone} />
          ))}
        </ul>
      )}
    </section>
  )
}

function CharityItem({ item, onDone }: { item: CharityApp; onDone: () => void }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function decide(approve: boolean) {
    setError('')
    setBusy(true)
    const { error: rpcError } = await createClient().rpc('admin_review_charity', {
      p_charity_id: item.id,
      p_approve: approve,
      p_note: note.trim() || null,
    })
    setBusy(false)
    if (rpcError) return setError(rpcError.message)
    onDone()
  }

  return (
    <li className="border rounded-xl p-4 space-y-2 text-sm">
      <p className="font-semibold text-base">
        {item.name} <span className="font-normal text-slate-500">· {item.bn} · applied by {item.applicant}</span>
      </p>
      <p className={item.on_cra_list ? 'text-green-800 bg-green-50 rounded-lg p-2' : 'text-amber-900 bg-amber-50 rounded-lg p-2'}>
        {item.on_cra_list
          ? `On the CRA list as ${item.cra_legal_name}${item.cra_city ? `, ${item.cra_city}` : ''}${item.cra_province ? ` ${item.cra_province}` : ''}.`
          : 'Not on the CRA list we have (it may be newly registered, or the number may be wrong). Check it by hand.'}{' '}
        <a
          href="https://apps.cra-arc.gc.ca/ebci/hacc/srch/pub/dsplyBscSrch"
          target="_blank"
          rel="noreferrer noopener"
          className="underline"
        >
          Search the CRA list
        </a>
      </p>
      <p>
        Contact: {item.contact_name} ({item.contact_role})
        {item.website && (
          <>
            {' · '}
            <a href={item.website} target="_blank" rel="noreferrer noopener" className="underline">
              {item.website}
            </a>
          </>
        )}
      </p>
      {item.description && <p className="text-slate-700">{item.description}</p>}
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Reason shown to the applicant if you reject it"
        className="w-full border px-3 py-2 rounded-lg"
      />
      {error && <p className="text-red-600">{error}</p>}
      <div className="flex gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => decide(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#0E4D5C] text-white font-semibold disabled:opacity-60"
        >
          <CheckCircle2 className="w-4 h-4" /> Approve
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => decide(false)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border-2 border-red-600 text-red-700 font-semibold disabled:opacity-60"
        >
          <XCircle className="w-4 h-4" /> Reject
        </button>
      </div>
    </li>
  )
}

/** The yearly fee-free allowance for each approved charity. */
function FeeCapSetting({ cents, onDone }: { cents: number; onDone: () => void }) {
  const [value, setValue] = useState(String(cents / 100))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setMessage('')
    const dollars = Number(value)
    if (!Number.isFinite(dollars) || dollars < 0) return setMessage('Enter an amount in dollars.')
    setBusy(true)
    const { error } = await createClient().rpc('admin_set_charity_fee_cap', { p_cents: Math.round(dollars * 100) })
    setBusy(false)
    if (error) return setMessage(error.message)
    setMessage('Saved.')
    onDone()
  }

  return (
    <section className={card}>
      <h2 className="text-lg font-bold mb-1">Charity fee-free allowance</h2>
      <p className="text-sm text-slate-500 mb-4">
        Each approved charity sells this much per calendar year with no Blockparty fee (Stripe&apos;s processing cost is still
        yours). A sale that doesn&apos;t fit in what&apos;s left pays the normal fee. Set it to $0 to turn it off.
      </p>
      <form onSubmit={save} className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
          <input
            type="number"
            min={0}
            step={50}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-40 border border-slate-300 rounded-lg pl-7 pr-3 py-2"
            aria-label="Fee-free allowance per charity per year, in dollars"
          />
        </div>
        <span className="text-sm text-slate-500">per charity per year</span>
        <button type="submit" disabled={busy} className="px-4 py-2 rounded-full bg-[#0E4D5C] text-white text-sm font-semibold disabled:opacity-60">
          {busy ? 'Saving…' : 'Save'}
        </button>
        {message && <span className="text-sm text-slate-600">{message}</span>}
      </form>
    </section>
  )
}
