// lib/categories.ts
// Categories are rows in public.categories (category -> subcategories), so
// they can be added or renamed without a deploy. Condition is a fixed list.
import type { ListingCondition } from '@/lib/supabase/database.types'

export type Category = {
  id: string
  parent_id: string | null
  name: string
  sort_order: number
}

export const CATEGORY_COLUMNS = 'id, parent_id, name, sort_order'

export type CategoryGroup = { parent: Category; children: Category[] }

/** Top-level categories with their subcategories, in display order. */
export function groupCategories(categories: Category[]): CategoryGroup[] {
  const bySort = (a: Category, b: Category) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)
  return categories
    .filter((c) => !c.parent_id)
    .sort(bySort)
    .map((parent) => ({
      parent,
      children: categories.filter((c) => c.parent_id === parent.id).sort(bySort),
    }))
}

/** "Bikes" plus its parent, e.g. for "Sports & outdoors › Bikes". */
export type CategoryRef = { name: string; parent: { name: string } | null } | null

export function categoryPath(c: CategoryRef) {
  if (!c) return null
  return c.parent ? `${c.parent.name} › ${c.name}` : c.name
}

export const CONDITIONS: { value: ListingCondition; label: string; hint: string }[] = [
  { value: 'new', label: 'New', hint: 'Unused, in original packaging' },
  { value: 'like_new', label: 'Like new', hint: 'Used briefly, no visible wear' },
  { value: 'good', label: 'Good', hint: 'Some signs of use, works well' },
  { value: 'fair', label: 'Fair', hint: 'Obvious wear, still works' },
  { value: 'for_parts', label: 'For parts', hint: "Doesn't work or needs repair" },
]

export function conditionLabel(value: string | null | undefined) {
  return CONDITIONS.find((c) => c.value === value)?.label ?? null
}

export function isCondition(value: string): value is ListingCondition {
  return CONDITIONS.some((c) => c.value === value)
}
