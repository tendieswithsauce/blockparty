// components/admin/AdminPayments.tsx
// Admin: orders whose money needs a look (chargebacks, fraud warnings,
// payouts on hold or failing, refunds), a lookup by order number, and the
// payout-delay rules for new sellers. Refunds and taking payouts back go
// through app/admin/actions.ts; holds and rules through admin-checked
// database functions.
'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ExternalLink, Search, Wallet } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { formatCents } from '@/lib/money'
import { refundOrder, reversePayout } from '@/app/admin/actions'
import type { Database } from '@/lib/supabase/database.types'

type Row = Database['public']['Functions']['admin_payment_orders']['Returns'][number]
type Rules = Database['public']['Functions']['admin_payout_rules']['Returns'][number]

const card = 'bg-white border rounded-2xl p-6 shadow-sm'
const smallBtn = 'px-3 py-1.5 rounded-full border text-sm font-semibold hover:bg-slate-50 disabled:opacity-50'
const input = 'border rounded-lg px-3 py-2 text-sm'

const STRIPE_TEST = (process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '').startsWith('pk_test')
const stripePaymentUrl = (pi: string) => `https://dashboard.stripe.com/${STRIPE_TEST ? 'test/' : ''}payments/${pi}`

const HOLD_LABEL: Record<string, string> = {
  dispute: 'chargeback open',
  dispute_lost: 'chargeback lost',
  fraud_warning: 'fraud warning',
  refunded: 'fully refunded',
  admin: 'held by an admin',
}

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' }) : ''

/** "12.50" → 1250; null if not a positive amount. */
function parseCents(value: string): number | null {
  const n = Number(value.replace(/[$,\s]/g, ''))
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n * 100)
}

type Dialog = { kind: 'refund' | 'reverse'; row: Row } | null

export function AdminPayments() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [lookup, setLookup] = useState('')
  const [found, setFound] = useState<Row | null | undefined>(undefined)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [takeBack, setTakeBack] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState('')

  const load = useCallback(async () => {
    const { data, error: rpcError } = await createClient().rpc('admin_payment_orders', {})
    if (rpcError) return setError(rpcError.message)
    setRows(data ?? [])
  }, [])

  useEffect(() => {
    const first = setTimeout(load, 0)
    return () => clearTimeout(first)
  }, [load])

  async function find(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const id = Number(lookup.replace(/\D/g, ''))
    if (!Number.isSafeInteger(id) || id <= 0) return setError('Enter an order number.')
    const { data, error: rpcError } = await createClient().rpc('admin_payment_orders', { p_transaction_id: id })
    if (rpcError) return setError(rpcError.message)
    setFound(data?.[0] ?? null)
  }

  async function refresh() {
    await load()
    if (found) {
      const { data } = await createClient().rpc('admin_payment_orders', { p_transaction_id: found.id })
      setFound(data?.[0] ?? null)
    }
  }

  async function setHold(row: Row, hold: boolean) {
    setError('')
    setNotice('')
    const { error: rpcError } = await createClient().rpc('admin_set_payout_hold', { p_transaction_id: row.id, p_hold: hold })
    if (rpcError) return setError(rpcError.message)
    setNotice(hold ? `Payout for order #${row.id} is on hold.` : `Payout for order #${row.id} released; it's sent within a few minutes if it's due.`)
    await refresh()
  }

  function open(kind: 'refund' | 'reverse', row: Row) {
    const left =
      kind === 'refund' ? row.amount_cents - row.refunded_cents : (row.payout_cents ?? 0) - row.transfer_reversed_cents
    setAmount((left / 100).toFixed(2))
    setNote('')
    setTakeBack(kind === 'refund' && !!row.paid_out_at)
    setDialogError('')
    setDialog({ kind, row })
  }

  async function confirm() {
    if (!dialog) return
    const cents = parseCents(amount)
    if (!cents) return setDialogError('Enter an amount.')
    setBusy(true)
    setDialogError('')
    const result =
      dialog.kind === 'refund'
        ? await refundOrder(dialog.row.id, cents, note, takeBack)
        : await reversePayout(dialog.row.id, cents, note)
    setBusy(false)
    if (!result.ok) return setDialogError(result.error)
    setDialog(null)
    setNotice(result.message)
    await refresh()
  }

  const list = rows ?? []
  const shown = found ? [found, ...list.filter((r) => r.id !== found.id)] : list

  return (
    <section id="payments" className={`${card} scroll-mt-24`}>
      <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
        <Wallet className="w-5 h-5 text-[#0E4D5C]" /> Payments
        {list.length > 0 && <span className="text-sm font-semibold text-[#F26B5B]">({list.length} to look at)</span>}
      </h2>
      <p className="text-sm text-slate-500 mb-4">
        Chargebacks, fraud warnings, payouts on hold or failing, and refunds. Look up any order to refund it. Respond to
        chargebacks with evidence in Stripe (the handoff code and location below help).
      </p>

      <form onSubmit={find} className="flex gap-2 mb-4">
        <input
          className={`${input} w-40`}
          inputMode="numeric"
          placeholder="Order #"
          value={lookup}
          onChange={(e) => setLookup(e.target.value)}
        />
        <button className={smallBtn}>
          <Search className="w-4 h-4 inline -mt-0.5" /> Find
        </button>
      </form>
      {found === null && <p className="text-sm text-slate-500 mb-3">No order with that number.</p>}
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      {notice && <p className="text-sm text-green-700 mb-3">{notice}</p>}

      {rows === null ? (
        <div className="h-16 rounded-xl bg-slate-100 animate-pulse" />
      ) : shown.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing needs a look.</p>
      ) : (
        <ul className="divide-y">
          {shown.map((r) => (
            <PaymentRow key={r.id} r={r} onHold={setHold} onOpen={open} />
          ))}
        </ul>
      )}

      <PayoutRules />

      {dialog && (
        <ConfirmDialog
          title={dialog.kind === 'refund' ? `Refund order #${dialog.row.id}?` : `Take back the payout for order #${dialog.row.id}?`}
          confirmLabel={dialog.kind === 'refund' ? 'Refund' : 'Take it back'}
          busyLabel="Working…"
          busy={busy}
          error={dialogError}
          onConfirm={confirm}
          onCancel={() => setDialog(null)}
        >
          <p>
            {dialog.kind === 'refund'
              ? dialog.row.paid_out_at
                ? 'The buyer gets this back on their card. The seller was already paid, so it comes from Blockparty unless you take it back from them too.'
                : "The buyer gets this back on their card, and the seller's payout shrinks by the same amount."
              : "It comes out of the seller's Stripe balance. They're told why."}{' '}
            Stripe keeps its processing fee.
          </p>
          <label className="block mt-3 text-sm font-semibold">
            Amount ($)
            <input className={`${input} w-full mt-1`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="block mt-3 text-sm font-semibold">
            Reason (the seller sees it)
            <input className={`${input} w-full mt-1`} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {dialog.kind === 'refund' && dialog.row.paid_out_at && (
            <label className="flex items-center gap-2 mt-3 text-sm">
              <input type="checkbox" checked={takeBack} onChange={(e) => setTakeBack(e.target.checked)} />
              Take the same amount back from the seller
            </label>
          )}
        </ConfirmDialog>
      )}
    </section>
  )
}

