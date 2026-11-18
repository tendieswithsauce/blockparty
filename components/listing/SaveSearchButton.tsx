// components/listing/SaveSearchButton.tsx
// "Get alerts" on the Browse page: saves the current search and filters, and
// we notify the member when a new listing matches (see saved_searches).
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BellPlus, BellRing } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { ListingCondition } from '@/lib/supabase/database.types'

export type SearchToSave = {
  query: string
  categoryId: string
  areaIds: string[] | null
  areaKey: string
  listingType: '' | 'fixed' | 'auction'
  conditions: ListingCondition[]
  minCents: number | null
  maxCents: number | null
  queryString: string
}

export function SaveSearchButton({ search }: { search: SearchToSave }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [saved, setSaved] = useState<string | null>(null) // query string we saved
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => setSignedIn(!!data.user))
  }, [])

  const hasCriteria =
    !!search.query.trim() ||
    !!search.categoryId ||
    !!search.listingType ||
    search.conditions.length > 0 ||
    search.minCents !== null ||
    search.maxCents !== null
  if (!hasCriteria || signedIn === null) return null

  if (!signedIn) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent(`/listings?${search.queryString}`)}`}
        className="inline-flex items-center gap-1.5 font-semibold text-[#0E4D5C] hover:text-[#F26B5B]"
      >
        <BellPlus className="w-4 h-4" /> Get alerts
      </Link>
    )
  }

  if (saved === search.queryString) {
    return (
      <span className="inline-flex items-center gap-1.5 font-semibold text-green-700">
        <BellRing className="w-4 h-4" /> We&apos;ll tell you about new matches
      </span>
    )
  }

  async function save() {
    setBusy(true)
    setError('')
    const { error: rpcError } = await createClient().rpc('save_search', {
      p_query: search.query.trim() || null,
      p_category_id: search.categoryId || null,
      p_area_ids: search.areaIds,
      p_area_key: search.areaKey,
      p_listing_type: search.listingType || null,
      p_conditions: search.conditions.length ? search.conditions : null,
      p_min_cents: search.minCents,
      p_max_cents: search.maxCents,
      p_query_string: search.queryString,
    })
    setBusy(false)
    if (rpcError) setError(rpcError.code === 'P0001' ? `${rpcError.message}.` : "Couldn't save this search.")
    else setSaved(search.queryString)
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-red-600">{error}</span>}
      <button
        type="button"
        onClick={save}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#0E4D5C]/30 bg-white font-semibold text-[#0E4D5C] hover:bg-[#0E4D5C]/5 disabled:opacity-60"
      >
        <BellPlus className="w-4 h-4" /> {busy ? 'Saving…' : 'Get alerts'}
      </button>
    </span>
  )
}
