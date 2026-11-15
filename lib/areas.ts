// lib/areas.ts
// Areas are broad parts of a city (rows in public.areas, tagged with country,
// region and city), so new cities and countries are added as data, not code.
// A user's area is only used to suggest meetup spots fair to both people.

export type Area = {
  id: string
  name: string
  city: string
  region: string
  country: string
  timezone: string
}

export const AREA_COLUMNS = 'id, name, city, region, country, timezone'

/** Option value meaning "every area in this city", e.g. "city:CA:AB:Edmonton". */
export function cityKey(a: Pick<Area, 'country' | 'region' | 'city'>) {
  return `city:${a.country}:${a.region}:${a.city}`
}

export function cityLabel(a: Pick<Area, 'region' | 'city'>) {
  return `${a.city}, ${a.region}`
}

/** "Mill Woods & Southeast, Edmonton" */
export function areaLabel(a: Pick<Area, 'name' | 'city'> | null | undefined) {
  return a ? `${a.name}, ${a.city}` : 'Area not set'
}

/** Areas grouped by city, keeping the order they were fetched in. */
export function groupByCity(areas: Area[]) {
  const groups = new Map<string, { key: string; label: string; areas: Area[] }>()
  for (const a of areas) {
    const key = cityKey(a)
    if (!groups.has(key)) groups.set(key, { key, label: cityLabel(a), areas: [] })
    groups.get(key)!.areas.push(a)
  }
  return [...groups.values()]
}