function PaymentRow({
  r,
  onHold,
  onOpen,
}: {
  r: Row
  onHold: (r: Row, hold: boolean) => void
  onOpen: (kind: 'refund' | 'reverse', r: Row) => void
}) {
  const completed = r.status === 'completed'
  const unpaid = completed && !r.paid_out_at
  const disputeOpen = !!r.dispute_status && !['won', 'lost', 'warning_closed'].includes(r.dispute_status)
  const share = r.amount_cents - r.platform_fee_cents - r.refunded_cents

  return (
    <li className="py-3 flex flex-col sm:flex-row sm:items-start gap-3">
      <div className="flex-1 min-w-0 text-sm">
        <p className="font-semibold">
          Order #{r.id} ·{' '}
          <Link href={`/listings/${r.listing_id}`} className="underline">
            {r.title}
          </Link>{' '}
          · {formatCents(r.amount_cents)}
        </p>
        <p className="text-slate-500">
          {r.buyer_name ?? 'buyer'}
          {r.buyer_suspended && ' (suspended)'} bought from {r.seller_name ?? 'seller'}
          {r.seller_suspended && ' (suspended)'} · {r.status}
          {r.picked_up_at && `, handed over ${day(r.picked_up_at)}`}
        </p>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {r.dispute_status && (
            <Badge tone={disputeOpen || r.dispute_status === 'lost' ? 'red' : 'grey'}>
              Chargeback: {r.dispute_status.replace(/_/g, ' ')}
              {r.dispute_reason && ` (${r.dispute_reason.replace(/_/g, ' ')})`}
            </Badge>
          )}
          {r.fraud_warning_at && <Badge tone="red">Fraud warning {day(r.fraud_warning_at)}</Badge>}
          {r.paid_out_at ? (
            <Badge tone="grey">
              Seller paid {formatCents(r.payout_cents ?? 0)} {day(r.paid_out_at)}
            </Badge>
          ) : r.payout_hold_reason ? (
            <Badge tone="amber">Payout on hold: {HOLD_LABEL[r.payout_hold_reason] ?? r.payout_hold_reason}</Badge>
          ) : completed && r.payout_attempts >= 5 ? (
            <Badge tone="red">Payout failed 5 times</Badge>
          ) : completed ? (
            <Badge tone="grey">
              Payout {formatCents(Math.max(share, 0))} due {day(r.payout_due_at)}
            </Badge>
          ) : null}
          {r.refunded_cents > 0 && <Badge tone="grey">Refunded {formatCents(r.refunded_cents)}</Badge>}
          {r.transfer_reversed_cents > 0 && <Badge tone="grey">Taken back {formatCents(r.transfer_reversed_cents)}</Badge>}
        </div>
        {r.refund_note && <p className="text-slate-500 mt-1">Refund reason: {r.refund_note}</p>}
      </div>
      <div className="flex flex-wrap gap-2 sm:justify-end sm:max-w-[45%]">
        {r.stripe_payment_intent_id && (
          <a href={stripePaymentUrl(r.stripe_payment_intent_id)} target="_blank" rel="noreferrer" className={smallBtn}>
            Stripe <ExternalLink className="w-3.5 h-3.5 inline -mt-0.5" />
          </a>
        )}
        {unpaid && !r.payout_hold_reason && (
          <button className={smallBtn} onClick={() => onHold(r, true)}>
            Hold payout
          </button>
        )}
        {unpaid && r.payout_hold_reason && (
          <button className={smallBtn} onClick={() => onHold(r, false)}>
            Release payout
          </button>
        )}
        {completed && !disputeOpen && r.refunded_cents < r.amount_cents && (
          <button className={smallBtn} onClick={() => onOpen('refund', r)}>
            Refund buyer
          </button>
        )}
        {r.paid_out_at && r.stripe_transfer_id && (r.payout_cents ?? 0) > r.transfer_reversed_cents && (
          <button className={smallBtn} onClick={() => onOpen('reverse', r)}>
            Take back from seller
          </button>
        )}
      </div>
    </li>
  )
}

