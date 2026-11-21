// components/admin/AdminUsers.tsx
// Admin: find members, see their account and activity at a glance, and
// suspend or unsuspend them (app/admin/actions.ts). Every call is checked
// server-side with is_admin().
'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronUp, Search, ShieldCheck, UserCheck, UserX, Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Pager } from '@/components/admin/Pager'
import { suspendUser, unsuspendUser } from '@/app/admin/actions'
import type { Database } from '@/lib/supabase/database.types'

type Row = Database['public']['Functions']['admin_users']['Returns'][number]

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'reported', label: 'Reported' },
  { id: 'strikes', label: 'Strikes' },
  { id: 'suspended', label: 'Suspended' },
  { id: 'sellers', label: 'Sellers' },
  { id: 'unconfirmed', label: 'Unconfirmed' },
  { id: 'admins', label: 'Admins' },
] as const
type Filter = (typeof FILTERS)[number]['id']

const PAGE_SIZE = 20
const card = 'bg-white border rounded-2xl p-6 shadow-sm'

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' }) : 'never'

export function AdminUsers() {
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [total, setTotal] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [suspending, setSuspending] = useState<Row | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState('')

  const load = useCallback(async () => {
    setError('')
    const { data, error: rpcError } = await createClient().rpc('admin_users', {
      p_query: submitted || null,
      p_filter: filter,
      p_limit: PAGE_SIZE,
      p_offset: page * PAGE_SIZE,
    })
    if (rpcError) return setError(rpcError.message)
    const list = data ?? []
    if (list.length === 0 && page > 0) return setPage(page - 1)
    setRows(list)
    setTotal(list[0]?.total_count ?? 0)
  }, [submitted, filter, page])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  async function confirmSuspend() {
    if (!suspending) return
    if (!reason.trim()) return setDialogError('Give a reason. They see it in the email.')
    setBusy(true)
    setDialogError('')
    const result = await suspendUser(suspending.id, reason.trim()).catch(() => ({ ok: false as const, error: 'Something went wrong.' }))
    setBusy(false)
    if (!result.ok) return setDialogError(result.error)
    setNotice(result.warning ?? `Suspended ${suspending.username}. They've been emailed the reason.`)
    setSuspending(null)
    load()
  }

  async function unsuspend(r: Row) {
    setError('')
    setNotice('')
    const result = await unsuspendUser(r.id).catch(() => ({ ok: false as const, error: 'Something went wrong.' }))
    if (!result.ok) return setError(result.error)
    setNotice(result.warning ?? `${r.username} can use Blockparty again. They've been emailed.`)
    load()
  }

  return (
    <section className={card}>
      <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
        <Users className="w-5 h-5 text-[#0E4D5C]" /> Members
      </h2>
      <p className="text-sm text-slate-500 mb-4">
        Search by display name, real name or email. <strong>Suspend</strong> blocks sign-in, listing, bidding and buying,
        and hides their listings; orders already in progress can still finish. Strikes are voided in the Strikes section
        below.
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
          <span className="sr-only">Search members</span>
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name or email"
            className="w-full border border-slate-300 rounded-full pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E4D5C]"
          />
        </label>
        <button type="submit" className="px-4 py-2 rounded-full bg-[#0E4D5C] text-white text-sm font-semibold">
          Search
        </button>
      </form>

      <div className="flex flex-wrap gap-2 mb-4" role="tablist" aria-label="Filter members">
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
        <p className="text-sm text-slate-500">No members match.</p>
      ) : (
        <ul className="divide-y">
          {rows.map((r) => {
            const expanded = open === r.id
            return (
              <li key={r.id} className="py-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/u/${r.username}`} className="font-semibold hover:text-[#F26B5B]">
                        {r.username}
                      </Link>
                      {r.is_admin && (
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#0E4D5C] text-white inline-flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3" /> Admin
                        </span>
                      )}
                      {r.suspended_at && (
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-700 text-white">Suspended</span>
                      )}
                      {r.open_reports > 0 && (
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-600 text-white">
                          {r.open_reports} report{r.open_reports === 1 ? '' : 's'}
                        </span>
                      )}
                      {r.active_strikes > 0 && (
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                          {r.active_strikes} strike{r.active_strikes === 1 ? '' : 's'}
                        </span>
                      )}
                      {!r.email_confirmed && (
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">Unconfirmed</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 truncate">
                      {r.full_name ?? 'No name'} · {r.email ?? 'no email'} · joined {day(r.created_at)}
                    </p>
                    <p className="text-xs text-slate-500">
                      {r.listings_live} live / {r.listings_total} listings · {r.sales} sold · {r.purchases} bought
                      {r.open_orders > 0 && <span className="text-amber-700 font-semibold"> · {r.open_orders} open order{r.open_orders === 1 ? '' : 's'}</span>}
                    </p>
                    {r.suspended_reason && <p className="text-xs text-red-700 mt-0.5">Suspended: {r.suspended_reason}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : r.id)}
                    className="shrink-0 p-1.5 rounded-full hover:bg-slate-100 text-slate-500"
                    aria-expanded={expanded}
                    aria-label={expanded ? 'Hide details' : 'Show details'}
                  >
                    {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>

                {expanded && (
                  <div className="mt-3 rounded-xl bg-slate-50 p-4 text-sm space-y-3">
                    <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
                      <Detail label="Phone" value={r.phone ?? 'not set'} />
                      <Detail label="Area" value={r.area ?? 'not set'} />
                      <Detail label="Last signed in" value={day(r.last_sign_in_at)} />
                      <Detail label="Email confirmed" value={r.email_confirmed ? 'yes' : 'no'} />
                      <Detail label="Payouts set up" value={r.payouts_ready ? 'yes' : 'no'} />
                      <Detail label="Card on file" value={r.has_card ? 'yes' : 'no'} />
                      <Detail label="Member ID" value={r.id} mono />
                      {r.suspended_at && <Detail label="Suspended on" value={day(r.suspended_at)} />}
                    </dl>
                    {!r.is_admin &&
                      (r.suspended_at ? (
                        <button
                          type="button"
                          onClick={() => unsuspend(r)}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border-2 border-[#0E4D5C] text-[#0E4D5C] font-semibold"
                        >
                          <UserCheck className="w-4 h-4" /> Unsuspend
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setSuspending(r)
                            setReason('')
                            setDialogError('')
                          }}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-red-600 text-white font-semibold"
                        >
                          <UserX className="w-4 h-4" /> Suspend
                        </button>
                      ))}
                  </div>
                )}
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
          setOpen(null)
          setNotice('')
        }}
      />

      {suspending && (
        <ConfirmDialog
          title={`Suspend ${suspending.username}?`}
          confirmLabel="Suspend"
          busyLabel="Suspending…"
          busy={busy}
          error={dialogError}
          onConfirm={confirmSuspend}
          onCancel={() => setSuspending(null)}
        >
          <p>
            They&apos;re signed out of new sessions and can&apos;t list, bid or buy. Their {suspending.listings_live} live listing
            {suspending.listings_live === 1 ? '' : 's'} disappear from Browse, and auctions skip their bids.
            {suspending.open_orders > 0 &&
              ` Their ${suspending.open_orders} open order${suspending.open_orders === 1 ? '' : 's'} can still be finished or cancelled.`}{' '}
            You can unsuspend them any time.
          </p>
          <label className="block">
            <span className="font-semibold text-slate-700">Reason (emailed to them)</span>
            <textarea
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Repeated no-shows and abusive messages to other members."
              className="mt-1 w-full border px-3 py-2 rounded-lg"
            />
          </label>
        </ConfirmDialog>
      )}
    </section>
  )
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2 min-w-0">
      <dt className="text-slate-500 shrink-0">{label}:</dt>
      <dd className={`font-medium truncate ${mono ? 'font-mono text-xs leading-5' : ''}`}>{value}</dd>
    </div>
  )
}
