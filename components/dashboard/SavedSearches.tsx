// components/dashboard/SavedSearches.tsx
// The member's saved searches: run one again, or stop its alerts.
'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { BellRing } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Saved = { id: number; label: string; query_string: string; last_matched_at: string | null }

export function SavedSearches() {
  const [items, setItems] = useState<Saved[] | null>(null)

  const load = useCallback(async () => {
    const { data } = await createClient()
      .from('saved_searches')
      .select('id, label, query_string, last_matched_at')
      .order('created_at', { ascending: false })
    setItems(data ?? [])
  }, [])

  useEffect(() => {
    const first = setTimeout(load, 0)
    return () => clearTimeout(first)
  }, [load])

  if (!items?.length) return null

  return (
    <section className="bg-white border rounded-2xl p-6 shadow-sm">
      <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
        <BellRing className="w-5 h-5 text-[#0E4D5C]" /> Saved searches
      </h2>
      <p className="text-sm text-slate-500 mb-4">We&apos;ll tell you when a new listing matches one of these.</p>
      <ul className="divide-y">
        {items.map((s) => (
          <li key={s.id} className="py-3 flex justify-between items-center gap-4 text-sm">
            <Link href={`/listings${s.query_string ? `?${s.query_string}` : ''}`} className="min-w-0 hover:text-[#F26B5B]">
              <span className="font-medium line-clamp-1">{s.label}</span>
              {s.last_matched_at && (
                <span className="block text-xs text-slate-500">
                  Last match {new Date(s.last_matched_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
                </span>
              )}
            </Link>
            <button
              type="button"
              onClick={async () => {
                await createClient().from('saved_searches').delete().eq('id', s.id)
                load()
              }}
              className="shrink-0 text-xs font-semibold text-slate-500 hover:text-[#F26B5B]"
            >
              Stop alerts
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
