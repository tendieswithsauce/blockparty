// lib/fees.ts
// Blockparty's platform fee, taken from the seller's payout. The buyer pays the
// listed price; the seller receives the price minus this fee.
//
// Fee = 10% of the sale, but never less than $5 (Stripe's card processing,
// about 2.9% + 30c, comes out of the fee). To keep every seller getting
// something, items must be listed at MIN_PRICE_CENTS or more.
// The database applies the same rule (begin_purchase / close_auction get these
// values from the app) and enforces the minimum price.

export const PLATFORM_FEE_BPS = 1000 // basis points: 1000 = 10%
export const MIN_PLATFORM_FEE_CENTS = 500
export const MIN_PRICE_CENTS = 1000

export const PLATFORM_FEE_LABEL = `${PLATFORM_FEE_BPS / 100}% (minimum $${MIN_PLATFORM_FEE_CENTS / 100})`

/** Fee in cents: the percentage rounded to the nearest cent, at least the minimum. */
export function platformFeeCents(amountCents: number) {
  const pct = Math.floor((amountCents * PLATFORM_FEE_BPS + 5000) / 10000)
  return Math.min(amountCents, Math.max(pct, MIN_PLATFORM_FEE_CENTS))
}

export function sellerPayoutCents(amountCents: number) {
  return amountCents - platformFeeCents(amountCents)
}
