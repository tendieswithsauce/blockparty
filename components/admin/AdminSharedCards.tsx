// components/admin/AdminSharedCards.tsx
// Admin: accounts that have saved the same card (Stripe gives a card the same
// fingerprint on every account). They can't buy from or bid on each other
// (enforce_strike_limit). Often one person with two accounts, sometimes a
// household. Suspend from the Members section if it looks like abuse.
'use client'

import { useEffect, useState } from 'react'
import { CreditCard } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/lib/supabase/database.types'

type Row = Database['public']['Functions']['admin_shared_cards']['Returns'][number]

const day = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })

export function AdminSharedCards() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    createClient()
      .rpc('admin_shared_cards')
      .then(({ data, error: rpcError }) => {
        if (rpcError) setError(rpcError.message)
        setRows(data ?? [])
      })
  }, [])

  const groups = new Map<string, Row[]>()
  for (const r of rows ?? []) groups.set(r.card_key, [...(groups.get(r.card_key) ?? []), r])

  return (
    <section className="bg-white border rounded-2xl p-6 shadow-sm">
      <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
        <CreditCard className="w-5 h-5 text-[#0E4D5C]" /> Accounts sharing a card ({groups.size})
      </h2>
      <p className="text-sm text-slate-500 mb-4">
        These accounts have saved the same card, so they can&apos;t buy from or bid on each other. It&apos;s often one person
        with two accounts (fake bids, buying from themselves), sometimes a household. Suspend them under Members if it looks
        like abuse.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {rows === null ? (
        <div className="h-12 rounded-xl bg-slate-100 animate-pulse" />
      ) : groups.size === 0 ? (
        <p className="text-sm text-slate-500">None.</p>
      ) : (
        <ul className="space-y-3">
          {[...groups.entries()].map(([key, members]) => (
            <li key={key} className="border rounded-xl p-3 text-sm">
              <p className="text-xs font-semibold text-slate-500 mb-1">Card {key}</p>
              <ul className="space-y-0.5">
                {members.map((m) => (
                  <li key={m.user_id}>
                    <span className="font-semibold">{m.username ?? 'Unnamed account'}</span>
                    {m.email && <span className="text-slate-500"> · {m.email}</span>}
                    {m.suspended && <span className="text-red-600"> · suspended</span>}
                    <span className="text-slate-400"> · since {day(m.first_seen)}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