function Badge({ tone, children }: { tone: 'red' | 'amber' | 'grey'; children: React.ReactNode }) {
  const tones = {
    red: 'bg-red-50 text-red-700 border-red-200',
    amber: 'bg-amber-50 text-amber-800 border-amber-200',
    grey: 'bg-slate-50 text-slate-600 border-slate-200',
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold ${tones[tone]}`}>
      {tone === 'red' && <AlertTriangle className="w-3 h-3" />}
      {children}
    </span>
  )
}

/** How long new sellers wait for their payouts. Admin-only (members can't read these). */
function PayoutRules() {
  const [rules, setRules] = useState<Rules | null>(null)
  const [form, setForm] = useState<Record<keyof Rules, string> | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    const { data } = await createClient().rpc('admin_payout_rules')
    const r = data?.[0] ?? null
    setRules(r)
    if (r) {
      setForm({
        new_seller_sales: String(r.new_seller_sales),
        new_seller_days: String(r.new_seller_days),
        new_seller_payout_delay_days: String(r.new_seller_payout_delay_days),
        payout_delay_days: String(r.payout_delay_days),
      })
    }
  }, [])

  useEffect(() => {
    const first = setTimeout(load, 0)
    return () => clearTimeout(first)
  }, [load])

  if (!rules || !form) return null

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    const n = (k: keyof Rules) => Number(form[k])
    if (Object.keys(form).some((k) => !Number.isInteger(n(k as keyof Rules)))) return setMessage('Use whole numbers.')
    setSaving(true)
    setMessage('')
    const { error } = await createClient().rpc('admin_set_payout_rules', {
      p_new_seller_sales: n('new_seller_sales'),
      p_new_seller_days: n('new_seller_days'),
      p_new_seller_payout_delay_days: n('new_seller_payout_delay_days'),
      p_payout_delay_days: n('payout_delay_days'),
    })
    setSaving(false)
    if (error) return setMessage(error.message)
    setMessage('Saved. Applies to sales completed from now on.')
    await load()
  }

  const field = (k: keyof Rules, w = 'w-16') => (
    <input
      className={`${input} ${w} mx-1 text-center`}
      inputMode="numeric"
      value={form[k]}
      onChange={(e) => setForm({ ...form, [k]: e.target.value })}
    />
  )

  return (
    <form onSubmit={save} className="mt-6 pt-5 border-t text-sm space-y-2">
      <p className="font-bold">Payout delay for new sellers</p>
      <p className="text-slate-600 leading-9">
        Until a seller has {field('new_seller_sales')} clean sales (no chargeback, fraud warning or refund) and has been a member
        for {field('new_seller_days')} days, pay them {field('new_seller_payout_delay_days')} days after the handoff. After
        that, pay {field('payout_delay_days')} days after (0 = straight away).
      </p>
      <p className="text-slate-500">Members can&apos;t see these numbers, so they can&apos;t game them.</p>
      <div className="flex items-center gap-3">
        <button className={smallBtn} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {message && <span className="text-slate-600">{message}</span>}
      </div>
    </form>
  )
}
