// components/admin/AdminListings.tsx
// Admin: find any listing, take it down (hidden, seller told why), restore it,
// or delete it for good (only if it never had an order). Every call is checked
// server-side with is_admin().
'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Ban, ExternalLink, RotateCcw, Search, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatCents } from '@/lib/money'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { deleteListing } from '@/app/admin/actions'
import { Pager } from '@/components/admin/Pager'
import type { Database } from '@/lib/supabase/database.types'

type Row = Database['public']['Functions']['admin_listings']['Returns'][number]

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'live', label: 'Live' },
  { id: 'reported', label: 'Reported' },
  { id: 'in_review', label: 'In review' },
  { id: 'taken_down', label: 'Taken down' },
  { id: 'inactive', label: 'Inactive' },
  { id: 'sold', label: 'Sold' },
] as const
type Filter = (typeof FILTERS)[number]['id']

const PAGE_SIZE = 20
const card = 'bg-white border rounded-2xl p-6 shadow-sm'

function statusLabel(r: Row) {
  if (r.review_status === 'rejected') return { text: 'Taken down', tone: 'bg-red-100 text-red-800' }
  if (r.review_status === 'pending') return { text: 'In review', tone: 'bg-amber-100 text-amber-800' }
  if (r.status === 'active') {
    const ended = r.ends_at && new Date(r.ends_at).getTime() <= Date.now()
    return ended ? { text: 'Ended', tone: 'bg-slate-100 text-slate-700' } : { text: 'Live', tone: 'bg-green-100 text-green-800' }
  }
  if (['sold', 'pending_pickup', 'complete'].includes(r.status)) return { text: 'Sold', tone: 'bg-blue-100 text-blue-800' }
  return { text: 'Inactive', tone: 'bg-slate-100 text-slate-700' }
}

type Pending = { kind: 'take_down' | 'delete'; row: Row } | null

