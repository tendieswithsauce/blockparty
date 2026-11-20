// components/listing/ListingsBrowser.tsx
// Browse page body: keyword search that updates as you type, plus filters
// (category, area, set price / auction, condition, price) and sorting.
// Everything lives in the URL (?q=bike&category=bikes...) so searches can be
// shared and survive a refresh. Results come from search_listings() in the DB.
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { MapPin, Search, SlidersHorizontal, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { AreaSelect } from '@/components/AreaSelect'
import { SaveSearchButton } from '@/components/listing/SaveSearchButton'
import { trackSearch } from '@/lib/track'
import { LISTING_CARD_COLUMNS, ListingCard, type ListingCardData } from '@/components/listing/ListingCard'
import { CategorySelect } from '@/components/CategorySelect'
import { cityKey, type Area } from '@/lib/areas'
import { CONDITIONS, isCondition } from '@/lib/categories'
import { dollarsToCents } from '@/lib/money'
import type { ListingCondition, ListingSort } from '@/lib/supabase/database.types'

const RESULT_COLUMNS = LISTING_CARD_COLUMNS
type Result = ListingCardData

const SORTS: { value: ListingSort; label: string }[] = [
  { value: 'relevance', label: 'Best match' },
  { value: 'newest', label: 'Newest' },
  { value: 'ending_soon', label: 'Ending soon' },
  { value: 'price_low', label: 'Price: low to high' },
  { value: 'price_high', label: 'Price: high to low' },
]

type Filters = {
  q: string
  category: string
  area: string
  type: '' | 'fixed' | 'auction'
  conditions: ListingCondition[]
  min: string
  max: string
  sort: ListingSort
}

function readFilters(params: URLSearchParams): Filters {
  const type = params.get('type')
  const sort = params.get('sort') as ListingSort | null
  const q = params.get('q') ?? ''
  return {
    q,
    category: params.get('category') ?? '',
    area: params.get('area') ?? 'all',
    type: type === 'fixed' || type === 'auction' ? type : '',
    conditions: (params.get('condition') ?? '').split(',').filter(isCondition),
    min: params.get('min') ?? '',
    max: params.get('max') ?? '',
    sort: sort && SORTS.some((s) => s.value === sort) ? sort : q ? 'relevance' : 'newest',
  }
}

function toQueryString(f: Filters) {
  const p = new URLSearchParams()
  if (f.q.trim()) p.set('q', f.q.trim())
  if (f.category) p.set('category', f.category)
  if (f.area && f.area !== 'all') p.set('area', f.area)
  if (f.type) p.set('type', f.type)
  if (f.conditions.length) p.set('condition', f.conditions.join(','))
  if (f.min) p.set('min', f.min)
  if (f.max) p.set('max', f.max)
  const defaultSort = f.q.trim() ? 'relevance' : 'newest'
  if (f.sort !== defaultSort) p.set('sort', f.sort)
  return p.toString()
}

export function ListingsBrowser() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [filters, setFilters] = useState<Filters>(() => readFilters(new URLSearchParams(params.toString())))
  const [query, setQuery] = useState(filters.q) // what's in the box, before the debounce
  const [areas, setAreas] = useState<Area[]>([])
  const [results, setResults] = useState<Result[] | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const requestId = useRef(0)

  const update = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }))

  // Debounce typing into the search box.
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => {
        if (f.q === query) return f
        // Switch to "Best match" when a search starts, back to newest when cleared.
        const sort = query.trim() && f.sort === 'newest' ? 'relevance' : !query.trim() && f.sort === 'relevance' ? 'newest' : f.sort
        return { ...f, q: query, sort }
      })
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  // Keep the URL in step (replace, so typing doesn't fill the back button).
  // Remember what we wrote so the effect below can tell our own URL updates
  // from navigation (e.g. the header's "Active Auctions" link).
  const ownUrls = useRef(new Set<string>())
  useEffect(() => {
    const qs = toQueryString(filters)
    if (qs !== params.toString()) {
      ownUrls.current.add(qs)
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when filters change
  }, [filters])

  useEffect(() => {
    const qs = params.toString()
    if (ownUrls.current.has(qs)) {
      if (qs === toQueryString(filters)) ownUrls.current.clear() // caught up
      return
    }
    if (qs === toQueryString(filters)) return
    const t = setTimeout(() => {
      const next = readFilters(new URLSearchParams(qs))
      setFilters(next)
      setQuery(next.q)
    }, 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the URL changes
  }, [params])

  const areaIds = useMemo(() => {
    if (filters.area === 'all') return null
    if (filters.area.startsWith('city:')) {
      const ids = areas.filter((a) => cityKey(a) === filters.area).map((a) => a.id)
      return ids.length ? ids : null
    }
    return [filters.area]
  }, [filters.area, areas])
  const waitingForAreas = filters.area.startsWith('city:') && areas.length === 0

  // Fetch results; ignore any response that arrives after a newer request.
  useEffect(() => {
    if (waitingForAreas) return
    const id = ++requestId.current
    const minCents = filters.min ? dollarsToCents(filters.min) : null
    const maxCents = filters.max ? dollarsToCents(filters.max) : null
    createClient()
      .rpc('search_listings', {
        p_query: filters.q.trim() || null,
        p_category_id: filters.category || null,
        p_area_ids: areaIds,
        p_listing_type: filters.type || null,
        p_conditions: filters.conditions.length ? filters.conditions : null,
        p_min_cents: minCents,
        p_max_cents: maxCents,
        p_sort: filters.sort,
        p_limit: 48,
      })
      .select(RESULT_COLUMNS)
      .then(({ data, error }) => {
        if (id !== requestId.current) return
        if (error) console.error('search_listings failed', error)
        setResults((data ?? []) as unknown as Result[])
      })
  }, [filters, areaIds, waitingForAreas])

  // Log the search once the person has stopped typing and results are in
  // (lib/track.ts; empty searches and repeats are skipped by the database).
  useEffect(() => {
    if (results === null) return
    const t = setTimeout(() => {
      trackSearch({
        query: filters.q,
        categoryId: filters.category,
        areaKey: filters.area,
        listingType: filters.type,
        conditions: filters.conditions,
        minCents: filters.min ? dollarsToCents(filters.min) : null,
        maxCents: filters.max ? dollarsToCents(filters.max) : null,
        sort: filters.sort,
        resultCount: results.length,
      })
    }, 1500)
    return () => clearTimeout(t)
  }, [results, filters])

  const activeFilterCount =
    (filters.category ? 1 : 0) +
    (filters.type ? 1 : 0) +
    (filters.conditions.length ? 1 : 0) +
    (filters.min || filters.max ? 1 : 0)

  function clearAll() {
    setQuery('')
    setFilters({ q: '', category: '', area: filters.area, type: '', conditions: [], min: '', max: '', sort: 'newest' })
  }

  const selectClass =
    'w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E4D5C]'

  return (
    <>
      {/* Search + area */}
      <div className="flex flex-col md:flex-row gap-3 mb-4">
        <label className="relative flex-1">
          <span className="sr-only">Search listings</span>
          <Search className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for bikes, couches, skates…"
            className="w-full pl-12 pr-10 py-3 rounded-2xl border-2 border-[#0E4D5C]/20 bg-white shadow-sm focus:outline-none focus:border-[#0E4D5C] text-base"
            autoComplete="off"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full text-slate-400 hover:text-slate-700"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </label>
        <div className="flex items-center gap-2 bg-white px-4 py-2.5 border-2 border-[#0E4D5C]/20 rounded-2xl shadow-sm">
          <MapPin className="w-5 h-5 text-[#F26B5B]" aria-hidden />
          <AreaSelect
            value={filters.area}
            onChange={(area) => update({ area })}
            onLoaded={setAreas}
            allOption="All areas"
            cityOptions
            className="bg-transparent focus:outline-none text-sm font-bold text-[#0E4D5C]"
          />
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="inline-flex rounded-full border border-slate-300 bg-white p-0.5 text-sm" role="group" aria-label="Listing type">
          {(
            [
              ['', 'All'],
              ['fixed', 'Set Price'],
              ['auction', 'Auctions'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value || 'all'}
              type="button"
              onClick={() => update({ type: value })}
              aria-pressed={filters.type === value}
              className={`px-3 py-1.5 rounded-full font-semibold transition ${
                filters.type === value ? 'bg-[#0E4D5C] text-white' : 'text-slate-600 hover:text-[#0E4D5C]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 min-w-[9rem] sm:flex-none sm:w-56">
          <CategorySelect
            mode="filter"
            value={filters.category}
            onChange={(category) => update({ category })}
            className={selectClass}
          />
        </div>

        <button
          type="button"
          onClick={() => setShowFilters((s) => !s)}
          aria-expanded={showFilters}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:border-[#0E4D5C]"
        >
          <SlidersHorizontal className="w-4 h-4" /> More filters
          {filters.conditions.length + (filters.min || filters.max ? 1 : 0) > 0 && (
            <span className="ml-1 px-1.5 rounded-full bg-[#F26B5B] text-white text-xs">
              {filters.conditions.length + (filters.min || filters.max ? 1 : 0)}
            </span>
          )}
        </button>

        <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">
          Sort
          <select
            value={filters.sort}
            onChange={(e) => update({ sort: e.target.value as ListingSort })}
            className="bg-white border border-slate-300 rounded-xl px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[#0E4D5C]"
          >
            {SORTS.filter((s) => s.value !== 'relevance' || filters.q.trim()).map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {showFilters && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 mb-6 grid sm:grid-cols-2 gap-6">
          <fieldset>
            <legend className="text-sm font-bold text-slate-700 mb-2">Condition</legend>
            <div className="flex flex-wrap gap-2">
              {CONDITIONS.map((c) => {
                const on = filters.conditions.includes(c.value)
                return (
                  <button
                    key={c.value}
                    type="button"
                    aria-pressed={on}
                    title={c.hint}
                    onClick={() =>
                      update({
                        conditions: on ? filters.conditions.filter((v) => v !== c.value) : [...filters.conditions, c.value],
                      })
                    }
                    className={`px-3 py-1.5 rounded-full border text-sm font-semibold transition ${
                      on ? 'bg-[#0E4D5C] border-[#0E4D5C] text-white' : 'border-slate-300 text-slate-600 hover:border-[#0E4D5C]'
                    }`}
                  >
                    {c.label}
                  </button>
                )
              })}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-sm font-bold text-slate-700 mb-2">Price</legend>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                step="1"
                inputMode="numeric"
                placeholder="Min $"
                aria-label="Minimum price in dollars"
                value={filters.min}
                onChange={(e) => update({ min: e.target.value })}
                className={selectClass}
              />
              <span className="text-slate-400">to</span>
              <input
                type="number"
                min={0}
                step="1"
                inputMode="numeric"
                placeholder="Max $"
                aria-label="Maximum price in dollars"
                value={filters.max}
                onChange={(e) => update({ max: e.target.value })}
                className={selectClass}
              />
            </div>
            <p className="text-xs text-slate-500 mt-1">For auctions, this is the current bid.</p>
          </fieldset>
        </div>
      )}

      {/* Result count + clear */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-4 text-sm text-slate-500" aria-live="polite">
        <span>
          {results === null
            ? 'Searching…'
            : `${results.length === 48 ? '48+' : results.length} ${results.length === 1 ? 'listing' : 'listings'}`}
        </span>
        <span className="flex flex-wrap items-center gap-4">
          <SaveSearchButton
            search={{
              query: filters.q,
              categoryId: filters.category,
              areaIds,
              areaKey: filters.area,
              listingType: filters.type,
              conditions: filters.conditions,
              minCents: filters.min ? dollarsToCents(filters.min) : null,
              maxCents: filters.max ? dollarsToCents(filters.max) : null,
              queryString: toQueryString(filters),
            }}
          />
          {(activeFilterCount > 0 || filters.q) && (
            <button type="button" onClick={clearAll} className="font-semibold text-[#0E4D5C] hover:text-[#F26B5B]">
              Clear search &amp; filters
            </button>
          )}
        </span>
      </div>

      {/* Results */}
      {results === null ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-72 bg-slate-200 animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : results.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-3xl border border-slate-200 shadow-sm max-w-xl mx-auto p-8">
          <div className="w-16 h-16 rounded-full bg-[#A8D5BA]/40 text-[#0E4D5C] flex items-center justify-center mx-auto mb-4">
            <Search className="w-8 h-8" />
          </div>
          <h3 className="text-xl font-bold text-slate-800">Nothing matches yet</h3>
          <p className="text-slate-500 text-sm mt-1 mb-6">Try fewer words, another category or a wider area.</p>
          {(activeFilterCount > 0 || filters.q) && (
            <button
              type="button"
              onClick={clearAll}
              className="inline-flex items-center justify-center px-6 py-3 rounded-full bg-[#F26B5B] text-white font-bold text-sm shadow-md hover:bg-[#e05848] transition"
            >
              Clear search &amp; filters
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
          {results.map((item) => (
            <ListingCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </>
  )
}
