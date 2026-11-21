// components/AreaSelect.tsx
// Dropdown of areas grouped by city, loaded from public.areas.
'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { AREA_COLUMNS, groupByCity, type Area } from '@/lib/areas'

export function AreaSelect({
  id,
  value,
  onChange,
  className,
  allOption,
  cityOptions = false,
  placeholder,
  onLoaded,
  name,
  required,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  className?: string
  /** Adds an "everywhere" option with value "all". */
  allOption?: string
  /** Adds an "All of <city>" option (value from cityKey) to each city group. */
  cityOptions?: boolean
  /** Shown as a disabled first option while nothing is chosen. */
  placeholder?: string
  onLoaded?: (areas: Area[]) => void
  /** For plain form posts. */
  name?: string
  required?: boolean
}) {
  const [areas, setAreas] = useState<Area[] | null>(null)

  useEffect(() => {
    let cancelled = false
    createClient()
      .from('areas')
      .select(AREA_COLUMNS)
      .order('country')
      .order('region')
      .order('city')
      .order('sort_order')
      .then(({ data }) => {
        if (cancelled) return
        setAreas(data ?? [])
        onLoaded?.(data ?? [])
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once
  }, [])

  return (
    <select
      id={id}
      name={name}
      required={required}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className}
      disabled={!areas}
    >
      {!areas && <option value={value}>Loading areas…</option>}
      {areas && placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {areas && allOption && <option value="all">{allOption}</option>}
      {areas &&
        groupByCity(areas).map((group) => (
          <optgroup key={group.key} label={group.label}>
            {cityOptions && <option value={group.key}>All of {group.areas[0].city}</option>}
            {group.areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </optgroup>
        ))}
    </select>
  )
}
