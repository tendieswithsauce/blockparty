// lib/money.ts
// All prices are stored as integer cents (matches Stripe).

/**
 * Highest price, starting price or bid allowed on Blockparty: $1,000 CAD.
 * Small, local items only; keeps off-session charges small and limits fraud.
 * Also enforced by DB check constraints and place_bid().
 */
export const MAX_PRICE_CENTS = 100_000

/** "12.5" -> 1250. Returns null for empty/invalid/non-positive input. */
export function dollarsToCents(input: string): number | null {
  const value = Number(input)
  if (!input.trim() || !Number.isFinite(value) || value <= 0) return null
  return Math.round(value * 100)
}

/** 1250 -> "$12.50" */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100)
}