export function AdminListings() {
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState<Pending>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState('')

  const load = useCallback(async () => {
    setError('')
    const { data, error: rpcError } = await createClient().rpc('admin_listings', {
      p_query: submitted || null,
      p_filter: filter,
      p_limit: PAGE_SIZE,
      p_offset: page * PAGE_SIZE,
    })
    if (rpcError) return setError(rpcError.message)
    const list = data ?? []
    // After a delete, the last page can come back empty: step back one.
    if (list.length === 0 && page > 0) return setPage(page - 1)
    setRows(list)
    setTotal(list[0]?.total_count ?? 0)
  }, [submitted, filter, page])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  async function restore(r: Row) {
    setNotice('')
    setError('')
    const { error: rpcError } = await createClient().rpc('admin_restore_listing', { p_listing_id: r.id })
    if (rpcError) return setError(rpcError.message)
    setNotice(`Restored “${r.title}”. The seller was told.`)
    load()
  }

  function open(kind: 'take_down' | 'delete', row: Row) {
    setPending({ kind, row })
    setReason('')
    setDialogError('')
  }

  async function confirm() {
    if (!pending) return
    if (!reason.trim()) return setDialogError('Give the seller a reason. They see it.')
    setBusy(true)
    setDialogError('')
    const { row, kind } = pending
    if (kind === 'take_down') {
      const { error: rpcError } = await createClient().rpc('admin_take_down_listing', { p_listing_id: row.id, p_reason: reason.trim() })
      setBusy(false)
      if (rpcError) return setDialogError(rpcError.message)
      setNotice(`Took down “${row.title}”. The seller was told why.`)
    } else {
      const result = await deleteListing(row.id, reason.trim()).catch(() => ({ ok: false as const, error: 'Something went wrong.' }))
      setBusy(false)
      if (!result.ok) return setDialogError(result.error)
      setNotice(`Deleted “${row.title}” for good${result.photosRemoved ? ` and ${result.photosRemoved} photo${result.photosRemoved === 1 ? '' : 's'}` : ''}.`)
    }
    setPending(null)
    load()
  }

  const photoUrl = (path: string) => createClient().storage.from('listing-photos').getPublicUrl(path).data.publicUrl

  return (
    <section className={card}>
      <h2 className="text-lg font-bold mb-1">All listings</h2>
      <p className="text-sm text-slate-500 mb-4">
        Search by title, seller or listing number. <strong>Take down</strong> hides a listing and tells the seller why (you
        can restore it). <strong>Delete</strong> removes it for good, and only works if it never had an order.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          setSubmitted(query.trim())
          setPage(0)
        }}
        className="flex gap-2 mb-3"
      >
        <label className="relative flex-1">
          <span className="sr-only">Search listings</span>
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Title, seller or #id"
            className="w-full border border-slate-300 rounded-full pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E4D5C]"
          />
        </label>
        <button type="submit" className="px-4 py-2 rounded-full bg-[#0E4D5C] text-white text-sm font-semibold">
          Search
        </button>
      </form>

      <div className="flex flex-wrap gap-2 mb-4" role="tablist" aria-label="Filter listings">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => {
              setFilter(f.id)
              setPage(0)
            }}
            className={`px-3 py-1 rounded-full text-sm font-semibold border ${
              filter === f.id ? 'bg-[#0E4D5C] text-white border-[#0E4D5C]' : 'text-slate-600 border-slate-300'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {notice && <p className="mb-3 p-3 text-sm rounded-xl bg-green-50 text-green-800">{notice}</p>}
      {error && <p className="mb-3 p-3 text-sm rounded-xl bg-red-50 text-red-700">{error}</p>}

      {rows === null ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">No listings match.</p>
      ) : (
        <ul className="divide-y">
          {rows.map((r) => {
            const s = statusLabel(r)
            const takenDown = r.review_status === 'rejected'
            return (
              <li key={r.id} className="py-3 flex gap-3">
                <div className="w-16 h-16 shrink-0 rounded-lg bg-slate-100 overflow-hidden">
                  {r.image_path && (
                    // eslint-disable-next-line @next/next/no-img-element -- Supabase public URL
                    <img src={photoUrl(r.image_path)} alt="" className="w-full h-full object-cover" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${s.tone}`}>{s.text}</span>
                    {r.open_reports > 0 && (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-600 text-white">
                        {r.open_reports} report{r.open_reports === 1 ? '' : 's'}
                      </span>
                    )}
                    {r.seller_suspended && (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-700 text-white">Seller suspended</span>
                    )}
                    <span className="text-xs text-slate-400">#{r.id}</span>
                  </div>
                  <p className="font-semibold truncate mt-0.5">{r.title}</p>
                  <p className="text-xs text-slate-500">
                    {r.price_cents !== null ? formatCents(r.price_cents) : '–'} ·{' '}
                    {r.listing_type === 'auction' ? `auction, ${r.bid_count} bid${r.bid_count === 1 ? '' : 's'}` : 'Set Price'} · by{' '}
                    <Link href={`/u/${r.seller_name}`} className="underline">
                      {r.seller_name}
                    </Link>{' '}
                    · {new Date(r.created_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
                    {r.open_orders > 0 && <span className="text-amber-700 font-semibold"> · open order</span>}
                  </p>
                  {r.moderation_reason && (takenDown || r.review_status === 'pending') && (
                    <p className="text-xs text-red-700 mt-0.5">Reason: {r.moderation_reason}</p>
                  )}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-sm font-semibold">
                    {!takenDown && r.review_status === 'approved' && (
                      <Link href={`/listings/${r.id}`} target="_blank" className="inline-flex items-center gap-1 text-[#0E4D5C]">
                        <ExternalLink className="w-3.5 h-3.5" /> View
                      </Link>
                    )}
                    {takenDown ? (
                      <button type="button" onClick={() => restore(r)} className="inline-flex items-center gap-1 text-[#0E4D5C]">
                        <RotateCcw className="w-3.5 h-3.5" /> Restore
                      </button>
                    ) : (
                      <button type="button" onClick={() => open('take_down', r)} className="inline-flex items-center gap-1 text-amber-700">
                        <Ban className="w-3.5 h-3.5" /> Take down
                      </button>
                    )}
                    {r.all_orders === 0 && (
                      <button type="button" onClick={() => open('delete', r)} className="inline-flex items-center gap-1 text-red-600">
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </button>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <Pager
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        onPage={(p) => {
          setPage(p)
          setNotice('')
        }}
      />

      {pending && (
        <ConfirmDialog
          title={pending.kind === 'delete' ? 'Delete this listing for good?' : 'Take this listing down?'}
          confirmLabel={pending.kind === 'delete' ? 'Delete for good' : 'Take down'}
          busyLabel={pending.kind === 'delete' ? 'Deleting…' : 'Taking down…'}
          busy={busy}
          error={dialogError}
          onConfirm={confirm}
          onCancel={() => setPending(null)}
        >
          <p>
            <strong>{pending.row.title}</strong> by {pending.row.seller_name}.{' '}
            {pending.kind === 'delete'
              ? "This removes the listing, its photos, bids, questions, watchers and any reports about it. It can't be undone."
              : 'It disappears from Browse and search. The seller sees it in their dashboard with your reason, and you can restore it later.'}
            {pending.kind === 'take_down' && pending.row.open_orders > 0 &&
              ' It has an open order, which carries on: the buyer and seller can still finish or cancel it.'}
          </p>
          <label className="block">
            <span className="font-semibold text-slate-700">Reason (the seller sees this)</span>
            <textarea
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Weapons aren't allowed on Blockparty."
              className="mt-1 w-full border px-3 py-2 rounded-lg"
            />
          </label>
        </ConfirmDialog>
      )}
    </section>
  )
}
