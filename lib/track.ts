// lib/track.ts
// Engagement logging (browser-only): listing views and Browse searches, the
// history a personalized Browse page will learn from. Signed-in members are
// logged by account; visitors get a random id kept in this browser, which is
// attached to their account once they sign in. Fire-and-forget: failures
// never affect the page.
import { createClient } from '@/lib/supabase/client'
import type { ListingCondition } from '@/lib/supabase/database.types'

const ANON_KEY = 'bp_anon_id'
const PREV_KEY = 'bp_prev_path'
const CUR_KEY = 'bp_cur_path'

/** Called on every route change (components/AuthNav.tsx), so views know where people came from. */
export function rememberPath(path: string) {
  try {
    const cur = sessionStorage.getItem(CUR_KEY)
    if (cur === path) return
    if (cur) sessionStorage.setItem(PREV_KEY, cur)
    sessionStorage.setItem(CUR_KEY, path)
  } catch {}
}

/** The previous page on this site, as a short label: "listings", "charities", "home"… */
export function previousSection(currentPath: string): string | undefined {
  try {
    const cur = sessionStorage.getItem(CUR_KEY)
    const prev = cur === currentPath ? sessionStorage.getItem(PREV_KEY) : cur
    if (!prev) return undefined
    return prev.split('/')[1] || 'home'
  } catch {
    return undefined
  }
}

function anonId(): string | null {
  try {
    let id = localStorage.getItem(ANON_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(ANON_KEY, id)
    }
    return id
  } catch {
    return null
  }
}

export function trackListingView(listingId: number, source?: string) {
  createClient()
    .rpc('log_listing_view', { p_listing_id: listingId, p_anon_id: anonId(), p_source: source ?? null })
    .then(
      () => {},
      () => {},
    )
}

export type TrackedSearch = {
  query: string
  categoryId: string
  areaKey: string
  listingType: '' | 'fixed' | 'auction' | 'free'
  conditions: ListingCondition[]
  minCents: number | null
  maxCents: number | null
  sort: string
  resultCount: number
}

export function trackSearch(s: TrackedSearch) {
  createClient()
    .rpc('log_search', {
      p_anon_id: anonId(),
      p_query: s.query.trim() || null,
      p_category_id: s.categoryId || null,
      p_area_key: s.areaKey || null,
      p_listing_type: s.listingType || null,
      p_conditions: s.conditions.length ? s.conditions : null,
      p_min_cents: s.minCents,
      p_max_cents: s.maxCents,
      p_sort: s.sort,
      p_result_count: s.resultCount,
    })
    .then(
      () => {},
      () => {},
    )
}

/** After sign-in: move this browser's anonymous history onto the account. */
export function claimAnonymousHistory() {
  let id: string | null = null
  try {
    id = localStorage.getItem(ANON_KEY)
  } catch {
    return
  }
  if (!id) return
  createClient()
    .rpc('claim_anonymous_engagement', { p_anon_id: id })
    .then(({ error }) => {
      if (!error) {
        try {
          localStorage.removeItem(ANON_KEY)
        } catch {}
      }
    })
}
