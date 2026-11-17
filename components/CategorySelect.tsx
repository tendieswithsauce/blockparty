// components/CategorySelect.tsx
// Category dropdown grouped by top-level category, loaded from public.categories.
// - mode "pick" (listing form): only subcategories can be chosen (or a
//   top-level category that has none, like "Everything else").
// - mode "filter" (browse): adds "All categories" and "All <category>".
'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CATEGORY_COLUMNS, groupCategories, type Category, type CategoryGroup } from '@/lib/categories'

let cache: Promise<Category[]> | null = null
export function loadCategories() {
  cache ??= Promise.resolve(
    createClient()
      .from('categories')
      .select(CATEGORY_COLUMNS)
      .eq('is_active', true)
      .then(({ data }) => (data ?? []) as Category[]),
  )
  return cache
}

export function CategorySelect({
  id,
  value,
  onChange,
  mode,
  className,
  required,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  mode: 'pick' | 'filter'
  className?: string
  required?: boolean
}) {
  const [groups, setGroups] = useState<CategoryGroup[] | null>(null)

  useEffect(() => {
    let cancelled = false
    loadCategories().then((cats) => {
      if (!cancelled) setGroups(groupCategories(cats))
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className}
      disabled={!groups}
      required={required}
    >
      {!groups && <option value={value}>Loading categories…</option>}
      {groups && mode === 'filter' && <option value="">All categories</option>}
      {groups && mode === 'pick' && (
        <option value="" disabled>
          Choose a category
        </option>
      )}
      {groups?.map(({ parent, children }) =>
        children.length === 0 ? (
          <option key={parent.id} value={parent.id}>
            {parent.name}
          </option>
        ) : (
          <optgroup key={parent.id} label={parent.name}>
            {mode === 'filter' && <option value={parent.id}>All {parent.name.toLowerCase()}</option>}
            {children.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        ),
      )}
    </select>
  )
}
